const PRODUCT_FILTER_KEYS = new Set(["all", "promo", "lowstock", "nostock", "expiry"]);
const KINDS = ["normal", "parent", "model"];

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;
const hasKey = (body, key) => Boolean(body) && Object.prototype.hasOwnProperty.call(body, key);
const isBlank = (value) => value === null || value === undefined || value === "";

// Devolve { value } quando válido, ou { error: "invalid_product_update", field } com o campo a corrigir.
function parseProductUpdate(body) {
  const fail = (field) => ({ error: "invalid_product_update", field });
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const salePrice = Number(body?.salePrice);
  const stock = Number(body?.stock);
  if (name.length < 2 || name.length > 255) return fail("name");
  if (!Number.isFinite(salePrice) || salePrice < 0.01 || salePrice > 999999999.99) return fail("salePrice");
  if (!Number.isSafeInteger(stock) || stock < -1000000 || stock > 1000000) return fail("stock");
  const value = { name, salePrice: roundMoney(salePrice), stock, promotion: null };

  if (!["promoPrice", "promoQty", "promoPackagePrice"].some((key) => hasKey(body, key))) {
    return { value };
  }

  let promoPrice = null;
  if (!isBlank(body.promoPrice)) {
    promoPrice = Number(body.promoPrice);
    if (!Number.isFinite(promoPrice) || promoPrice <= 0 || roundMoney(promoPrice) >= value.salePrice) {
      return fail("promoPrice");
    }
    promoPrice = roundMoney(promoPrice);
  }
  let promoQty = null;
  if (!isBlank(body.promoQty)) {
    promoQty = Number(body.promoQty);
    if (!Number.isSafeInteger(promoQty) || promoQty < 2 || promoQty > 999) return fail("promoQty");
  }
  let promoPackagePrice = null;
  if (!isBlank(body.promoPackagePrice)) {
    promoPackagePrice = Number(body.promoPackagePrice);
    if (!Number.isFinite(promoPackagePrice) || promoPackagePrice <= 0 || promoPackagePrice > 999999999.99) {
      return fail("promoPackagePrice");
    }
    promoPackagePrice = roundMoney(promoPackagePrice);
  }
  if ((promoQty === null) !== (promoPackagePrice === null)) {
    return fail(promoQty === null ? "promoQty" : "promoPackagePrice");
  }
  if (promoQty !== null && promoPackagePrice >= roundMoney(promoQty * (promoPrice ?? value.salePrice))) {
    return fail("promoPackagePrice");
  }
  value.promotion = { promoPrice, promoQty, promoPackagePrice };
  return { value };
}

function positiveOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function serializeProduct(row, today = new Date()) {
  const salePrice = Number(row.preco_venda || 0);
  const stock = Number(row.estoque || 0);
  const minimumStock = Number(row.estoque_minimo || 0);
  const promoPrice = positiveOrNull(row.preco_promocional);
  let promoQty = positiveOrNull(row.promo_qtd);
  let promoPackagePrice = positiveOrNull(row.promo_preco_pacote);
  if (!promoQty || !promoPackagePrice) promoQty = promoPackagePrice = null;
  const expiryDate = row.validade ? String(row.validade).slice(0, 10) : null;
  let daysUntilExpiry = null;
  if (expiryDate) {
    const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const [year, month, day] = expiryDate.split("-").map(Number);
    daysUntilExpiry = Math.round((Date.UTC(year, month - 1, day) - base) / 86400000);
  }
  const hasUpdate = Boolean(row.atualizacao_status);
  return {
    id: Number(row.produto_origem_id),
    code: String(row.codigo || ""),
    name: String(row.nome || ""),
    category: String(row.categoria || ""),
    salePrice,
    stock,
    minimumStock,
    expiryDate,
    daysUntilExpiry,
    expired: stock > 0 && daysUntilExpiry !== null && daysUntilExpiry < 0,
    expiringSoon: stock > 0 && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 60,
    outOfStock: stock <= 0,
    lowStock: stock > 0 && minimumStock > 0 && stock <= minimumStock,
    promoPrice,
    promoQty,
    promoPackagePrice,
    onPromotion: Boolean(promoPrice || (promoQty && promoPackagePrice)),
    kind: KINDS[Number(row.tipo_modelo || 0)] || "normal",
    conversionFactor: Math.max(Number(row.fator_conversao_padrao || 1), 1),
    purchaseUnit: String(row.unidade_compra || "UN"),
    hasDetails: Boolean(Number(row.detalhes || 0)),
    active: Boolean(Number(row.ativo || 0)),
    snapshotAt: row.snapshot_em || null,
    update: hasUpdate ? {
      status: String(row.atualizacao_status),
      requestedAt: row.atualizacao_solicitada_em || null,
      name: String(row.atualizacao_nome || ""),
      salePrice: Number(row.atualizacao_preco_venda || 0),
      stock: Number(row.atualizacao_estoque || 0),
      promoChanged: Boolean(Number(row.atualizacao_promo_alterada || 0)),
      promoPrice: positiveOrNull(row.atualizacao_preco_promocional),
      promoQty: positiveOrNull(row.atualizacao_promo_qtd),
      promoPackagePrice: positiveOrNull(row.atualizacao_promo_preco_pacote),
      error: row.atualizacao_erro || null,
    } : null,
  };
}

module.exports = { PRODUCT_FILTER_KEYS, parseProductUpdate, serializeProduct };
