const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp, sessionTokenHash } = require("../src/app");
const { hashPassword, hashTemporaryPassword, verifyPassword } = require("../src/security");

async function startTestServer(repository) {
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("dashboard usa o cliente da sessão e ignora cliente enviado pelo navegador", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let requestedClientId = null;
  let storedTokenHash = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    dashboardByClientId: async (clientId) => {
      requestedClientId = clientId;
      return { nome: "Farmácia 42", qtd_vendas_hoje: 1, valor_vendas_hoje: 25 };
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const token = decodeURIComponent(cookie.split("=")[1]);
  assert.equal(storedTokenHash, sessionTokenHash(token));

  const dashboard = await fetch(`${testServer.baseUrl}/api/dashboard?cliente_id=999`, {
    headers: { cookie },
  });
  assert.equal(dashboard.status, 200);
  assert.equal(requestedClientId, 42);
  assert.equal((await dashboard.json()).pharmacy.name, "Farmácia 42");
});

test("dashboard recusa requisição sem sessão", async (context) => {
  const repository = { health: async () => {} };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const response = await fetch(`${testServer.baseUrl}/api/dashboard`);
  assert.equal(response.status, 401);
});

test("clube usa o cliente da sessão e ignora cliente enviado pelo navegador", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let requestedClientId = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    clubOverviewByClientId: async (clientId) => {
      requestedClientId = clientId;
      return { store: { slug: "farmacia-42", name: "Farmácia 42" }, members: 3 };
    },
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/club?cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.equal(requestedClientId, 42);
  assert.equal((await response.json()).store.slug, "farmacia-42");
});

test("ajuste do Clube usa cliente e gestor da sessão", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let forwarded = null;
  const repository = {
    userByEmail: async () => ({
      id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => tokenHash === storedTokenHash
      ? { user_id: 7, cliente_id: 42, name: "Gestora Ana", email: "ana@farmacia.test" }
      : null,
  };
  const clubAdmin = {
    adjustPoints: async (memberId, payload) => {
      forwarded = { memberId, payload };
      return { status: "ADJUSTED", balance: 120 };
    },
  };
  const server = createApp({ repository, clubAdmin }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${baseUrl}/api/club/members/31/points`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      points: 20, reason: "Correção de lançamento", clientId: 999,
      actorUserId: 999, actorName: "Pessoa forjada",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, {
    memberId: 31,
    payload: {
      clientId: 42, actorUserId: 7, actorName: "Gestora Ana",
      reason: "Correção de lançamento", points: 20,
    },
  });
});

test("cadastro de cupom usa a loja da sessão e valida os dados", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let received = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    createClubCoupon: async (clientId, coupon) => {
      received = { clientId, coupon };
      return { id: 17 };
    },
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);
  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/club/coupons?cliente_id=999`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      title: "R$ 10 de desconto", description: "Em compras acima de R$ 50",
      code: " bemvindo10 ", pointsCost: 100, expiresAt: "2027-12-31T23:59:00-03:00",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 17);
  assert.equal(received.clientId, 42);
  assert.equal(received.coupon.code, "BEMVINDO10");
  assert.equal(received.coupon.pointsCost, 100);

  const invalid = await fetch(`${testServer.baseUrl}/api/club/coupons`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}",
  });
  assert.equal(invalid.status, 400);
});

