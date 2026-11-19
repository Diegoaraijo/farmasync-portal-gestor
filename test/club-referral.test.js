const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createRepository } = require("../src/repository");
const { hashPassword } = require("../src/security");

test("resumo do clube detalha indicador, indicado e bônus histórico da primeira compra", async () => {
  const pool = {
    execute: async (sql) => {
      if (sql.includes("FROM clube_lojas")) return [[{
        id: 9, slug: "farmacia", nome_publico: "Farmácia", cor_principal: "#087F5B", ativa: 1,
        indicacao_pontos_bonus: 100, cashback_pontos_por_real: 100,
      }]];
      if (sql.includes("AS indicados")) return [[{ total: 2, ativos: 2, marketing: 0, indicados: 1 }]];
      if (sql.includes("saldos_membros")) return [[{ saldo: 0, vencendo_30_dias: 0, proxima_expiracao: null }]];
      if (sql.includes("COUNT(DISTINCT CASE")) return [[{ ativos: 0, ativados: 0, resgatados: 0 }]];
      if (sql.includes("FROM clube_membros indicado")) return [[{
        indicado_id: 31, indicado_nome: "Bruno Costa", indicado_telefone_final: "5678",
        indicador_id: 7, indicador_nome: "Ana Lima", indicador_telefone_final: "1234",
        bonus_indicacao_creditado: 1, indicado_em: "2026-08-01 10:00:00",
        bonus_pontos: 75, bonus_creditado_em: "2026-08-03 14:30:00",
      }]];
      return [[]];
    },
  };

  const overview = await createRepository(pool).clubOverviewByClientId(42);

  assert.deepEqual(overview.referrals, [{
    referredMemberId: 31, referredName: "Bruno Costa", referredPhoneSuffix: "5678",
    referrerMemberId: 7, referrerName: "Ana Lima", referrerPhoneSuffix: "1234",
    referredAt: "2026-08-01 10:00:00", firstPurchaseCompleted: true,
    bonusPointsEach: 75, bonusCreditedAt: "2026-08-03 14:30:00",
  }]);
  assert.equal(overview.store.referralBonusPoints, 100);
});

test("atualização do bônus de indicação usa o cliente da sessão e valida os valores", async (context) => {
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
    updateClubReferralBonus: async (clientId, points) => {
      received = { clientId, points };
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

  const invalid = await fetch(`${baseUrl}/api/club/referral-bonus`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ points: -10 }),
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${baseUrl}/api/club/referral-bonus`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ points: 75, clientId: 999 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { points: 75 });
  assert.deepEqual(received, { clientId: 42, points: 75 });
});
