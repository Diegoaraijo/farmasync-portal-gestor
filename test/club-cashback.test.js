const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { hashPassword } = require("../src/security");

test("atualização da taxa de cashback usa o cliente da sessão e valida o valor", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let received = null;
  const repository = {
    userByEmail: async () => ({
      id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    updateClubCashbackRate: async (clientId, pointsPerReal) => {
      received = { clientId, pointsPerReal };
      return true;
    },
  };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const invalid = await fetch(`${baseUrl}/api/club/cashback-rate`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ pointsPerReal: 0 }),
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${baseUrl}/api/club/cashback-rate`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ pointsPerReal: 150, clientId: 999 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { pointsPerReal: 150 });
  assert.deepEqual(received, { clientId: 42, pointsPerReal: 150 });
});

test("administração de cashback usa o cliente da sessão e encaminha motivo", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  const received = [];
  const repository = {
    userByEmail: async () => ({
      id: 7, cliente_id: 42, name: "Gestora", password_salt: credentials.salt, password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42, name: "Gestora" } : null
    ),
  };
  const clubAdmin = {
    setCashbackBlocked: async (memberId, payload) => { received.push(["block", memberId, payload]); return { status: "CASHBACK_BLOCKED" }; },
    grantManualCashback: async (memberId, payload) => { received.push(["grant", memberId, payload]); return { status: "GRANTED" }; },
    cancelCashback: async (cashbackId, payload) => { received.push(["cancel", cashbackId, payload]); return { status: "CANCELED" }; },
  };
  const server = createApp({ repository, clubAdmin }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestora@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "content-type": "application/json" };

  assert.equal((await fetch(`${baseUrl}/api/club/members/31/cashback-block`, {
    method: "PUT", headers, body: JSON.stringify({ blocked: true, reason: "Uso fora da política", clientId: 999 }),
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/club/members/31/cashback`, {
    method: "POST", headers, body: JSON.stringify({ amount: 12.5, reason: "Compensação aprovada" }),
  })).status, 201);
  assert.equal((await fetch(`${baseUrl}/api/club/cashbacks/15/cancel`, {
    method: "POST", headers, body: JSON.stringify({ memberId: 31, reason: "Conversão duplicada" }),
  })).status, 200);

  assert.deepEqual(received, [
    ["block", 31, { clientId: 42, actorUserId: 7, actorName: "Gestora", reason: "Uso fora da política", blocked: true }],
    ["grant", 31, { clientId: 42, actorUserId: 7, actorName: "Gestora", reason: "Compensação aprovada", amount: 12.5 }],
    ["cancel", 15, { clientId: 42, actorUserId: 7, actorName: "Gestora", reason: "Conversão duplicada", memberId: 31 }],
  ]);
});