test("histórico usa o cliente da sessão e respeita o período solicitado", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let requestedHistory = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    salesHistoryByClientId: async (clientId, startDate, endDate) => {
      requestedHistory = { clientId, startDate, endDate };
      return [
        { data_referencia: "2026-08-08", qtd_vendas: 2, valor_vendas: 50 },
        { data_referencia: "2026-08-09", qtd_vendas: 3, valor_vendas: 90 },
      ];
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(
    `${testServer.baseUrl}/api/sales-history?start=2026-08-08&end=2026-08-09&cliente_id=999`,
    { headers: { cookie } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(requestedHistory, {
    clientId: 42,
    startDate: "2026-08-08",
    endDate: "2026-08-09",
  });
  const history = await response.json();
  assert.equal(history.totals.salesCount, 5);
  assert.equal(history.totals.salesAmount, 140);
  assert.equal(history.totals.averageTicket, 28);
  assert.equal(history.daily.length, 2);

  const inverted = await fetch(
    `${testServer.baseUrl}/api/sales-history?start=2026-08-10&end=2026-08-09`,
    { headers: { cookie } },
  );
  assert.equal(inverted.status, 400);

  const excessive = await fetch(
    `${testServer.baseUrl}/api/sales-history?start=2025-01-01&end=2026-08-09`,
    { headers: { cookie } },
  );
  assert.equal(excessive.status, 400);
});

test("campanhas usam o cliente da sessão e não expõem segredos", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  const requestedClientIds = [];
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    campaignsByClientId: async (clientId) => {
      requestedClientIds.push(clientId);
      return [{
        campanha_origem_id: 3,
        nome: "Mês do Cliente",
        ativa: 1,
        modo: "LOCAL",
        data_inicio: "2026-08-01",
        data_fim: "2026-08-31",
        premios_json: '[{"name":"Kit de cuidados","monthlyQuantity":10}]',
        participacoes: 120,
        ganhadores: 8,
        retirados: 5,
        pendentes: 3,
        chave_licenca: "SEGREDO",
      }];
    },
    campaignWinnersByClientId: async (clientId) => {
      requestedClientIds.push(clientId);
      return [{
        campanha_nome: "Mês do Cliente",
        premio_nome: "Kit de cuidados",
        codigo_final: "7K9",
        data_hora: "2026-08-09 12:30:00",
        retirado: 0,
        codigo_completo: "NAO-PODE-SAIR",
      }];
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/campaigns?cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedClientIds, [42, 42]);
  const payload = await response.json();
  assert.equal(payload.totals.participations, 120);
  assert.equal(payload.totals.pendingPrizes, 3);
  assert.equal(payload.recentWinners[0].codeSuffix, "7K9");
  assert.equal(JSON.stringify(payload).includes("SEGREDO"), false);
  assert.equal(JSON.stringify(payload).includes("NAO-PODE-SAIR"), false);
});

test("estoque usa o cliente da sessão e não expõe preços", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  const requestedClientIds = [];
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    inventorySummaryByClientId: async (clientId) => {
      requestedClientIds.push(clientId);
      return {
        produtos_ativos: 2400,
        unidades_estoque: 18420,
        sem_estoque: 34,
        estoque_baixo: 19,
        vencidos: 4,
        vencendo_60_dias: 11,
        sem_validade: 27,
        preco_compra_total: "SEGREDO-CUSTO",
      };
    },
    inventoryAlertsByClientId: async (clientId) => {
      requestedClientIds.push(clientId);
      return [{
        produto_origem_id: 9,
        codigo: "789123",
        nome: "Produto teste",
        categoria: "Similar",
        estoque_atual: 2,
        estoque_minimo: 5,
        validade: "2026-08-20",
        sem_estoque: 0,
        estoque_baixo: 1,
        vencido: 0,
        dias_para_vencer: 11,
        preco_compra: "NAO-PUBLICAR",
      }];
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/inventory?cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedClientIds, [42, 42]);
  const payload = await response.json();
  assert.equal(payload.summary.outOfStock, 34);
  assert.equal(payload.summary.expiringSoon, 11);
  assert.equal(payload.alerts[0].name, "Produto teste");
  assert.equal(JSON.stringify(payload).includes("SEGREDO-CUSTO"), false);
  assert.equal(JSON.stringify(payload).includes("NAO-PUBLICAR"), false);
});

test("caixa usa o cliente da sessão e publica somente dados autorizados", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let requestedClientId = null;
  let requestedPeriod = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    cashSummaryByClientId: async (clientId) => {
      requestedClientId = clientId;
      return {
        data_referencia: "2026-08-09",
        sessoes_abertas: 1,
        sessoes_fechadas_hoje: 2,
        total_pagamentos_hoje: 7934.6,
        saldo_inicial_aberto: 200,
        retiradas_abertas: 300,
        suprimentos_abertos: 50,
        saldo_esperado_aberto: 2520.4,
        formas_pagamento_json: '[{"codigo":"PIX","valor":3200}]',
        sessoes_json: '[{"operador_nome":"Maria Silva","aberto_em":"2026-08-09 08:00:00","fechado_em":null}]',
        chave_licenca: "SEGREDO",
        operador_nome: "NAO-PUBLICAR",
      };
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/cash?cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(requestedClientId, 42);
  const payload = await response.json();
  assert.equal(payload.openSessions, 1);
  assert.equal(payload.paymentMethods[0].code, "PIX");
  assert.equal(payload.sessions[0].operatorName, "Maria Silva");
  assert.equal(payload.sessions[0].openedAt, "2026-08-09 08:00:00");
  assert.equal(JSON.stringify(payload).includes("SEGREDO"), false);
  assert.equal(JSON.stringify(payload).includes("NAO-PUBLICAR"), false);
});

