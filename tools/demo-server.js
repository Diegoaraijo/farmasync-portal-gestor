const { createApp } = require("../src/app");
const { hashPassword, hashTemporaryPassword } = require("../src/security");

const port = Number(process.env.PORT || 3100);
const credentials = hashPassword("demonstracao-123");
let firstAccessCredentials = hashTemporaryPassword("123456");
let firstAccessRequired = 1;
const sessions = new Map();
let demoCoupons = [
  { id: 1, title: "R$ 10 de desconto", description: "Em compras acima de R$ 60", code: "CLUBE10", pointsCost: 120, expiresAt: "2027-12-31 23:59:00", active: true, activations: 42, redemptions: 31 },
  { id: 2, title: "Entrega grátis", description: "Válido no raio de atendimento da loja", code: "ENTREGAGRATIS", pointsCost: 80, expiresAt: "2027-10-31 23:59:00", active: true, activations: 27, redemptions: 19 },
  { id: 3, title: "Boas-vindas", description: "Benefício da campanha de lançamento", code: "BEMVINDO", pointsCost: 0, expiresAt: "2027-06-30 23:59:00", active: false, activations: 86, redemptions: 72 },
];
let demoPointsValidity = 12;
let demoTierThresholds = { silver: 300, gold: 800 };
let demoReferralBonusPoints = 50;
let demoCashbackPointsPerReal = 100;
let demoCashbacks = [
  { id: 101, memberId: 31, memberName: "Ana Souza", amount: 12.5, origin: "CONVERSAO", state: "PENDENTE", createdAt: "2026-08-18 14:20:00" },
  { id: 102, memberId: 32, memberName: "Carlos Lima", amount: 8, origin: "MANUAL", state: "RESERVADO", createdAt: "2026-08-18 13:10:00" },
  { id: 103, memberId: 33, memberName: "Mariana Alves", amount: 18.75, origin: "CONVERSAO", state: "USADO", createdAt: "2026-08-17 16:35:00" },
  { id: 104, memberId: 34, memberName: "João Santos", amount: 5, origin: "MANUAL", state: "CANCELADO", createdAt: "2026-08-16 11:40:00" },
];
let demoProducts = [
  { produto_origem_id: 1, codigo: "789123450001", nome: "Dipirona 500mg 20 comprimidos", categoria: "Genérico", preco_venda: 12.5, preco_promocional: 9.9, estoque: 7, estoque_minimo: 10, validade: "2027-03-10", tipo_modelo: 0, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 2, codigo: "789123450002", nome: "Protetor solar FPS 50 120ml", categoria: "Dermocosmético", preco_venda: 49.9, estoque: 0, estoque_minimo: 3, validade: "2026-11-30", tipo_modelo: 0, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 3, codigo: "789123450003", nome: "Amoxicilina 500mg 21 cápsulas", categoria: "Ético", preco_venda: 31.75, estoque: 3, estoque_minimo: 8, validade: "2026-08-22", tipo_modelo: 0, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 4, codigo: "789123450004", nome: "Vitamina C 1g 10 comprimidos", categoria: "Similar", preco_venda: 18.9, promo_qtd: 3, promo_preco_pacote: 45, estoque: 12, estoque_minimo: 5, validade: "2026-09-12", tipo_modelo: 0, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 5, codigo: "789123450005", nome: "Camiseta esportiva", categoria: "Diversos", preco_venda: 59.9, estoque: 0, tipo_modelo: 1, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 6, codigo: "789123450006", nome: "Camiseta esportiva - M", categoria: "Diversos", preco_venda: 59.9, estoque: 4, tipo_modelo: 2, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 7, codigo: "789123450007", nome: "Shampoo antiqueda 200ml (PC sem atualização)", categoria: "", preco_venda: 22, estoque: 6, tipo_modelo: 0, detalhes: 0, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 8, fator_conversao_padrao: 12, unidade_compra: "CX", codigo: "7891234567895", nome: "Dipirona 500mg 20 comprimidos (NF de teste)", categoria: "Genérico", preco_venda: 8.5, preco_promocional: 7.9, estoque: 4, estoque_minimo: 5, validade: "2027-01-10", tipo_modelo: 0, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  { produto_origem_id: 9, codigo: "7899999999994", nome: "Amoxicilina com modelos (NF de teste)", categoria: "Ético", preco_venda: 30, estoque: 0, tipo_modelo: 1, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString() },
  ...Array.from({ length: 120 }, (_, i) => ({
    produto_origem_id: 1000 + i, codigo: `7891000${String(i).padStart(6, "0")}`,
    nome: `Produto de teste ${String(i + 1).padStart(3, "0")} com nome comprido para conferir a quebra de linha`,
    categoria: "Similar", preco_venda: 5 + (i % 40) * 1.35, estoque: (i * 7) % 60, estoque_minimo: 5,
    preco_promocional: i % 9 === 0 ? 4 + (i % 40) * 1.1 : null, tipo_modelo: 0, detalhes: 1, ativo: 1, snapshot_em: new Date().toISOString(),
  })),
];
const demoNotes = [];
const demoDeliveries = [
  { venda_id: 128, hora_venda: "09:10", espera_minutos: 95, valor: 84.9, cliente_nome: "Maria S.", entregador_nome: "Carlos L.", pagamento: "Dinheiro", origem: "BALCAO", pedido_app_numero: "" },
  { venda_id: 131, hora_venda: "10:05", espera_minutos: 40, valor: 52.5, cliente_nome: "João P.", entregador_nome: "Carlos L.", pagamento: "Pix", origem: "BALCAO", pedido_app_numero: "" },
  { venda_id: 134, hora_venda: "10:30", espera_minutos: 15, valor: 136.2, cliente_nome: "Ana C.", entregador_nome: "Rita M.", pagamento: "Pago no app", origem: "APP", pedido_app_numero: "A1B2C3" },
];
const demoSettlements = [];
const demoExtraAlerts = Array.from({ length: 45 }, (_, i) => ({
  produto_origem_id: 100 + i, codigo: `7891999${String(i).padStart(5, "0")}`, nome: `Produto em atenção ${i + 1}`,
  categoria: "Similar", estoque_atual: i % 4, estoque_minimo: 6, validade: "2026-12-01",
  sem_estoque: i % 4 === 0 ? 1 : 0, estoque_baixo: i % 4 === 0 ? 0 : 1, vencido: 0, sem_validade: 0, dias_para_vencer: 20 + i,
}));

const repository = {
  async health() {},
  async userByEmail(email) {
    if (email === "primeiro@demo.local") {
      return {
        id: 2,
        cliente_id: 1,
        password_salt: firstAccessCredentials.salt,
        password_hash: firstAccessCredentials.hash,
        password_change_required: firstAccessRequired,
      };
    }
    if (email !== "gestor@demo.local") return null;
    return {
      id: 1,
      cliente_id: 1,
      password_salt: credentials.salt,
      password_hash: credentials.hash,
    };
  },
  async createSession(userId, tokenHash) { sessions.set(tokenHash, userId); },
  async sessionByTokenHash(tokenHash) {
    const userId = sessions.get(tokenHash);
    if (!userId) return null;
    return {
      user_id: userId,
      cliente_id: 1,
      password_change_required: userId === 2 ? firstAccessRequired : 0,
    };
  },
  async updatePassword(userId, salt, hash) {
    if (userId !== 2) return;
    firstAccessCredentials = { salt, hash };
    firstAccessRequired = 0;
  },
  async deleteSession(tokenHash) { sessions.delete(tokenHash); },
  async dashboardByClientId() {
    return {
      nome: "Farmácia Modelo",
      farmacia_nome_local: "Farmácia Modelo Centro",
      status: "Ativo",
      qtd_vendas_hoje: 84,
      valor_vendas_hoje: 7934.6,
      qtd_trocas_hoje: 3,
      valor_trocas_hoje: 117.9,
      qtd_devolucoes_hoje: 1,
      valor_devolucoes_hoje: 42.5,
      qtd_cancelamentos_hoje: 2,
      valor_cancelamentos_hoje: 89.8,
      snapshot_em: new Date().toISOString(),
    };
  },
  async syncHealthByClientId() {
    return { snapshot_em: new Date(Date.now() - 4 * 60 * 1000).toISOString() };
  },
  async salesHistoryByClientId(_clientId, startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const rows = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.getUTCDate();
      if (cursor.getUTCDay() === 0) continue;
      const salesCount = 38 + ((day * 7) % 51);
      rows.push({
        data_referencia: cursor.toISOString().slice(0, 10),
        qtd_vendas: salesCount,
        valor_vendas: Number((salesCount * (76 + (day % 24))).toFixed(2)),
        qtd_trocas: day % 4,
        valor_trocas: (day % 4) * 31.5,
        qtd_devolucoes: day % 3 === 0 ? 1 : 0,
        valor_devolucoes: day % 3 === 0 ? 42.5 : 0,
        qtd_cancelamentos: day % 5 === 0 ? 1 : 0,
        valor_cancelamentos: day % 5 === 0 ? 67.9 : 0,
      });
    }
    return rows;
  },
  async campaignsByClientId() {
    return [
      {
        campanha_origem_id: 3,
        nome: "Mês do Cliente",
        ativa: 1,
        modo: "ONLINE",
        data_inicio: "2026-08-01",
        data_fim: "2026-08-31",
        premios_json: '[{"name":"Kit de cuidados","monthlyQuantity":20},{"name":"Vale-compras de R$ 50","monthlyQuantity":10}]',
        participacoes: 286,
        ganhadores: 18,
        retirados: 12,
        pendentes: 6,
      },
      {
        campanha_origem_id: 2,
        nome: "Férias com Saúde",
        ativa: 0,
        modo: "LOCAL",
        data_inicio: "2026-07-01",
        data_fim: "2026-07-31",
        premios_json: '[{"name":"Necessaire FarmaSync","monthlyQuantity":15}]',
        participacoes: 194,
        ganhadores: 13,
        retirados: 13,
        pendentes: 0,
      },
    ];
  },
  async campaignWinnersByClientId() {
    return [
      { campanha_nome: "Mês do Cliente", premio_nome: "Kit de cuidados", codigo_final: "7K9", data_hora: "2026-08-09 12:30:00", retirado: 0, retirado_em: null },
      { campanha_nome: "Mês do Cliente", premio_nome: "Vale-compras de R$ 50", codigo_final: "2F4", data_hora: "2026-08-08 16:12:00", retirado: 1, retirado_em: "2026-08-09 09:20:00" },
      { campanha_nome: "Mês do Cliente", premio_nome: "Kit de cuidados", codigo_final: "9M1", data_hora: "2026-08-07 10:05:00", retirado: 0, retirado_em: null },
    ];
  },
  async clubOverviewByClientId() {
    return {
      store: {
        slug: "farmacia-modelo", name: "Farmácia Modelo", color: "#087F5B", active: true,
        pointsValidityMonths: demoPointsValidity, tierThresholds: demoTierThresholds,
        referralBonusPoints: demoReferralBonusPoints, cashbackPointsPerReal: demoCashbackPointsPerReal,
      },
      metrics: {
        members: 184, activeMembers: 179, marketingMembers: 131, pointsBalance: 12840,
        pointsExpiring30Days: 680, nextPointsExpiration: "2026-09-03",
        activeCoupons: demoCoupons.filter((coupon) => coupon.active).length,
        activatedCoupons: demoCoupons.reduce((total, coupon) => total + coupon.activations, 0),
        redeemedCoupons: demoCoupons.reduce((total, coupon) => total + coupon.redemptions, 0),
        referredMembers: 37,
        tierDistribution: { BRONZE: 92, PRATA: 61, OURO: 26 },
        cashback: { issuedCount: 42, issuedAmount: 318.5, openCount: 8, openAmount: 64.3, redeemedCount: 30, redeemedAmount: 214.2, canceledCount: 4, canceledAmount: 40 },
      },
      recentMembers: [
        { id: 31, name: "Ana Souza", phoneSuffix: "7788", joinedAt: "2026-08-12 14:30:00", balance: 320, active: true, cashbackBlocked: false, tier: "PRATA" },
        { id: 32, name: "Carlos Lima", phoneSuffix: "1042", joinedAt: "2026-08-12 11:18:00", balance: 180, active: true, cashbackBlocked: true, tier: "BRONZE" },
        { id: 33, name: "Mariana Alves", phoneSuffix: "9631", joinedAt: "2026-08-11 17:05:00", balance: 540, active: true, cashbackBlocked: false, tier: "OURO" },
        { id: 34, name: "João Santos", phoneSuffix: "2260", joinedAt: "2026-08-11 09:42:00", balance: 75, active: true, cashbackBlocked: false, tier: "BRONZE" },
      ],
      referrals: [
        { referredMemberId: 33, referredName: "Mariana Alves", referredPhoneSuffix: "9631", referrerMemberId: 31, referrerName: "Ana Souza", referrerPhoneSuffix: "7788", referredAt: "2026-08-11 17:05:00", firstPurchaseCompleted: true, bonusPointsEach: 50, bonusCreditedAt: "2026-08-12 09:25:00" },
        { referredMemberId: 34, referredName: "João Santos", referredPhoneSuffix: "2260", referrerMemberId: 32, referrerName: "Carlos Lima", referrerPhoneSuffix: "1042", referredAt: "2026-08-11 09:42:00", firstPurchaseCompleted: false, bonusPointsEach: null, bonusCreditedAt: null },
      ],
      cashbacks: demoCashbacks,
      coupons: demoCoupons,
      riskMonitoring: {
        periodDays: 30, monitoredSales: 128, reversedSales: 4, alertCount: 1,
        alerts: [{
          type: "RAPID_PURCHASES", severity: "high", title: "Muitas compras em poucos minutos",
          detail: "3 compras pontuadas em até 15 minutos.", memberId: 31,
          memberName: "Ana Souza", operatorId: "7", lastEventAt: "2026-08-15 10:10:00",
          relatedSales: [
            { reference: "FARMASYNC-VENDA-381", saleId: 381, amount: 120, points: 120, paymentMethod: "DEBITO", saleChannel: "BALCAO", operatorId: "7", soldAt: "2026-08-15 10:10:00", linkedAt: "2026-08-15 10:09:40", reversedAt: null },
            { reference: "FARMASYNC-VENDA-380", saleId: 380, amount: 110, points: 110, paymentMethod: "DINHEIRO", saleChannel: "BALCAO", operatorId: "7", soldAt: "2026-08-15 10:05:00", linkedAt: "2026-08-15 10:04:50", reversedAt: null },
            { reference: "FARMASYNC-VENDA-379", saleId: 379, amount: 100, points: 100, paymentMethod: "PIX", saleChannel: "BALCAO", operatorId: "7", soldAt: "2026-08-15 10:00:00", linkedAt: "2026-08-15 09:59:55", reversedAt: null },
          ],
        }],
      },
    };
  },
  async updateClubPointsValidity(_clientId, months) {
    demoPointsValidity = months;
    return true;
  },
  async updateClubTiers(_clientId, silverAmount, goldAmount) {
    demoTierThresholds = { silver: silverAmount, gold: goldAmount };
    return true;
  },
  async updateClubReferralBonus(_clientId, points) {
    demoReferralBonusPoints = points;
    return true;
  },
  async updateClubCashbackRate(_clientId, pointsPerReal) {
    demoCashbackPointsPerReal = pointsPerReal;
    return true;
  },
  async createClubCoupon(_clientId, coupon) {
    const created = { id: Math.max(0, ...demoCoupons.map((item) => item.id)) + 1, ...coupon, activations: 0, redemptions: 0 };
    created.expiresAt = coupon.expiresAt.toISOString().replace("T", " ").slice(0, 19);
    demoCoupons = [created, ...demoCoupons];
    return { id: created.id };
  },
  async updateClubCoupon(_clientId, couponId, coupon) {
    const index = demoCoupons.findIndex((item) => item.id === couponId);
    if (index < 0) return false;
    demoCoupons[index] = {
      ...demoCoupons[index], ...coupon,
      expiresAt: coupon.expiresAt.toISOString().replace("T", " ").slice(0, 19),
    };
    return true;
  },
  async inventorySummaryByClientId() {
    return {
      produtos_ativos: 2384,
      unidades_estoque: 18420,
      valor_estoque_custo: 126840.55,
      sem_estoque: 34,
      estoque_baixo: 19,
      vencidos: 4,
      vencendo_60_dias: 11,
      sem_validade: 27,
    };
  },
  async inventoryAlertsByClientId() {
    return [
      { produto_origem_id: 1, codigo: "789123450001", nome: "Dipirona 500mg 20 comprimidos", categoria: "Genérico", estoque_atual: 7, estoque_minimo: 4, validade: "2026-08-03", sem_estoque: 0, estoque_baixo: 0, vencido: 1, sem_validade: 0, dias_para_vencer: -6 },
      { produto_origem_id: 2, codigo: "789123450002", nome: "Protetor solar FPS 50 120ml", categoria: "Perfumaria", estoque_atual: 0, estoque_minimo: 5, validade: "2027-03-20", sem_estoque: 1, estoque_baixo: 0, vencido: 0, sem_validade: 0, dias_para_vencer: 223 },
      { produto_origem_id: 3, codigo: "789123450003", nome: "Amoxicilina 500mg 21 cápsulas", categoria: "Ético", estoque_atual: 3, estoque_minimo: 8, validade: "2026-08-22", sem_estoque: 0, estoque_baixo: 1, vencido: 0, sem_validade: 0, dias_para_vencer: 13 },
      { produto_origem_id: 4, codigo: "789123450004", nome: "Vitamina C 1g 10 comprimidos", categoria: "Similar", estoque_atual: 12, estoque_minimo: 5, validade: "2026-09-12", sem_estoque: 0, estoque_baixo: 0, vencido: 0, sem_validade: 0, dias_para_vencer: 34 },
      { produto_origem_id: 5, codigo: "789123450005", nome: "Sabonete líquido neutro 250ml", categoria: "Perfumaria", estoque_atual: 9, estoque_minimo: 3, validade: null, sem_estoque: 0, estoque_baixo: 0, vencido: 0, sem_validade: 1, dias_para_vencer: null },
            ...demoExtraAlerts,
          ];
        },
        async productsByClientId(_clientId, options = {}) {
    const term = String(options.search || "").trim().toLocaleLowerCase("pt-BR");
    const limit = Number(options.limit) || 200;
    const onPromo = (p) => Boolean(p.preco_promocional || (p.promo_qtd && p.promo_preco_pacote));
    const days = (p) => (p.validade ? Math.round((Date.parse(`${p.validade}T12:00:00Z`) - Date.now()) / 86400000) : null);
    const tests = {
      all: () => true,
      promo: onPromo,
      lowstock: (p) => p.estoque > 0 && p.estoque_minimo > 0 && p.estoque <= p.estoque_minimo,
      nostock: (p) => p.estoque <= 0,
      expiry: (p) => p.estoque > 0 && days(p) !== null && days(p) <= 60,
    };
    const matching = demoProducts.filter((product) => (
      !term || `${product.nome} ${product.codigo}`.toLocaleLowerCase("pt-BR").includes(term)
    ));
    const counts = Object.fromEntries(Object.entries(tests).map(([key, test]) => [key, matching.filter(test).length]));
    const filtered = matching.filter(tests[options.filter] || tests.all);
    return { products: filtered.slice(0, limit), total: filtered.length, counts };
  },
  async enqueueProductUpdate(_clientId, _userId, productId, product) {
    const index = demoProducts.findIndex((item) => item.produto_origem_id === productId);
    if (index < 0) return null;
    const current = demoProducts[index];
    if (product.promotion && !current.detalhes) return { conflict: "pc_update_required" };
    if (current.tipo_modelo === 2 && (product.promotion || product.name !== current.nome || product.salePrice !== current.preco_venda)) {
      return { conflict: "model_follows_parent" };
    }
    if (current.tipo_modelo === 1 && product.stock !== current.estoque) return { conflict: "parent_stock_from_models" };
    const promo = product.promotion;
    demoProducts[index] = {
      ...current,
      nome: product.name,
      preco_venda: product.salePrice,
      estoque: product.stock,
      ...(promo ? { preco_promocional: promo.promoPrice, promo_qtd: promo.promoQty, promo_preco_pacote: promo.promoPackagePrice } : {}),
      atualizacao_status: "APLICADO",
      atualizacao_solicitada_em: new Date().toISOString(),
      atualizacao_nome: product.name,
      atualizacao_preco_venda: product.salePrice,
      atualizacao_estoque: product.stock,
      snapshot_em: new Date().toISOString(),
    };
    return { updateId: Date.now(), productId, status: "PENDENTE" };
  },
  async matchCatalogProducts(_clientId, sources) {
    const normalize = (code) => {
      const compact = String(code ?? "").replace(/\s+/g, "");
      return /^\d+$/.test(compact) ? (compact.replace(/^0+/, "") || "0") : compact.toUpperCase();
    };
    return sources.map((source) => (
      source.codeCandidates.map((code) => demoProducts.find((product) => product.codigo === code)).find(Boolean)
      || source.codeCandidates.map((code) => demoProducts.find((product) => normalize(product.codigo) === normalize(code))).find(Boolean)
      || null
    ));
  },
  async activePurchaseNote(_clientId, key) {
    return demoNotes.find((note) => note.chave_ativa === key) || null;
  },
  async enqueuePurchaseNote(_clientId, _userId, note) {
    if (demoNotes.some((entry) => entry.chave_ativa === note.dedupeKey)) {
      const existing = demoNotes.find((entry) => entry.chave_ativa === note.dedupeKey);
      return { duplicate: true, existingId: existing.id, existingStatus: existing.status };
    }
    const row = {
      id: demoNotes.length + 1, origem: note.origin, chave_nfe: note.accessKey, chave_ativa: note.dedupeKey, chave_dedupe: note.dedupeKey,
      numero_nf: note.number, serie: note.series, emissao: note.issueDate, fornecedor_nome: note.supplier.name,
      fornecedor_documento: note.supplier.document, valor_nf: note.totals.invoice, total_itens: note.items.length,
      status: "PENDENTE", itens_atualizados: 0, itens_criados: 0, itens_ignorados: 0, erro: null,
      itens_json: JSON.stringify(note.items), extras_json: JSON.stringify({ installments: note.installments, options: note.options }),
      resultado_json: null, observacoes: note.notes, solicitado_em: new Date().toISOString(), aplicado_em: null,
    };
    demoNotes.unshift(row);
    // Simula o balcão: pega a nota depois de alguns segundos e lança no estoque de demonstração.
    setTimeout(() => { if (row.status === "PENDENTE") row.status = "PROCESSANDO"; }, 4000);
    setTimeout(() => {
      if (row.status !== "PROCESSANDO") return;
      if (/falha/i.test(row.fornecedor_nome)) {
        row.status = "FALHOU";
        row.chave_ativa = null;
        row.erro = "Esta NF-e já foi importada no sistema. Não é permitido dar entrada novamente com a mesma nota.";
        return;
      }
      const outcomes = [];
      for (const item of note.items) {
        const product = demoProducts.find((entry) => item.codeCandidates.includes(entry.codigo));
        if (product) {
          product.estoque += item.quantity;
          product.preco_venda = item.salePrice;
          row.itens_atualizados += 1;
          outcomes.push({ index: item.index, outcome: "ATUALIZADO", message: null });
        } else if (item.createIfMissing) {
          demoProducts.push({ produto_origem_id: 5000 + demoProducts.length, codigo: item.code, nome: item.description, categoria: item.category, preco_venda: item.salePrice, estoque: item.quantity, tipo_modelo: 0, detalhes: 1, ativo: 1, validade: item.expiry, snapshot_em: new Date().toISOString() });
          row.itens_criados += 1;
          outcomes.push({ index: item.index, outcome: "CRIADO", message: null });
        } else {
          row.itens_ignorados += 1;
          outcomes.push({ index: item.index, outcome: "IGNORADO", message: "Produto não encontrado no cadastro do balcão." });
        }
      }
      row.resultado_json = JSON.stringify({ items: outcomes, warnings: [] });
      row.status = "APLICADO";
      row.aplicado_em = new Date().toISOString();
    }, 8000);
    return { id: row.id, status: "PENDENTE" };
  },
  async purchaseNotesByClientId() { return demoNotes; },
  async purchaseNoteById(_clientId, id) { return demoNotes.find((note) => note.id === id) || null; },
  async cancelPurchaseNote(_clientId, id) {
    const note = demoNotes.find((entry) => entry.id === id && entry.status === "PENDENTE");
    if (!note) return false;
    note.status = "CANCELADO";
    note.chave_ativa = null;
    return true;
  },
  async retryPurchaseNote(_clientId, id) {
    const note = demoNotes.find((entry) => entry.id === id && entry.status === "FALHOU");
    if (!note) return { retried: false };
    note.status = "PENDENTE";
    note.chave_ativa = note.chave_dedupe;
    note.erro = null;
    return { retried: true };
  },
  async pendingDeliveriesByClientId() {
    return {
      rows: demoDeliveries.map((delivery) => ({ ...delivery, snapshot_em: new Date().toISOString() })),
      requests: demoSettlements.filter((entry) => entry.status !== "CANCELADO"),
      syncedAt: new Date().toISOString(),
    };
  },
  async enqueueDeliverySettlements(_clientId, _userId, items) {
    return items.map((item) => {
      const delivery = demoDeliveries.find((entry) => entry.venda_id === item.saleId);
      if (!delivery) return { saleId: item.saleId, status: "not_pending" };
      if (delivery.origem === "APP" && !item.code) return { saleId: item.saleId, status: "code_required" };
      if (demoSettlements.some((entry) => entry.venda_id === item.saleId && ["PENDENTE", "PROCESSANDO"].includes(entry.status))) {
        return { saleId: item.saleId, status: "already_requested" };
      }
      const row = { id: demoSettlements.length + 1, venda_id: item.saleId, status: "PENDENTE", resultado: null, erro: null, solicitado_em: new Date().toISOString(), aplicado_em: null };
      demoSettlements.push(row);
      // Simula o balcão: pega o pedido, confere o código e baixa a entrega.
      setTimeout(() => { if (row.status === "PENDENTE") row.status = "PROCESSANDO"; }, 3000);
      setTimeout(() => {
        if (row.status !== "PROCESSANDO") return;
        if (delivery.origem === "APP" && item.code !== "1234") {
          row.status = "FALHOU";
          row.erro = "Não foi possível concluir o pedido no aplicativo: código de segurança incorreto.";
          return;
        }
        row.status = "APLICADO";
        row.resultado = delivery.origem === "APP" ? "BAIXADA_APP" : "BAIXADA";
        row.aplicado_em = new Date().toISOString();
        setTimeout(() => demoDeliveries.splice(demoDeliveries.indexOf(delivery), 1), 1500);
      }, 6000);
      return { saleId: item.saleId, status: "queued", id: row.id };
    });
  },
  async cancelDeliverySettlement(_clientId, id) {
    const row = demoSettlements.find((entry) => entry.id === id && entry.status === "PENDENTE");
    if (!row) return false;
    row.status = "CANCELADO";
    return true;
  },
  async cashSummaryByClientId() {
    return {
      data_referencia: "2026-08-09",
      sessoes_abertas: 1,
      sessoes_fechadas_hoje: 2,
      total_pagamentos_hoje: 7934.6,
      saldo_inicial_aberto: 300,
      retiradas_abertas: 450,
      suprimentos_abertos: 100,
      saldo_esperado_aberto: 2384.8,
      formas_pagamento_json: JSON.stringify([
        { codigo: "PIX", valor: 2870.2 },
        { codigo: "CREDITO", valor: 2460 },
        { codigo: "DINHEIRO", valor: 2434.8 },
        { codigo: "DEBITO", valor: 169.6 },
      ]),
      sessoes_json: JSON.stringify([
        { operador_nome: "Maria Silva", aberto_em: "2026-08-09 08:00:00", fechado_em: "2026-08-09 12:04:00" },
        { operador_nome: "João Santos", aberto_em: "2026-08-09 09:00:00", fechado_em: null },
        { operador_nome: "Carla Souza", aberto_em: "2026-08-09 10:15:00", fechado_em: "2026-08-09 18:03:00" },
      ]),
    };
  },
  async deliveryCreditSummaryByClientId(_clientId, periodKey) {
    const today = new Date();
    const ranges = {
      today: [today, today],
      "current-month": [new Date(today.getFullYear(), today.getMonth(), 1), today],
      "previous-month": [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
    };
    const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const [start, end] = ranges[periodKey] || ranges.today;
    const multiplier = periodKey === "previous-month" ? 18 : periodKey === "current-month" ? 6 : 1;
    const pendingByPeriod = {
      today: { count: 2, amount: 84.5, oldestDays: 0 },
      "current-month": { count: 8, amount: 268.87, oldestDays: 9 },
      "previous-month": { count: 6, amount: 901.79, oldestDays: 35 },
    }[periodKey] || { count: 2, amount: 84.5, oldestDays: 0 };
    return {
      data_referencia: localDate(today),
      periodo_inicio: localDate(start),
      periodo_fim: localDate(end),
      entregas_pendentes: 4,
      valor_entregas_pendentes: 380.5,
      entregas_urgentes: 2,
      maior_espera_entrega_minutos: 74,
      entregas_baixadas_hoje: 12 * multiplier,
      valor_entregas_baixadas_hoje: 920 * multiplier,
      tempo_medio_entrega_minutos: 31,
      fiados_pendentes: pendingByPeriod.count,
      valor_fiado_pendente: pendingByPeriod.amount,
      fiados_pagos_hoje: 3 * multiplier,
      valor_fiado_pago_hoje: 240 * multiplier,
      fiado_mais_antigo_dias: pendingByPeriod.oldestDays,
    };
  },
  async suspiciousActionsByClientId(_clientId, periodKey) {
    const today = new Date();
    const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const ranges = {
      today: [today, today],
      "current-month": [new Date(today.getFullYear(), today.getMonth(), 1), today],
      "previous-month": [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
    };
    const [start, end] = ranges[periodKey] || ranges.today;
    const counts = periodKey === "previous-month" ? [42, 11, 18] : periodKey === "current-month" ? [16, 4, 7] : [3, 1, 1];
    const lastEvent = `${localDate(end)} 16:42:00`;
    return {
      periodo_inicio: localDate(start),
      periodo_fim: localDate(end),
      total_eventos: counts.reduce((total, count) => total + count, 0),
      ultimo_evento_em: lastEvent,
      categorias_json: JSON.stringify({
        categorias: [
          { codigo: "PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR", quantidade: counts[0], ultimo_evento_em: lastEvent },
          { codigo: "PDV_PAGAMENTO_CANCELADO_E_CARRINHO_ESVAZIADO", quantidade: counts[2], ultimo_evento_em: `${localDate(end)} 14:18:00` },
          { codigo: "PDV_PAGAMENTO_CANCELADO_E_REMOCAO_PARCIAL", quantidade: counts[1], ultimo_evento_em: `${localDate(end)} 11:05:00` },
        ],
        ocorrencias: [
          { codigo: "PDV_PAGAMENTO_CANCELADO_SEM_CONCLUIR", ocorrido_em: lastEvent, linhas_itens: 4, unidades: 6, valor_estimado: 184.7 },
          { codigo: "PDV_PAGAMENTO_CANCELADO_E_CARRINHO_ESVAZIADO", ocorrido_em: `${localDate(end)} 14:18:00`, linhas_itens: 2, unidades: 3, valor_estimado: 72.5 },
          { codigo: "PDV_PAGAMENTO_CANCELADO_E_REMOCAO_PARCIAL", ocorrido_em: `${localDate(end)} 11:05:00`, linhas_itens: 5, unidades: 8, valor_estimado: 231.9 },
        ],
      }),
    };
  },
};

createApp({ repository }).listen(port, () => {
  console.log(`Demonstração em http://127.0.0.1:${port}`);
  console.log("Login: gestor@demo.local | Senha: demonstracao-123");
  console.log("Primeiro acesso: primeiro@demo.local | Código: 123456");
});