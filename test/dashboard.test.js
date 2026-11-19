const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCampaignOverview,
  buildCashOverview,
  buildDashboardSummary,
  buildDeliveryCreditOverview,
  buildInventoryOverview,
  buildSalesHistory,
  buildSyncHealth,
  buildSuspiciousActionsOverview,
} = require("../src/dashboard");

test("monta o resumo diário sem expor a chave de licença", () => {
  const summary = buildDashboardSummary(
    {
      nome: "Farmácia cadastrada",
      farmacia_nome_local: "Farmácia Central",
      status: "Ativo",
      chave_licenca: "SEGREDO-NAO-DEVE-SAIR",
      qtd_vendas_hoje: 4,
      valor_vendas_hoje: "150.00",
      qtd_trocas_hoje: 1,
      valor_trocas_hoje: "12.50",
      qtd_devolucoes_hoje: 0,
      valor_devolucoes_hoje: 0,
      qtd_cancelamentos_hoje: 1,
      valor_cancelamentos_hoje: 10,
      snapshot_em: "2026-08-09T14:25:00-03:00",
    },
    new Date("2026-08-09T14:30:00-03:00"),
  );

  assert.deepEqual(summary.pharmacy, {
    name: "Farmácia Central",
    status: "Ativo",
  });
  assert.equal(summary.today.averageTicket, 37.5);
  assert.equal(summary.sync.stale, false);
  assert.equal(JSON.stringify(summary).includes("SEGREDO"), false);
});

test("marca como desatualizado quando não existe snapshot válido", () => {
  const summary = buildDashboardSummary({ nome: "Farmácia Teste" });

  assert.equal(summary.today.salesAmount, 0);
  assert.equal(summary.today.averageTicket, 0);
  assert.equal(summary.sync.snapshotAt, null);
  assert.equal(summary.sync.stale, true);
});

test("histórico inclui dias sem movimento e totaliza o período", () => {
  const history = buildSalesHistory(
    [
      { data_referencia: "2026-08-01", qtd_vendas: 2, valor_vendas: 40 },
      { data_referencia: "2026-08-03", qtd_vendas: 3, valor_vendas: 90 },
    ],
    "2026-08-01",
    "2026-08-03",
  );

  assert.equal(history.daily.length, 3);
  assert.deepEqual(history.daily[1], {
    date: "2026-08-02",
    salesCount: 0,
    salesAmount: 0,
    averageTicket: 0,
    exchangesCount: 0,
    exchangesAmount: 0,
    returnsCount: 0,
    returnsAmount: 0,
    cancellationsCount: 0,
    cancellationsAmount: 0,
  });
  assert.equal(history.totals.salesCount, 5);
  assert.equal(history.totals.salesAmount, 130);
  assert.equal(history.totals.averageTicket, 26);
});

test("campanhas totalizam prêmios e descartam campos não publicados", () => {
  const overview = buildCampaignOverview(
    [{
      campanha_origem_id: 3,
      nome: "Mês do Cliente",
      ativa: 1,
      modo: "ONLINE",
      data_inicio: "2026-08-01",
      data_fim: "2026-08-31",
      premios_json: '[{"name":"Kit","monthlyQuantity":10}]',
      participacoes: 20,
      ganhadores: 4,
      retirados: 3,
      pendentes: 1,
      chave_licenca: "SEGREDO",
    }],
    [{
      campanha_nome: "Mês do Cliente",
      premio_nome: "Kit",
      codigo_final: "ABC123",
      data_hora: "2026-08-09 12:30:00",
      retirado: 0,
      codigo_completo: "NAO-PUBLICAR",
    }],
  );

  assert.equal(overview.totals.activeCampaigns, 1);
  assert.equal(overview.totals.pendingPrizes, 1);
  assert.equal(overview.campaigns[0].prizes[0].monthlyQuantity, 10);
  assert.equal(overview.recentWinners[0].codeSuffix, "123");
  assert.equal(JSON.stringify(overview).includes("SEGREDO"), false);
  assert.equal(JSON.stringify(overview).includes("NAO-PUBLICAR"), false);
});

test("estoque normaliza o resumo e publica apenas os campos operacionais", () => {
  const overview = buildInventoryOverview(
    {
      produtos_ativos: 15,
      unidades_estoque: "42.125",
      valor_estoque_custo: "1250.50",
      sem_estoque: 2,
      estoque_baixo: 3,
      vencidos: 1,
      vencendo_60_dias: 4,
      sem_validade: 5,
      chave_licenca: "SEGREDO",
    },
    [{
      produto_origem_id: 7,
      codigo: "ABC",
      nome: "Produto teste",
      categoria: "Genérico",
      estoque_atual: "2.500",
      estoque_minimo: 4,
      validade: "2026-09-01 00:00:00",
      sem_estoque: 0,
      estoque_baixo: 1,
      vencido: 0,
      sem_validade: 0,
      dias_para_vencer: 23,
      preco_venda: 99.9,
    }],
  );

  assert.equal(overview.summary.stockUnits, 42.125);
  assert.equal(overview.summary.stockCost, 1250.5);
  assert.equal(overview.alerts[0].currentStock, 2.5);
  assert.equal(overview.alerts[0].daysUntilExpiry, 23);
  assert.equal(JSON.stringify(overview).includes("SEGREDO"), false);
  assert.equal(JSON.stringify(overview).includes("99.9"), false);
});

