const test = require("node:test");
const assert = require("node:assert/strict");

const { tierForSpent } = require("../src/repository");
const { createApp } = require("../src/app");
const { hashPassword } = require("../src/security");

test("membro sem gasto fica no bronze", () => {
  const tier = tierForSpent(0, { silver: 300, gold: 800 });
  assert.deepEqual(tier, { level: "BRONZE", spent: 0, nextLevel: "PRATA", nextThreshold: 300, amountToNext: 300 });
});

test("gasto igual ao limiar já promove para o próximo nível", () => {
  assert.equal(tierForSpent(300, { silver: 300, gold: 800 }).level, "PRATA");
  assert.equal(tierForSpent(800, { silver: 300, gold: 800 }).level, "OURO");
});

test("nível ouro não tem próximo nível nem valor faltante", () => {
  const tier = tierForSpent(1500, { silver: 300, gold: 800 });
  assert.deepEqual(tier, { level: "OURO", spent: 1500, nextLevel: null, nextThreshold: null, amountToNext: 0 });
});

test("limiares inválidos ou ausentes caem para os padrões (300/800)", () => {
  assert.equal(tierForSpent(500, {}).level, "PRATA");
  assert.equal(tierForSpent(500, { silver: 300, gold: 100 }).level, "PRATA");
  assert.equal(tierForSpent(-50, { silver: 300, gold: 800 }).spent, 0);
});

test("atualização dos limiares de tier usa o cliente da sessão e valida os valores", async (context) => {
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
    updateClubTiers: async (clientId, silverAmount, goldAmount) => {
      received = { clientId, silverAmount, goldAmount };
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

  const invalid = await fetch(`${baseUrl}/api/club/tiers`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ silverAmount: 500, goldAmount: 200 }),
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${baseUrl}/api/club/tiers`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ silverAmount: 350, goldAmount: 900, clientId: 999 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { silverAmount: 350, goldAmount: 900 });
  assert.deepEqual(received, { clientId: 42, silverAmount: 350, goldAmount: 900 });
});

