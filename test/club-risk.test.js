const assert = require("node:assert/strict");
const test = require("node:test");
const { buildClubRiskOverview } = require("../src/repository");

test("detecta velocidade, concentração e vínculo tardio sem contar estornos", () => {
  const rows = [
    sale(1, "Ana", 7, 100, "10:00:00", "09:59:55", "PIX"),
    sale(1, "Ana", 7, 110, "10:05:00", "10:04:50", "DINHEIRO"),
    sale(1, "Ana", 7, 120, "10:10:00", "10:09:40", "DEBITO"),
    { ...sale(1, "Ana", 7, 900, "10:12:00", "10:11:55", "CREDITO"), estornado_em: "2026-08-15 10:20:00" },
  ];

  const result = buildClubRiskOverview(rows);

  assert.equal(result.monitoredSales, 4);
  assert.equal(result.reversedSales, 1);
  assert.ok(result.alerts.some((alert) => alert.type === "RAPID_PURCHASES"));
  assert.ok(result.alerts.some((alert) => alert.type === "OPERATOR_CONCENTRATION"));
  assert.ok(result.alerts.some((alert) => alert.type === "CONSECUTIVE_SALES"));
  assert.equal(result.alerts.some((alert) => alert.type === "HIGH_POINTS"), false);
  const rapid = result.alerts.find((alert) => alert.type === "RAPID_PURCHASES");
  assert.equal(rapid.relatedSales.length, 3);
  assert.deepEqual(rapid.relatedSales[0], {
    reference: "FARMASYNC-VENDA-3", saleId: 3, amount: 120, points: 120,
    paymentMethod: "DEBITO", saleChannel: "BALCAO", operatorId: "7",
    soldAt: "2026-08-15 10:10:00", linkedAt: "2026-08-15 10:09:40", reversedAt: null,
  });
});

test("sinaliza pontuação isolada muito acima da média", () => {
  const result = buildClubRiskOverview([
    sale(1, "Ana", 2, 40, "09:00:00", null, "PIX", "PHONE"),
    sale(2, "Bia", 3, 45, "10:00:00", null, "PIX", "PHONE"),
    sale(3, "Caio", 4, 900, "11:00:00", null, "PIX", "PHONE"),
  ]);

  assert.equal(result.alerts.filter((alert) => alert.type === "HIGH_POINTS").length, 1);
});

function sale(memberId, memberName, operatorId, points, time, linkedTime, payment, source = "CARD") {
  return {
    referencia_externa: `FARMASYNC-VENDA-${points / 10 - 9}`,
    membro_id: memberId, membro_nome: memberName, operador_id: operatorId,
    valor_venda: points, forma_pagamento: payment, canal_venda: "BALCAO",
    origem_vinculo: source, pontos: points,
    venda_em: `2026-08-15 ${time}`,
    vinculado_em: linkedTime ? `2026-08-15 ${linkedTime}` : null,
    estornado_em: null, criado_em: `2026-08-15 ${time}`,
  };
}