test("caixa descarta formas inválidas e dados internos", () => {
  const overview = buildCashOverview({
    data_referencia: "2026-08-09",
    sessoes_abertas: 1,
    sessoes_fechadas_hoje: 2,
    total_pagamentos_hoje: "7934.60",
    saldo_inicial_aberto: 200,
    retiradas_abertas: 300,
    suprimentos_abertos: 50,
    saldo_esperado_aberto: 2520.4,
    formas_pagamento_json: '[{"codigo":"PIX","valor":3200},{"codigo":"","valor":50},{"codigo":"DINHEIRO","valor":2180.4}]',
    sessoes_json: '[{"operador_nome":"Maria Silva","aberto_em":"2026-08-09 08:00:00","fechado_em":null}]',
    chave_licenca: "SEGREDO",
  });

  assert.equal(overview.totalPaymentsToday, 7934.6);
  assert.equal(overview.paymentMethods.length, 2);
  assert.deepEqual(overview.paymentMethods[0], { code: "PIX", amount: 3200 });
  assert.deepEqual(overview.sessions[0], {
    operatorName: "Maria Silva", openedAt: "2026-08-09 08:00:00", closedAt: null,
  });
  assert.equal(JSON.stringify(overview).includes("SEGREDO"), false);
});

test("entregas e fiado publicam apenas indicadores agregados", () => {
  const overview = buildDeliveryCreditOverview({
    data_referencia: "2026-08-09",
    periodo_inicio: "2026-08-01",
    periodo_fim: "2026-08-09",
    entregas_pendentes: 4,
    valor_entregas_pendentes: "380.50",
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
    entregador_nome: "SEGREDO",
  });

  assert.equal(overview.deliveries.pending, 4);
  assert.deepEqual(overview.period, { startDate: "2026-08-01", endDate: "2026-08-09" });
  assert.equal(overview.deliveries.pendingAmount, 380.5);
  assert.equal(overview.credit.pendingAmount, 1260.8);
  assert.equal(JSON.stringify(overview).includes("NAO-PUBLICAR"), false);
  assert.equal(JSON.stringify(overview).includes("SEGREDO"), false);
});

test("classifica a saúde do sincronismo pela idade do último pacote", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const current = buildSyncHealth({ snapshot_em: "2026-08-10T11:50:00.000Z" }, now);
  const attention = buildSyncHealth({ snapshot_em: "2026-08-10T11:30:00.000Z" }, now);
  const interrupted = buildSyncHealth({ snapshot_em: "2026-08-10T10:00:00.000Z" }, now);
  const never = buildSyncHealth({}, now);

  assert.equal(current.status, "current");
  assert.equal(current.ageMinutes, 10);
  assert.equal(current.modules.length, 6);
  assert.equal(attention.status, "attention");
  assert.equal(interrupted.status, "interrupted");
  assert.equal(never.status, "never");
  assert.equal(never.lastSuccessfulSyncAt, null);
});

test("ações suspeitas descartam detalhes e categorias desconhecidas", () => {
  const overview = buildSuspiciousActionsOverview({
    periodo_inicio: "2026-08-01",
    periodo_fim: "2026-08-09",
    total_eventos: 3,
    ultimo_evento_em: "2026-08-09 11:00:00",
    categorias_json: JSON.stringify({
      categorias: [
        {
          codigo: "PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR",
          rotulo: "Rótulo vindo do banco",
          quantidade: 2,
          ultimo_evento_em: "2026-08-09 11:00:00",
          operador: "NAO-PUBLICAR",
        },
        { codigo: "CODIGO_INESPERADO", quantidade: 1, detalhes: "SEGREDO" },
      ],
      ocorrencias: [
        {
          codigo: "PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR",
          rotulo: "Rótulo adulterado",
          explicacao: "Texto livre não permitido",
          ocorrido_em: "2026-08-09 11:00:00",
          linhas_itens: 2,
          unidades: 3,
          valor_estimado: 49.9,
          operador: "NAO-PUBLICAR",
        },
        { codigo: "CODIGO_INESPERADO", detalhes: "SEGREDO" },
      ],
    }),
  });

  assert.equal(overview.total, 3);
  assert.equal(overview.categories.length, 1);
  assert.equal(overview.categories[0].label, "Pagamento cancelado sem concluir");
  assert.equal(overview.occurrences.length, 1);
  assert.equal(overview.occurrences[0].itemLines, 2);
  assert.equal(overview.occurrences[0].units, 3);
  assert.equal(overview.occurrences[0].estimatedAmount, 49.9);
  assert.equal(overview.occurrences[0].explanation, "A tela de pagamento foi fechada antes da conclusão da venda.");
  assert.equal(JSON.stringify(overview).includes("NAO-PUBLICAR"), false);
  assert.equal(JSON.stringify(overview).includes("SEGREDO"), false);
});