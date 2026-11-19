"use strict";

const MAX_SETTLEMENTS_PER_REQUEST = 20;
const MAX_CODE_FAILURES = 5;
const REQUEST_EXPIRES_MINUTES = 30;
const URGENT_MINUTES = 45;
const STALE_SNAPSHOT_SECONDS = 180;
const CODE_PATTERN = /^\d{4}$/;

const REQUEST_STATUSES = new Set(["PENDENTE", "PROCESSANDO", "APLICADO", "FALHOU", "EXPIRADO", "CANCELADO"]);
const RESULT_TEXT = {
  BAIXADA: "Baixada no balcão",
  BAIXADA_APP: "Baixada no balcão e concluída no aplicativo",
  JA_BAIXADA: "Já estava baixada no balcão",
};

// Pedido do portal: { deliveries: [{ saleId, code? }] }. O código de 4 dígitos é o que o cliente mostra no aplicativo.
function parseSettleRequest(body) {
  const list = body?.deliveries;
  if (!Array.isArray(list) || list.length === 0) return { error: "invalid_request" };
  if (list.length > MAX_SETTLEMENTS_PER_REQUEST) return { error: "too_many_deliveries" };
  const seen = new Set();
  const items = [];
  for (const entry of list) {
    const saleId = Number(entry?.saleId);
    if (!Number.isSafeInteger(saleId) || saleId <= 0) return { error: "invalid_sale_id" };
    if (seen.has(saleId)) continue;
    seen.add(saleId);
    const rawCode = entry?.code === undefined || entry?.code === null ? "" : String(entry.code).trim();
    if (rawCode && !CODE_PATTERN.test(rawCode)) return { error: "invalid_code", saleId };
    items.push({ saleId, code: rawCode || null });
  }
  return { value: { items } };
}

function toMillis(value) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

function serializeRequest(row) {
  if (!row) return null;
  const status = REQUEST_STATUSES.has(String(row.status)) ? String(row.status) : "PENDENTE";
  return {
    id: Number(row.id),
    status,
    result: row.resultado ? String(row.resultado) : null,
    resultText: RESULT_TEXT[row.resultado] || null,
    error: row.erro ? String(row.erro) : null,
    requestedAt: row.solicitado_em || null,
    appliedAt: row.aplicado_em || null,
    cancellable: status === "PENDENTE",
  };
}

// Junta a lista publicada pelo balcão com o andamento dos pedidos de baixa (o mais recente de cada venda).
function buildPendingDeliveries({ rows, requests, syncedAt }, now = Date.now()) {
  const latest = new Map();
  for (const request of requests || []) {
    const current = latest.get(Number(request.venda_id));
    if (!current || Number(request.id) > Number(current.id)) latest.set(Number(request.venda_id), request);
  }
  const deliveries = (rows || []).map((row) => {
    const snapshotAt = toMillis(row.snapshot_em);
    const elapsed = snapshotAt === null ? 0 : Math.max(0, Math.floor((now - snapshotAt) / 60000));
    const waitMinutes = Math.max(0, Number(row.espera_minutos) || 0) + elapsed;
    const isApp = String(row.origem) === "APP";
    return {
      saleId: Number(row.venda_id),
      time: String(row.hora_venda || ""),
      waitMinutes,
      urgent: waitMinutes >= URGENT_MINUTES,
      amount: Math.round((Number(row.valor) || 0) * 100) / 100,
      customer: String(row.cliente_nome || ""),
      deliveryPerson: String(row.entregador_nome || ""),
      payment: String(row.pagamento || ""),
      origin: isApp ? "APP" : "BALCAO",
      orderNumber: isApp ? String(row.pedido_app_numero || "") : "",
      codeRequired: isApp,
      request: serializeRequest(latest.get(Number(row.venda_id))),
    };
  });
  const syncedMs = toMillis(syncedAt);
  const ageSeconds = syncedMs === null ? null : Math.max(0, Math.floor((now - syncedMs) / 1000));
  return {
    deliveries,
    sync: {
      syncedAt: syncedMs === null ? null : syncedAt,
      ageSeconds,
      stale: ageSeconds === null || ageSeconds > STALE_SNAPSHOT_SECONDS,
    },
    limits: { maxPerRequest: MAX_SETTLEMENTS_PER_REQUEST, expiresMinutes: REQUEST_EXPIRES_MINUTES },
  };
}

module.exports = {
  MAX_CODE_FAILURES,
  MAX_SETTLEMENTS_PER_REQUEST,
  REQUEST_EXPIRES_MINUTES,
  buildPendingDeliveries,
  parseSettleRequest,
};