test("entregas e fiado usam o cliente da sessão sem dados pessoais", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let requestedClientId = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    deliveryCreditSummaryByClientId: async (clientId, periodKey) => {
      requestedClientId = clientId;
      requestedPeriod = periodKey;
      return {
        data_referencia: "2026-08-09",
        periodo_inicio: "2026-08-01",
        periodo_fim: "2026-08-09",
        entregas_pendentes: 4,
        valor_entregas_pendentes: 380.5,
        entregas_urgentes: 2,
        maior_espera_entrega_minutos: 74,
        entregas_baixadas_hoje: 12,
        valor_entregas_baixadas_hoje: 920,
        tempo_medio_entrega_minutos: 31,
        fiados_pendentes: 8,
        valor_fiado_pendente: 1260.8,
        fiados_pagos_hoje: 3,
        valor_fiado_pago_hoje: 240,
        fiado_mais_antigo_dias: 18,
        cliente_nome: "NAO-PUBLICAR",
        chave_licenca: "SEGREDO",
      };
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/deliveries-credit?period=current-month&cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.equal(requestedClientId, 42);
  assert.equal(requestedPeriod, "current-month");
  const payload = await response.json();
  assert.deepEqual(payload.period, { startDate: "2026-08-01", endDate: "2026-08-09" });
  assert.equal(payload.deliveries.urgent, 2);
  assert.equal(payload.credit.pending, 8);
  assert.equal(JSON.stringify(payload).includes("NAO-PUBLICAR"), false);
  assert.equal(JSON.stringify(payload).includes("SEGREDO"), false);

  const invalid = await fetch(`${testServer.baseUrl}/api/deliveries-credit?period=all`, {
    headers: { cookie },
  });
  assert.equal(invalid.status, 400);
});

test("ações suspeitas usam o cliente da sessão e somente detalhes protegidos", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let requestedClientId = null;
  let requestedPeriod = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    suspiciousActionsByClientId: async (clientId, periodKey) => {
      requestedClientId = clientId;
      requestedPeriod = periodKey;
      return {
        periodo_inicio: "2026-08-01",
        periodo_fim: "2026-08-09",
        total_eventos: 2,
        ultimo_evento_em: "2026-08-09 11:00:00",
        categorias_json: JSON.stringify({
          categorias: [{
            codigo: "PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR",
            quantidade: 2,
            ultimo_evento_em: "2026-08-09 11:00:00",
            operador: "NAO-PUBLICAR",
          }],
          ocorrencias: [{
            codigo: "PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR",
            ocorrido_em: "2026-08-09 11:00:00",
            linhas_itens: 2,
            unidades: 3,
            valor_estimado: 49.9,
            nome_produto: "SEGREDO",
          }],
        }),
      };
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/suspicious-actions?period=current-month&cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(requestedClientId, 42);
  assert.equal(requestedPeriod, "current-month");
  const payload = await response.json();
  assert.equal(payload.total, 2);
  assert.equal(payload.occurrences.length, 1);
  assert.equal(payload.occurrences[0].estimatedAmount, 49.9);
  assert.equal(JSON.stringify(payload).includes("NAO-PUBLICAR"), false);
  assert.equal(JSON.stringify(payload).includes("SEGREDO"), false);
});

