const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { hashPassword } = require("../src/security");

async function authenticatedServer(context, repository, clubAdmin) {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  const authRepository = {
    userByEmail: async () => ({
      id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => tokenHash === storedTokenHash
      ? { user_id: 7, cliente_id: 42, name: "Gestora Ana", email: "ana@farmacia.test" }
      : null,
    ...repository,
  };
  const server = createApp({ repository: authRepository, clubAdmin }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  return { baseUrl, cookie: login.headers.get("set-cookie").split(";")[0] };
}

test("campanha de aniversário usa o cliente da sessão e valida a proteção", async (context) => {
  let received = null;
  const testServer = await authenticatedServer(context, {
    updateClubBirthdayCampaign: async (clientId, enabled, points, leadDays) => {
      received = { clientId, enabled, points, leadDays };
      return true;
    },
  });

  const invalid = await fetch(`${testServer.baseUrl}/api/club/birthday-campaign`, {
    method: "PUT", headers: { cookie: testServer.cookie, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, points: 150, leadDays: -1 }),
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${testServer.baseUrl}/api/club/birthday-campaign`, {
    method: "PUT", headers: { cookie: testServer.cookie, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, points: 150, leadDays: 30, clientId: 999 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { clientId: 42, enabled: true, points: 150, leadDays: 30 });
});

test("correção da data encaminha gestor e motivo da sessão ao Clube", async (context) => {
  let forwarded = null;
  const testServer = await authenticatedServer(context, {}, {
    changeBirthDate: async (memberId, payload) => {
      forwarded = { memberId, payload };
      return { status: "UPDATED", birthDate: payload.birthDate };
    },
  });

  const response = await fetch(`${testServer.baseUrl}/api/club/members/31/birth-date`, {
    method: "PUT", headers: { cookie: testServer.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      birthDate: "1990-08-17", reason: "Cliente apresentou documento",
      clientId: 999, actorUserId: 999,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, {
    memberId: 31,
    payload: {
      clientId: 42, actorUserId: 7, actorName: "Gestora Ana",
      reason: "Cliente apresentou documento", birthDate: "1990-08-17",
    },
  });
});