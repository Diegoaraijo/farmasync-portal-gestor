const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp, sessionTokenHash } = require("../src/app");
const { hashPassword } = require("../src/security");

const DAY = 24 * 60 * 60;

async function startServer(sessionOverrides = {}) {
  const credentials = hashPassword("senha-segura-123");
  const state = { created: null, renewed: null, storedHash: null };
  const repository = {
    health: async () => {},
    userByEmail: async () => ({ id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash }),
    createSession: async (userId, tokenHash, expiresAt, remember) => {
      state.storedHash = tokenHash;
      state.created = { userId, expiresAt, remember };
    },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === state.storedHash ? { user_id: 7, cliente_id: 42, ...sessionOverrides } : null
    ),
    renewSession: async (tokenHash, expiresAt) => { state.renewed = { tokenHash, expiresAt }; },
    deleteSession: async () => {},
    dashboardByClientId: async () => ({ nome: "Farmácia 42", qtd_vendas_hoje: 1, valor_vendas_hoje: 25 }),
    updatePointsValidity: async () => {},
  };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    state,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function login(baseUrl, extra = {}) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123", ...extra }),
  });
  assert.equal(response.status, 200);
  return response;
}

function put(baseUrl, cookie, path = "/api/club/points-validity") {
  return fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
}

test("sem 'manter conectado' a sessão continua durando 12 horas", async (context) => {
  const server = await startServer();
  context.after(server.close);
  const response = await login(server.baseUrl);
  assert.equal(server.state.created.remember, false);
  assert.match(response.headers.get("set-cookie"), /Max-Age=43200/);
  assert.ok(Math.abs(server.state.created.expiresAt.getTime() - Date.now() - 12 * 3600 * 1000) < 5000);
});

test("'manter conectado' cria sessão de 30 dias", async (context) => {
  const server = await startServer();
  context.after(server.close);
  const response = await login(server.baseUrl, { remember: true });
  assert.equal(server.state.created.remember, true);
  assert.match(response.headers.get("set-cookie"), /Max-Age=2592000/);
  assert.ok(Math.abs(server.state.created.expiresAt.getTime() - Date.now() - 30 * DAY * 1000) < 5000);
});

test("só o valor booleano true liga o 'manter conectado'", async (context) => {
  const server = await startServer();
  context.after(server.close);
  await login(server.baseUrl, { remember: "true" });
  assert.equal(server.state.created.remember, false);
});

test("sessão longa antiga lê dados, mas alterações pedem a senha de novo", async (context) => {
  const server = await startServer({ remember: 1, age_seconds: 3 * DAY, seconds_left: 27 * DAY });
  context.after(server.close);
  const cookie = (await login(server.baseUrl, { remember: true })).headers.get("set-cookie").split(";")[0];

  const read = await fetch(`${server.baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(read.status, 200);

  const write = await put(server.baseUrl, cookie);
  assert.equal(write.status, 403);
  assert.deepEqual(await write.json(), { error: "reauth_required" });

  const logout = await fetch(`${server.baseUrl}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
  assert.equal(logout.status, 200);
});

test("sessão longa com login recente (menos de 12 h) pode alterar dados", async (context) => {
  const server = await startServer({ remember: 1, age_seconds: 3600, seconds_left: 30 * DAY });
  context.after(server.close);
  const cookie = (await login(server.baseUrl, { remember: true })).headers.get("set-cookie").split(";")[0];
  const write = await put(server.baseUrl, cookie);
  assert.notEqual((await write.json()).error, "reauth_required");
});

test("sessão curta não exige reautenticação extra", async (context) => {
  const server = await startServer({ remember: 0, age_seconds: 11 * 3600, seconds_left: 3600 });
  context.after(server.close);
  const cookie = (await login(server.baseUrl)).headers.get("set-cookie").split(";")[0];
  const write = await put(server.baseUrl, cookie);
  assert.notEqual((await write.json()).error, "reauth_required");
});

test("sessão longa é renovada no uso quando falta menos de 29 dias", async (context) => {
  const server = await startServer({ remember: 1, age_seconds: 20 * DAY, seconds_left: 10 * DAY });
  context.after(server.close);
  const cookie = (await login(server.baseUrl, { remember: true })).headers.get("set-cookie").split(";")[0];
  const read = await fetch(`${server.baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(read.status, 200);
  assert.equal(server.state.renewed.tokenHash, sessionTokenHash(decodeURIComponent(cookie.split("=")[1])));
  assert.ok(Math.abs(server.state.renewed.expiresAt.getTime() - Date.now() - 30 * DAY * 1000) < 5000);
  assert.match(read.headers.get("set-cookie"), /Max-Age=2592000/);
});

test("sessão longa recém-renovada não grava no banco a cada requisição", async (context) => {
  const server = await startServer({ remember: 1, age_seconds: 2 * DAY, seconds_left: 30 * DAY - 60 });
  context.after(server.close);
  const cookie = (await login(server.baseUrl, { remember: true })).headers.get("set-cookie").split(";")[0];
  await fetch(`${server.baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(server.state.renewed, null);
});

test("sessão curta nunca é renovada", async (context) => {
  const server = await startServer({ remember: 0, age_seconds: 3600, seconds_left: 600 });
  context.after(server.close);
  const cookie = (await login(server.baseUrl)).headers.get("set-cookie").split(";")[0];
  await fetch(`${server.baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(server.state.renewed, null);
});