test("saúde do sincronismo usa o cliente da sessão", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let requestedClientId = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    syncHealthByClientId: async (clientId) => {
      requestedClientId = clientId;
      return { snapshot_em: new Date().toISOString(), chave_licenca: "SEGREDO" };
    },
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/sync-health?cliente_id=999`, {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(requestedClientId, 42);
  const payload = await response.json();
  assert.equal(payload.status, "current");
  assert.equal(payload.modules.length, 6);
  assert.equal(JSON.stringify(payload).includes("SEGREDO"), false);
});

test("primeiro acesso obriga trocar a senha temporária antes de liberar o painel", async (context) => {
  const temporaryCredentials = hashTemporaryPassword("123456");
  let storedTokenHash = null;
  let passwordChangeRequired = 1;
  let savedCredentials = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7,
      cliente_id: 42,
      password_salt: temporaryCredentials.salt,
      password_hash: temporaryCredentials.hash,
      password_change_required: 1,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash
        ? { user_id: 7, cliente_id: 42, password_change_required: passwordChangeRequired }
        : null
    ),
    updatePassword: async (userId, salt, hash) => {
      assert.equal(userId, 7);
      savedCredentials = { salt, hash };
      passwordChangeRequired = 0;
    },
    dashboardByClientId: async () => ({
      nome: "Farmácia 42",
      qtd_vendas_hoje: 1,
      valor_vendas_hoje: 25,
    }),
    deleteSession: async () => {},
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "123456" }),
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).passwordChangeRequired, true);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const blockedDashboard = await fetch(`${testServer.baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  assert.equal(blockedDashboard.status, 403);
  assert.equal((await blockedDashboard.json()).error, "password_change_required");

  const weakPassword = await fetch(`${testServer.baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "curta", confirmation: "curta" }),
  });
  assert.equal(weakPassword.status, 400);
  assert.equal((await weakPassword.json()).error, "weak_password");

  const changed = await fetch(`${testServer.baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      password: "nova-senha-segura-2026",
      confirmation: "nova-senha-segura-2026",
    }),
  });
  assert.equal(changed.status, 200);
  assert.equal(verifyPassword(
    "nova-senha-segura-2026",
    savedCredentials.salt,
    savedCredentials.hash,
  ), true);

  const dashboard = await fetch(`${testServer.baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  assert.equal(dashboard.status, 200);
});

test("recuperação de senha não revela contas e envia token temporário como hash", async (context) => {
  let savedReset = null;
  let sentMessage = null;
  const repository = {
    health: async () => {},
    userByEmail: async (email) => email === "gestor@farmacia.test"
      ? { id: 7, name: "Gestora Ana", email }
      : null,
    createPasswordReset: async (userId, tokenHash, expiresAt) => {
      savedReset = { userId, tokenHash, expiresAt };
    },
  };
  const passwordResetMailer = {
    sendPasswordReset: async (message) => { sentMessage = message; },
  };
  const server = createApp({
    repository,
    passwordResetMailer,
    publicBaseUrl: "https://portal.farmasync.dev.br",
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const existing = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test" }),
  });
  const missing = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "inexistente@farmacia.test" }),
  });

  assert.equal(existing.status, 202);
  assert.equal(missing.status, 202);
  assert.deepEqual(await existing.json(), await missing.json());
  assert.equal(savedReset.userId, 7);
  assert.match(savedReset.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(savedReset.expiresAt.getTime() > Date.now() + 14 * 60 * 1000);
  const resetToken = new URL(sentMessage.resetUrl).searchParams.get("token");
  assert.notEqual(resetToken, savedReset.tokenHash);
  assert.equal(sessionTokenHash(resetToken), savedReset.tokenHash);
  assert.equal(sentMessage.to, "gestor@farmacia.test");
});

test("redefinição exige token válido e senha forte", async (context) => {
  let received = null;
  const repository = {
    health: async () => {},
    resetPasswordByTokenHash: async (tokenHash, salt, hash) => {
      received = { tokenHash, salt, hash };
      return tokenHash === sessionTokenHash("token-valido");
    },
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);

  const weak = await fetch(`${testServer.baseUrl}/api/auth/reset-password`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "token-valido", password: "curta", confirmation: "curta" }),
  });
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).error, "weak_password");

  const invalid = await fetch(`${testServer.baseUrl}/api/auth/reset-password`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "token-expirado", password: "nova-senha-segura", confirmation: "nova-senha-segura" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "invalid_or_expired_token");

  const valid = await fetch(`${testServer.baseUrl}/api/auth/reset-password`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "token-valido", password: "nova-senha-segura", confirmation: "nova-senha-segura" }),
  });
  assert.equal(valid.status, 200);
  assert.equal(received.tokenHash, sessionTokenHash("token-valido"));
  assert.equal(verifyPassword("nova-senha-segura", received.salt, received.hash), true);
});

test("validade dos pontos usa somente a farmácia da sessão", async (context) => {
  const credentials = hashPassword("senha-segura-123");
  let storedTokenHash = null;
  let updated = null;
  const repository = {
    health: async () => {},
    userByEmail: async () => ({
      id: 7, cliente_id: 42,
      password_salt: credentials.salt, password_hash: credentials.hash,
    }),
    createSession: async (_userId, tokenHash) => { storedTokenHash = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (
      tokenHash === storedTokenHash ? { user_id: 7, cliente_id: 42 } : null
    ),
    updateClubPointsValidity: async (clientId, months) => {
      updated = { clientId, months };
      return true;
    },
  };
  const testServer = await startTestServer(repository);
  context.after(testServer.close);
  const login = await fetch(`${testServer.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${testServer.baseUrl}/api/club/points-validity?cliente_id=999`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ months: 18 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(updated, { clientId: 42, months: 18 });
  const invalid = await fetch(`${testServer.baseUrl}/api/club/points-validity`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ months: 3 }),
  });
  assert.equal(invalid.status, 400);
});