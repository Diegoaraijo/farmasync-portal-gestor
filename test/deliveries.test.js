"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { buildPendingDeliveries, parseSettleRequest } = require("../src/deliveries");
const { hashPassword } = require("../src/security");

const NOW = Date.parse("2026-11-13T15:10:00Z");

const row = (overrides = {}) => ({
  venda_id: 10, hora_venda: "10:00", espera_minutos: 30, valor: "52.50", cliente_nome: "Maria S.",
  entregador_nome: "Carlos L.", pagamento: "Pix", origem: "BALCAO", pedido_app_numero: "",
  snapshot_em: "2026-11-13T15:05:00Z", ...overrides,
});

test("o pedido de baixa valida ids, código de 4 dígitos e tamanho do lote", () => {
  assert.deepEqual(parseSettleRequest({ deliveries: [{ saleId: 10 }, { saleId: "11", code: " 1234 " }, { saleId: 10 }] }).value.items, [
    { saleId: 10, code: null }, { saleId: 11, code: "1234" },
  ]);
  assert.equal(parseSettleRequest({}).error, "invalid_request");
  assert.equal(parseSettleRequest({ deliveries: [] }).error, "invalid_request");
  assert.equal(parseSettleRequest({ deliveries: [{ saleId: 0 }] }).error, "invalid_sale_id");
  assert.equal(parseSettleRequest({ deliveries: [{ saleId: "abc" }] }).error, "invalid_sale_id");
  assert.equal(parseSettleRequest({ deliveries: [{ saleId: 1, code: "12" }] }).error, "invalid_code");
  assert.equal(parseSettleRequest({ deliveries: [{ saleId: 1, code: "12a4" }] }).error, "invalid_code");
  const many = Array.from({ length: 21 }, (_, index) => ({ saleId: index + 1 }));
  assert.equal(parseSettleRequest({ deliveries: many }).error, "too_many_deliveries");
});

test("a lista soma ao tempo publicado o que passou desde a última sincronização e junta o andamento da baixa", () => {
  const result = buildPendingDeliveries({
    rows: [
      row(),
      row({ venda_id: 11, origem: "APP", pedido_app_numero: "A1B2C3", espera_minutos: 50, snapshot_em: "2026-11-13T15:10:00Z" }),
    ],
    requests: [
      { id: 1, venda_id: 10, status: "FALHOU", erro: "antigo" },
      { id: 2, venda_id: 10, status: "PENDENTE", resultado: null, erro: null },
    ],
    syncedAt: "2026-11-13T15:09:30Z",
  }, NOW);
  const [first, second] = result.deliveries;
  assert.equal(first.waitMinutes, 35);
  assert.equal(first.urgent, false);
  assert.equal(first.amount, 52.5);
  assert.equal(first.request.id, 2);
  assert.equal(first.request.cancellable, true);
  assert.equal(second.waitMinutes, 50);
  assert.equal(second.urgent, true);
  assert.equal(second.codeRequired, true);
  assert.equal(second.orderNumber, "A1B2C3");
  assert.equal(second.request, null);
  assert.equal(result.sync.stale, false);
});

test("sem sincronização recente, o portal avisa que o balcão está parado", () => {
  assert.equal(buildPendingDeliveries({ rows: [], requests: [], syncedAt: "2026-11-13T15:00:00Z" }, NOW).sync.stale, true);
  assert.equal(buildPendingDeliveries({ rows: [], requests: [], syncedAt: null }, NOW).sync.stale, true);
});

async function startServer() {
  const credentials = hashPassword("senha-segura-123");
  const state = { settled: [], cancelled: [] };
  const repository = {
    health: async () => {},
    userByEmail: async () => ({ id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash }),
    createSession: async (_userId, tokenHash) => { state.token = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (tokenHash === state.token ? { user_id: 7, cliente_id: 42 } : null),
    deleteSession: async () => {},
    pendingDeliveriesByClientId: async (clientId) => {
      state.seenClient = clientId;
      return { rows: [row({ snapshot_em: new Date().toISOString() })], requests: [], syncedAt: new Date().toISOString() };
    },
    enqueueDeliverySettlements: async (clientId, userId, items) => {
      state.settled.push({ clientId, userId, items });
      return items.map((item) => ({ saleId: item.saleId, status: "queued", id: item.saleId }));
    },
    cancelDeliverySettlement: async (clientId, id) => { state.cancelled.push([clientId, id]); return id === 5; },
  };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = (method, url, body) => fetch(`${baseUrl}${url}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { state, baseUrl, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("API: exige sessão, lista só a farmácia da sessão e nunca devolve o código de segurança", async (context) => {
  const server = await startServer();
  context.after(server.close);
  assert.equal((await fetch(`${server.baseUrl}/api/deliveries/pending`)).status, 401);
  assert.equal((await fetch(`${server.baseUrl}/api/deliveries/settle`, { method: "POST" })).status, 401);

  const listed = await (await server.call("GET", "/api/deliveries/pending")).json();
  assert.equal(server.state.seenClient, 42);
  assert.equal(listed.deliveries.length, 1);
  assert.equal(listed.sync.stale, false);

  const sent = await server.call("POST", "/api/deliveries/settle", { deliveries: [{ saleId: 10, code: "4821" }], cliente_id: 999 });
  assert.equal(sent.status, 202);
  assert.deepEqual(server.state.settled[0], { clientId: 42, userId: 7, items: [{ saleId: 10, code: "4821" }] });
  assert.equal(JSON.stringify(await sent.json()).includes("4821"), false);

  const bad = await server.call("POST", "/api/deliveries/settle", { deliveries: [{ saleId: 10, code: "1" }] });
  assert.equal(bad.status, 400);
  assert.equal(server.state.settled.length, 1);
});

test("API: cancela só pedido de baixa que o balcão ainda não começou", async (context) => {
  const server = await startServer();
  context.after(server.close);
  assert.equal((await server.call("POST", "/api/deliveries/requests/5/cancel")).status, 200);
  assert.equal((await server.call("POST", "/api/deliveries/requests/6/cancel")).status, 409);
  assert.equal((await server.call("POST", "/api/deliveries/requests/abc/cancel")).status, 404);
  assert.deepEqual(server.state.cancelled, [[42, 5], [42, 6]]);
});
