const SNAPSHOT_STALE_AFTER_MS = 15 * 60 * 1000;
const SNAPSHOT_INTERRUPTED_AFTER_MS = 60 * 60 * 1000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value) {
  return Math.max(0, Math.trunc(number(value)));
}

function money(value) {
  return Math.round(number(value) * 100) / 100;
}

function quantity(value) {
  return Math.round(Math.max(0, number(value)) * 1000) / 1000;
}

function buildSalesHistory(rows, startDate, endDate) {
  const rowsByDate = new Map((rows || []).map((row) => {
    const rawDate = row.data_referencia;
    const date = rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : String(rawDate || "").slice(0, 10);
    return [date, row];
  }));
  const daily = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const lastDay = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= lastDay) {
    const date = cursor.toISOString().slice(0, 10);
    const row = rowsByDate.get(date) || {};
    const salesCount = integer(row.qtd_vendas);
    const salesAmount = money(row.valor_vendas);
    daily.push({
      date,
      salesCount,
      salesAmount,
      averageTicket: salesCount > 0 ? money(salesAmount / salesCount) : 0,
      exchangesCount: integer(row.qtd_trocas),
      exchangesAmount: money(row.valor_trocas),
      returnsCount: integer(row.qtd_devolucoes),
      returnsAmount: money(row.valor_devolucoes),
      cancellationsCount: integer(row.qtd_cancelamentos),
      cancellationsAmount: money(row.valor_cancelamentos),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const totals = daily.reduce((result, day) => ({
    salesCount: result.salesCount + day.salesCount,
    salesAmount: money(result.salesAmount + day.salesAmount),
    exchangesCount: result.exchangesCount + day.exchangesCount,
    exchangesAmount: money(result.exchangesAmount + day.exchangesAmount),
    returnsCount: result.returnsCount + day.returnsCount,
    returnsAmount: money(result.returnsAmount + day.returnsAmount),
    cancellationsCount: result.cancellationsCount + day.cancellationsCount,
    cancellationsAmount: money(result.cancellationsAmount + day.cancellationsAmount),
  }), {
    salesCount: 0,
    salesAmount: 0,
    exchangesCount: 0,
    exchangesAmount: 0,
    returnsCount: 0,
    returnsAmount: 0,
    cancellationsCount: 0,
    cancellationsAmount: 0,
  });
  totals.averageTicket = totals.salesCount > 0
    ? money(totals.salesAmount / totals.salesCount)
    : 0;

  return { period: { startDate, endDate }, totals, daily };
}

function buildCampaignOverview(campaignRows, winnerRows) {
  const campaigns = (campaignRows || []).map((row) => {
    let prizes = [];
    try {
      const parsed = JSON.parse(String(row.premios_json || "[]"));
      if (Array.isArray(parsed)) {
        prizes = parsed.map((prize) => ({
          name: String(prize.name || "Prêmio").trim(),
          monthlyQuantity: integer(prize.monthlyQuantity),
        }));
      }
    } catch (_error) {
      prizes = [];
    }
    return {
      id: integer(row.campanha_origem_id),
      name: String(row.nome || "Campanha").trim(),
      active: Boolean(integer(row.ativa)),
      mode: String(row.modo || "LOCAL").trim().toUpperCase() === "ONLINE" ? "ONLINE" : "LOCAL",
      startDate: String(row.data_inicio || "").slice(0, 10),
      endDate: String(row.data_fim || "").slice(0, 10),
      prizes,
      metrics: {
        participations: integer(row.participacoes),
        winners: integer(row.ganhadores),
        withdrawn: integer(row.retirados),
        pendingPrizes: integer(row.pendentes),
      },
    };
  });
  const totals = campaigns.reduce((result, campaign) => ({
    activeCampaigns: result.activeCampaigns + (campaign.active ? 1 : 0),
    participations: result.participations + campaign.metrics.participations,
    winners: result.winners + campaign.metrics.winners,
    withdrawn: result.withdrawn + campaign.metrics.withdrawn,
    pendingPrizes: result.pendingPrizes + campaign.metrics.pendingPrizes,
  }), { activeCampaigns: 0, participations: 0, winners: 0, withdrawn: 0, pendingPrizes: 0 });
  const recentWinners = (winnerRows || []).map((row) => ({
    campaignName: String(row.campanha_nome || "Campanha").trim(),
    prizeName: String(row.premio_nome || "Prêmio").trim(),
    codeSuffix: String(row.codigo_final || "").trim().slice(-3),
    awardedAt: String(row.data_hora || "").slice(0, 19),
    withdrawn: Boolean(integer(row.retirado)),
    withdrawnAt: row.retirado_em ? String(row.retirado_em).slice(0, 19) : null,
  }));
  return { totals, campaigns, recentWinners };
}

function buildInventoryOverview(summaryRow, alertRows) {
  const summary = summaryRow || {};
  return {
    summary: {
      activeProducts: integer(summary.produtos_ativos),
      stockUnits: quantity(summary.unidades_estoque),
      stockCost: money(summary.valor_estoque_custo),
      outOfStock: integer(summary.sem_estoque),
      lowStock: integer(summary.estoque_baixo),
      expired: integer(summary.vencidos),
      expiringSoon: integer(summary.vencendo_60_dias),
      missingExpiry: integer(summary.sem_validade),
    },
    alerts: (alertRows || []).map((row) => ({
      id: integer(row.produto_origem_id),
      code: String(row.codigo || "").trim(),
      name: String(row.nome || "Produto").trim(),
      category: String(row.categoria || "Sem categoria").trim(),
      currentStock: quantity(row.estoque_atual),
      minimumStock: quantity(row.estoque_minimo),
      expiryDate: row.validade ? String(row.validade).slice(0, 10) : null,
      outOfStock: Boolean(integer(row.sem_estoque)),
      lowStock: Boolean(integer(row.estoque_baixo)),
      expired: Boolean(integer(row.vencido)),
      missingExpiry: Boolean(integer(row.sem_validade)),
      daysUntilExpiry: row.dias_para_vencer === null || row.dias_para_vencer === undefined
        ? null
        : Math.trunc(number(row.dias_para_vencer)),
    })),
  };
}

function buildCashOverview(row) {
  const summary = row || {};
  let paymentMethods = [];
  let sessions = [];
  try {
    const parsed = JSON.parse(String(summary.formas_pagamento_json || "[]"));
    if (Array.isArray(parsed)) {
      paymentMethods = parsed
        .map((item) => ({
          code: String(item?.codigo || "").trim().toUpperCase().slice(0, 50),
          amount: money(item?.valor),
        }))
        .filter((item) => item.code && item.amount > 0);
    }
  } catch (_error) {
    paymentMethods = [];
  }
  try {
    const parsed = JSON.parse(String(summary.sessoes_json || "[]"));
    if (Array.isArray(parsed)) {
      sessions = parsed.slice(0, 20).map((item) => ({
        operatorName: String(item?.operador_nome || "Não informado").trim().slice(0, 120) || "Não informado",
        openedAt: String(item?.aberto_em || "").slice(0, 19) || null,
        closedAt: String(item?.fechado_em || "").slice(0, 19) || null,
      })).filter((item) => item.openedAt);
    }
  } catch (_error) {
    sessions = [];
  }
  return {
    referenceDate: String(summary.data_referencia || "").slice(0, 10) || null,
    openSessions: integer(summary.sessoes_abertas),
    closedSessionsToday: integer(summary.sessoes_fechadas_hoje),
    totalPaymentsToday: money(summary.total_pagamentos_hoje),
    openingBalanceOpen: money(summary.saldo_inicial_aberto),
    withdrawalsOpen: money(summary.retiradas_abertas),
    suppliesOpen: money(summary.suprimentos_abertos),
    expectedBalanceOpen: money(summary.saldo_esperado_aberto),
    paymentMethods,
    sessions,
  };
}

function buildDeliveryCreditOverview(row) {
  const summary = row || {};
  const referenceDate = String(summary.data_referencia || "").slice(0, 10) || null;
  return {
    referenceDate,
    period: {
      startDate: String(summary.periodo_inicio || referenceDate || "").slice(0, 10) || null,
      endDate: String(summary.periodo_fim || referenceDate || "").slice(0, 10) || null,
    },
    deliveries: {
      pending: integer(summary.entregas_pendentes),
      pendingAmount: money(summary.valor_entregas_pendentes),
      urgent: integer(summary.entregas_urgentes),
      longestWaitMinutes: integer(summary.maior_espera_entrega_minutos),
      completedToday: integer(summary.entregas_baixadas_hoje),
      completedAmountToday: money(summary.valor_entregas_baixadas_hoje),
      averageMinutesToday: integer(summary.tempo_medio_entrega_minutos),
    },
    credit: {
      pending: integer(summary.fiados_pendentes),
      pendingAmount: money(summary.valor_fiado_pendente),
      paidToday: integer(summary.fiados_pagos_hoje),
      paidAmountToday: money(summary.valor_fiado_pago_hoje),
      oldestDays: integer(summary.fiado_mais_antigo_dias),
    },
  };
}

function buildSuspiciousActionsOverview(row) {
  const summary = row || {};
  const allowedLabels = new Map([
    ["PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR", "Pagamento cancelado sem concluir"],
    ["PDV_PAGAMENTO_CANCELADO_E_REMOCAO_PARCIAL", "Remoção após cancelar pagamento"],
    ["PDV_PAGAMENTO_CANCELADO_E_CARRINHO_ESVAZIADO", "Carrinho esvaziado após cancelamento"],
    ["OUTROS", "Outros eventos"],
  ]);
  const allowedExplanations = new Map([
    ["PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR", "A tela de pagamento foi fechada antes da conclusão da venda."],
    ["PDV_PAGAMENTO_CANCELADO_E_REMOCAO_PARCIAL", "Itens ou quantidades foram removidos após o cancelamento do pagamento."],
    ["PDV_PAGAMENTO_CANCELADO_E_CARRINHO_ESVAZIADO", "O carrinho foi esvaziado após o cancelamento do pagamento."],
  ]);
  let storedPayload = [];
  try {
    storedPayload = JSON.parse(summary.categorias_json || "[]");
  } catch (_error) {
    storedPayload = [];
  }
  const storedCategories = Array.isArray(storedPayload)
    ? storedPayload
    : storedPayload?.categorias;
  const categories = Array.isArray(storedCategories)
    ? storedCategories
      .map((item) => {
        const code = String(item?.codigo || "").trim().toUpperCase();
        if (!allowedLabels.has(code)) return null;
        return {
          code,
          label: allowedLabels.get(code),
          count: integer(item?.quantidade),
          lastEventAt: String(item?.ultimo_evento_em || "").slice(0, 19) || null,
        };
      })
      .filter(Boolean)
    : [];
  const storedOccurrences = Array.isArray(storedPayload?.ocorrencias)
    ? storedPayload.ocorrencias
    : [];
  const occurrences = storedOccurrences
    .slice(0, 100)
    .map((item) => {
      const code = String(item?.codigo || "").trim().toUpperCase();
      if (!allowedExplanations.has(code)) return null;
      return {
        code,
        label: allowedLabels.get(code),
        explanation: allowedExplanations.get(code),
        occurredAt: String(item?.ocorrido_em || "").slice(0, 19) || null,
        itemLines: integer(item?.linhas_itens),
        units: quantity(item?.unidades),
        estimatedAmount: money(item?.valor_estimado),
      };
    })
    .filter(Boolean);
  return {
    period: {
      startDate: String(summary.periodo_inicio || "").slice(0, 10) || null,
      endDate: String(summary.periodo_fim || "").slice(0, 10) || null,
    },
    total: integer(summary.total_eventos),
    lastEventAt: String(summary.ultimo_evento_em || "").slice(0, 19) || null,
    categories,
    occurrences,
  };
}

function buildDashboardSummary(row, now = new Date()) {
  if (!row) {
    return null;
  }

  const salesCount = integer(row.qtd_vendas_hoje);
  const salesAmount = money(row.valor_vendas_hoje);
  const snapshotAt = row.snapshot_em ? new Date(row.snapshot_em) : null;
  const snapshotIsValid = snapshotAt && !Number.isNaN(snapshotAt.getTime());
  const snapshotAgeMs = snapshotIsValid
    ? Math.max(0, now.getTime() - snapshotAt.getTime())
    : null;

  return {
    pharmacy: {
      name: String(row.farmacia_nome_local || row.nome || "Farmácia").trim(),
      status: String(row.status || "").trim(),
    },
    today: {
      salesCount,
      salesAmount,
      averageTicket: salesCount > 0 ? money(salesAmount / salesCount) : 0,
      exchangesCount: integer(row.qtd_trocas_hoje),
      exchangesAmount: money(row.valor_trocas_hoje),
      returnsCount: integer(row.qtd_devolucoes_hoje),
      returnsAmount: money(row.valor_devolucoes_hoje),
      cancellationsCount: integer(row.qtd_cancelamentos_hoje),
      cancellationsAmount: money(row.valor_cancelamentos_hoje),
    },
    sync: {
      snapshotAt: snapshotIsValid ? snapshotAt.toISOString() : null,
      stale: snapshotAgeMs === null || snapshotAgeMs > SNAPSHOT_STALE_AFTER_MS,
    },
  };
}

function buildSyncHealth(row, now = new Date()) {
  const snapshotAt = row?.snapshot_em ? new Date(row.snapshot_em) : null;
  const validSnapshot = snapshotAt && !Number.isNaN(snapshotAt.getTime());
  const ageMs = validSnapshot ? Math.max(0, now.getTime() - snapshotAt.getTime()) : null;
  let status = "never";
  if (ageMs !== null && ageMs <= SNAPSHOT_STALE_AFTER_MS) status = "current";
  else if (ageMs !== null && ageMs <= SNAPSHOT_INTERRUPTED_AFTER_MS) status = "attention";
  else if (ageMs !== null) status = "interrupted";

  const labels = {
    current: "Atualizado",
    attention: "Atenção",
    interrupted: "Interrompido",
    never: "Sem sincronização",
  };
  const modules = [
    ["sales", "Vendas"],
    ["campaigns", "Campanhas"],
    ["inventory", "Estoque e validade"],
    ["cash", "Caixa e pagamentos"],
    ["deliveries-credit", "Entregas e fiado"],
    ["suspicious-actions", "Ações suspeitas"],
  ].map(([id, name]) => ({
    id,
    name,
    status,
    statusLabel: labels[status],
    updatedAt: validSnapshot ? snapshotAt.toISOString() : null,
  }));

  return {
    status,
    statusLabel: labels[status],
    lastSuccessfulSyncAt: validSnapshot ? snapshotAt.toISOString() : null,
    ageMinutes: ageMs === null ? null : Math.floor(ageMs / 60000),
    expectedIntervalMinutes: 15,
    modules,
  };
}

module.exports = {
  buildCampaignOverview,
  buildCashOverview,
  buildDashboardSummary,
  buildDeliveryCreditOverview,
  buildInventoryOverview,
  buildSalesHistory,
  buildSyncHealth,
  buildSuspiciousActionsOverview,
  SNAPSHOT_STALE_AFTER_MS,
  SNAPSHOT_INTERRUPTED_AFTER_MS,
};