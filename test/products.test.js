const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createRepository } = require("../src/repository");
const { parseProductUpdate, serializeProduct } = require("../src/products");
const { hashPassword } = require("../src/security");

async function authenticatedServer(overrides = {}) {
  const credentials = hashPassword("senha-segura-123");
  let tokenHash = null;
  const repository = {
    userByEmail: async () => ({
      id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash,
      password_change_required: 0,
    }),
    createSession: async (_userId, value) => { tokenHash = value; },
    sessionByTokenHash: async (value) => (
      value === tokenHash ? { user_id: 7, cliente_id: 42, password_change_required: 0 } : null
    ),
    ...overrides,
  };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  return {
    baseUrl,
    cookie: login.headers.get("set-cookie").split(";")[0],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const put = (app, id, body) => fetch(`${app.baseUrl}/api/products/${id}`, {
  method: "PUT", headers: { cookie: app.cookie, "content-type": "application/json" },
  body: JSON.stringify(body),
});

const row = (overrides = {}) => ({
  produto_origem_id: 11, codigo: "789", nome: "Produto seguro", preco_venda: "11.51", estoque: 8,
  ativo: 1, snapshot_em: "2026-11-08 10:00:00", categoria: "Generico", preco_promocional: null,
  promo_qtd: null, promo_preco_pacote: null, validade: null, estoque_minimo: 0, tipo_modelo: 0, detalhes: 1,
  ...overrides,
});

test("catálogo usa exclusivamente o cliente autenticado e traz promoção e detalhes", async (context) => {
  let received = null;
  const app = await authenticatedServer({
    productsByClientId: async (clientId, options) => {
      received = { clientId, options };
      return {
        products: [row({ preco_promocional: "7.99", promo_qtd: 3, promo_preco_pacote: "15.00", validade: "2027-05-01", estoque_minimo: 10 })],
        total: 1,
        counts: { all: 9, promo: 1, lowstock: 2, nostock: 3, expiry: 4 },
      };
    },
  });
  context.after(app.close);

  const response = await fetch(`${app.baseUrl}/api/products?cliente_id=999&search=seguro&limit=20&filter=promo`, { headers: { cookie: app.cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { clientId: 42, options: { search: "seguro", filter: "promo", limit: "20" } });
  const payload = await response.json();
  const product = payload.products[0];
  assert.equal(product.name, "Produto seguro");
  assert.equal(product.category, "Generico");
  assert.equal(product.promoPrice, 7.99);
  assert.equal(product.promoQty, 3);
  assert.equal(product.promoPackagePrice, 15);
  assert.equal(product.onPromotion, true);
  assert.equal(product.minimumStock, 10);
  assert.equal(product.lowStock, true);
  assert.equal(product.expiryDate, "2027-05-01");
  assert.equal(product.kind, "normal");
  assert.equal(product.hasDetails, true);
  assert.deepEqual(payload.counts, { all: 9, promo: 1, lowstock: 2, nostock: 3, expiry: 4 });
  assert.equal(payload.total, 1);
  assert.equal(JSON.stringify(payload).includes("chave_licenca"), false);
});

test("filtro desconhecido vira 'todos'", async (context) => {
  let received = null;
  const app = await authenticatedServer({
    productsByClientId: async (_clientId, options) => { received = options; return { products: [], total: 0, counts: {} }; },
  });
  context.after(app.close);
  await fetch(`${app.baseUrl}/api/products?filter=1%3BDROP%20TABLE`, { headers: { cookie: app.cookie } });
  assert.equal(received.filter, "all");
});

test("alteração válida entra na fila com cliente e usuário da sessão", async (context) => {
  let received = null;
  const app = await authenticatedServer({
    enqueueProductUpdate: async (clientId, userId, productId, product) => {
      received = { clientId, userId, productId, product };
      return { updateId: 91, productId, status: "PENDENTE" };
    },
  });
  context.after(app.close);

  const response = await put(app, 11, { name: "Produto atualizado", salePrice: 15.499, stock: 12, clientId: 999, userId: 999 });
  assert.equal(response.status, 202);
  assert.deepEqual(received, {
    clientId: 42, userId: 7, productId: 11,
    product: { name: "Produto atualizado", salePrice: 15.5, stock: 12, promotion: null },
  });
});

test("promoção válida (preço promocional e leve N por R$) segue para a fila", async (context) => {
  let received = null;
  const app = await authenticatedServer({
    enqueueProductUpdate: async (_c, _u, _id, product) => { received = product; return { updateId: 1, productId: 11, status: "PENDENTE" }; },
  });
  context.after(app.close);
  const response = await put(app, 11, { name: "Losartana", salePrice: 11.51, stock: 5, promoPrice: 7.99, promoQty: 3, promoPackagePrice: 15 });
  assert.equal(response.status, 202);
  assert.deepEqual(received.promotion, { promoPrice: 7.99, promoQty: 3, promoPackagePrice: 15 });
});

test("campos de promoção vazios pedem para encerrar a promoção", async (context) => {
  let received = null;
  const app = await authenticatedServer({
    enqueueProductUpdate: async (_c, _u, _id, product) => { received = product; return { updateId: 1, productId: 11, status: "PENDENTE" }; },
  });
  context.after(app.close);
  await put(app, 11, { name: "Losartana", salePrice: 11.51, stock: 5, promoPrice: null, promoQty: "", promoPackagePrice: null });
  assert.deepEqual(received.promotion, { promoPrice: null, promoQty: null, promoPackagePrice: null });
});

test("promoções inconsistentes são recusadas e indicam o campo", async (context) => {
  let calls = 0;
  const app = await authenticatedServer({ enqueueProductUpdate: async () => { calls += 1; return {}; } });
  context.after(app.close);
  const base = { name: "Produto", salePrice: 10, stock: 1 };
  const casos = [
    [{ promoPrice: 10 }, "promoPrice"],
    [{ promoPrice: 12 }, "promoPrice"],
    [{ promoPrice: -1 }, "promoPrice"],
    [{ promoPrice: "abc" }, "promoPrice"],
    [{ promoQty: 3 }, "promoPackagePrice"],
    [{ promoPackagePrice: 20 }, "promoQty"],
    [{ promoQty: 1, promoPackagePrice: 8 }, "promoQty"],
    [{ promoQty: 2.5, promoPackagePrice: 8 }, "promoQty"],
    [{ promoQty: 3, promoPackagePrice: 30 }, "promoPackagePrice"],
    [{ promoQty: 3, promoPackagePrice: 0 }, "promoPackagePrice"],
    [{ promoPrice: 8, promoQty: 3, promoPackagePrice: 24 }, "promoPackagePrice"],
  ];
  for (const [campos, field] of casos) {
    const response = await put(app, 11, { ...base, ...campos });
    assert.equal(response.status, 400, JSON.stringify(campos));
    assert.deepEqual(await response.json(), { error: "invalid_product_update", field }, JSON.stringify(campos));
  }
  assert.equal(calls, 0);
});

test("alteração inválida não chega ao repositório", async (context) => {
  let calls = 0;
  const app = await authenticatedServer({ enqueueProductUpdate: async () => { calls += 1; return {}; } });
  context.after(app.close);
  for (const body of [{ name: "X", salePrice: 5, stock: 1 }, { name: "Produto", salePrice: -1, stock: 1 }, { name: "Produto", salePrice: 0, stock: 1 }, { name: "Produto", salePrice: 5, stock: 1.5 }, { name: ["a"], salePrice: 5, stock: 1 }]) {
    assert.equal((await put(app, 11, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls, 0);
});

test("conflitos do balcão viram 409 com o motivo", async (context) => {
  const app = await authenticatedServer({ enqueueProductUpdate: async () => ({ conflict: "model_follows_parent" }) });
  context.after(app.close);
  const response = await put(app, 11, { name: "Produto", salePrice: 10, stock: 1 });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "model_follows_parent" });
});

test("produto de outro cliente retorna não encontrado", async (context) => {
  const app = await authenticatedServer({ enqueueProductUpdate: async () => null });
  context.after(app.close);
  assert.equal((await put(app, 999, { name: "Produto", salePrice: 10, stock: 2 })).status, 404);
});

test("serialização marca modelo, produto principal e validade", () => {
  const hoje = new Date(2026, 10, 8);
  assert.equal(serializeProduct(row({ tipo_modelo: 1 }), hoje).kind, "parent");
  assert.equal(serializeProduct(row({ tipo_modelo: 2 }), hoje).kind, "model");
  assert.equal(serializeProduct(row({ detalhes: 0 }), hoje).hasDetails, false);
  assert.equal(serializeProduct(row({ validade: "2026-11-01" }), hoje).expired, true);
  const vencendo = serializeProduct(row({ validade: "2026-12-20" }), hoje);
  assert.equal(vencendo.expiringSoon, true);
  assert.equal(vencendo.daysUntilExpiry, 42);
  assert.equal(serializeProduct(row({ promo_qtd: 3, promo_preco_pacote: null }), hoje).onPromotion, false, "pacote incompleto não é promoção");
  assert.equal(serializeProduct(row({ preco_promocional: 0 }), hoje).onPromotion, false);
  assert.equal(serializeProduct(row({ estoque: 0 }), hoje).outOfStock, true);
});

test("parseProductUpdate sem campos de promoção não toca na promoção", () => {
  assert.deepEqual(parseProductUpdate({ name: "Produto", salePrice: 10, stock: 3 }), {
    value: { name: "Produto", salePrice: 10, stock: 3, promotion: null },
  });
});

function fakePool({ products = [], updates = [], counts = {}, found = 0 } = {}) {
  const calls = [];
  return {
    calls,
    execute: async (sql, params) => {
      const text = sql.replace(/\s+/g, " ");
      calls.push({ sql: text, params });
      if (/SELECT COUNT\(\*\) AS total, SUM/.test(text)) return [[counts]];
      if (/SELECT COUNT\(\*\) AS total FROM/.test(text)) return [[{ total: found }]];
      if (/FROM clientes_sistema_produto_atualizacoes/.test(text)) return [updates];
      return [products];
    },
  };
}

test("lista de produtos usa consultas simples, filtros em SQL e liga a última alteração", async () => {
  const pool = fakePool({
    products: [row({ produto_origem_id: 1, nome: "Alfa" }), row({ produto_origem_id: 2, nome: "Beta" })],
    updates: [{ produto_origem_id: 2, status: "PENDENTE", solicitado_em: "2026-11-08 13:00:00", nome: "Beta novo", preco_venda: "22.50", estoque: 9, erro: null, preco_promocional: "19.90", promo_qtd: 3, promo_preco_pacote: "50.00", promo_alterada: 1 }],
    counts: { total: "9", promo: "2", lowstock: "1", nostock: "3", expiry: "0" },
    found: 2,
  });
  const repository = createRepository(pool);
  const result = await repository.productsByClientId(42, { search: "", filter: "all", limit: 200 });

  for (const call of pool.calls) {
    assert.doesNotMatch(call.sql, /LEFT JOIN|ult\.|p\.cliente_id/, "sem subconsulta correlacionada no JOIN");
  }
  assert.doesNotMatch(pool.calls[0].sql, /LIKE/);
  assert.deepEqual(pool.calls[0].params, [42]);
  assert.equal(result.products[0].atualizacao_status, null);
  assert.equal(result.products[1].atualizacao_status, "PENDENTE");
  assert.equal(result.products[1].atualizacao_promo_alterada, 1);
  assert.equal(result.products[1].atualizacao_preco_promocional, "19.90");
  assert.equal(result.total, 2);
  assert.deepEqual(result.counts, { all: 9, promo: 2, lowstock: 1, nostock: 3, expiry: 0 });

  pool.calls.length = 0;
  await repository.productsByClientId(42, { search: "alf", filter: "promo", limit: 10 });
  assert.match(pool.calls[0].sql, /nome LIKE \? OR codigo LIKE \?/);
  assert.match(pool.calls[0].sql, /preco_promocional > 0 OR \(promo_qtd > 0 AND promo_preco_pacote > 0\)/);
  assert.deepEqual(pool.calls[0].params, [42, "%alf%", "%alf%"]);

  pool.calls.length = 0;
  await repository.productsByClientId(42, { filter: "inventado" });
  assert.doesNotMatch(pool.calls[0].sql, /inventado/);
});

test("catálogo vazio não consulta alterações", async () => {
  const pool = fakePool({ products: [], counts: { total: 0 }, found: 0 });
  const result = await createRepository(pool).productsByClientId(42, { limit: 50 });
  assert.deepEqual(result.products, []);
  assert.ok(pool.calls.every((call) => !/produto_atualizacoes/.test(call.sql)));
});

function fakeTransactionPool(current) {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push("begin"),
    execute: async (sql, params) => {
      const text = sql.replace(/\s+/g, " ");
      events.push({ sql: text, params });
      if (/^SELECT/.test(text)) return [current ? [current] : []];
      return [{ insertId: 77 }];
    },
    commit: async () => events.push("commit"),
    rollback: async () => events.push("rollback"),
    release: () => events.push("release"),
  };
  return { events, getConnection: async () => connection };
}

const baseCurrent = { chave_licenca: "LIC", produto_origem_id: 11, nome: "Produto", preco_venda: "10.00", estoque: 5, preco_promocional: null, promo_qtd: null, promo_preco_pacote: null, tipo_modelo: 0, detalhes: 1 };

test("enfileirar grava a promoção e marca que ela foi alterada", async () => {
  const pool = fakeTransactionPool(baseCurrent);
  const result = await createRepository(pool).enqueueProductUpdate(42, 7, 11, {
    name: "Produto", salePrice: 10, stock: 5, promotion: { promoPrice: 7.99, promoQty: 3, promoPackagePrice: 15 },
  });
  assert.equal(result.status, "PENDENTE");
  const insert = pool.events.find((event) => event.sql?.startsWith("INSERT"));
  assert.deepEqual(insert.params, [42, "LIC", 11, "Produto", 10, 5, 7.99, 3, 15, 1, 7]);
  assert.ok(pool.events.includes("commit"));
});

test("enfileirar sem promoção não marca promoção como alterada", async () => {
  const pool = fakeTransactionPool(baseCurrent);
  await createRepository(pool).enqueueProductUpdate(42, 7, 11, { name: "Produto", salePrice: 10, stock: 5, promotion: null });
  const insert = pool.events.find((event) => event.sql?.startsWith("INSERT"));
  assert.deepEqual(insert.params.slice(6, 10), [null, null, null, 0]);
});

test("regras de conflito: PC antigo, modelo e produto principal de modelos", async () => {
  const promo = { promoPrice: 7, promoQty: null, promoPackagePrice: null };
  const casos = [
    [{ ...baseCurrent, detalhes: 0 }, { name: "Produto", salePrice: 10, stock: 5, promotion: promo }, "pc_update_required"],
    [{ ...baseCurrent, tipo_modelo: 2 }, { name: "Outro nome", salePrice: 10, stock: 5, promotion: null }, "model_follows_parent"],
    [{ ...baseCurrent, tipo_modelo: 2 }, { name: "Produto", salePrice: 11, stock: 5, promotion: null }, "model_follows_parent"],
    [{ ...baseCurrent, tipo_modelo: 2 }, { name: "Produto", salePrice: 10, stock: 5, promotion: promo }, "model_follows_parent"],
    [{ ...baseCurrent, tipo_modelo: 1 }, { name: "Produto", salePrice: 10, stock: 99, promotion: null }, "parent_stock_from_models"],
  ];
  for (const [current, product, expected] of casos) {
    const pool = fakeTransactionPool(current);
    const result = await createRepository(pool).enqueueProductUpdate(42, 7, 11, product);
    assert.deepEqual(result, { conflict: expected });
    assert.ok(pool.events.includes("rollback"));
    assert.ok(!pool.events.some((event) => event.sql?.startsWith("INSERT")), "nada entra na fila");
  }
});

test("modelo aceita mudar só o estoque, e produto principal aceita preço e promoção", async () => {
  const filho = fakeTransactionPool({ ...baseCurrent, tipo_modelo: 2 });
  assert.equal((await createRepository(filho).enqueueProductUpdate(42, 7, 11, { name: "Produto", salePrice: 10, stock: 99, promotion: null })).status, "PENDENTE");
  const pai = fakeTransactionPool({ ...baseCurrent, tipo_modelo: 1 });
  const promotion = { promoPrice: 9, promoQty: null, promoPackagePrice: null };
  assert.equal((await createRepository(pai).enqueueProductUpdate(42, 7, 11, { name: "Novo", salePrice: 12, stock: 5, promotion })).status, "PENDENTE");
});

test("produto inexistente não entra na fila", async () => {
  const pool = fakeTransactionPool(null);
  assert.equal(await createRepository(pool).enqueueProductUpdate(42, 7, 11, { name: "Produto", salePrice: 10, stock: 5, promotion: null }), null);
  assert.ok(pool.events.includes("rollback"));
});
