const crypto = require("node:crypto");
const { XMLParser, XMLValidator } = require("fast-xml-parser");

const MAX_XML_BYTES = 1500000;
const MAX_ITEMS = 500;
const MAX_INSTALLMENTS = 24;
const MAX_MONEY = 999999999.99;

// Mesmas listas da tela "Alterar faturamento" do sistema no balcão.
const CATEGORIES = ["Perfumaria", "Generico", "Similar", "Etico"];
const CONTINUOUS_USE = [
  "Uso continuo",
  "Uso agudo (temporario)",
  "Uso sob demanda (se necessario)",
  "Medicamento controlado",
  "Medicamento de venda livre (MIP)",
  "Tarja vermelha",
  "Tarja preta",
  "Uso hospitalar",
];
const CONTROLLED_TYPES = ["Psicotrópico", "Antibiótico", "Outro controlado"];

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;
const MAX_FACTOR = 100000;

// Fator de conversão: quantas unidades de venda vêm em cada embalagem comprada (1 caixa = 24 cartelas).
function parseFactor(value) {
  if (value === null || value === undefined || value === "") return { value: 1 };
  const factor = Number(String(value).replace(",", "."));
  if (!Number.isInteger(factor) || factor < 1 || factor > MAX_FACTOR) {
    return { error: `O fator de conversão deve ser um número inteiro de 1 a ${MAX_FACTOR}.` };
  }
  return { value: factor };
}

// A própria NF-e costuma revelar o fator: vende em CX (uCom) e tributa em UN (uTrib), com qTrib = qCom x fator.
function factorFromXml(qCom, qTrib, uCom, uTrib) {
  const commercial = Number(qCom);
  const taxable = Number(qTrib);
  const sameUnit = String(uCom ?? "").trim().toUpperCase() === String(uTrib ?? "").trim().toUpperCase();
  if (!(commercial > 0) || !(taxable > commercial) || sameUnit) return null;
  const ratio = taxable / commercial;
  if (Math.abs(ratio - Math.round(ratio)) > 1e-6 || ratio < 2 || ratio > MAX_FACTOR) return null;
  return Math.round(ratio);
}
const isBlank = (value) => value === null || value === undefined || value === "";
const fold = (text) => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const digits = (text) => String(text ?? "").replace(/\D/g, "");

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

const clean = (value, max = 255) => decodeEntities(typeof value === "object" ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

function number(value) {
  const parsed = Number(String(value ?? "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function brazilianDate(value) {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(value ?? ""));
  return match ? isoDate(`${match[3]}-${match[2]}-${match[1]}`) : null;
}

function todayIso(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function accessKeyIsValid(key) {
  if (!/^\d{44}$/.test(String(key))) return false;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(key[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return Number(key[43]) === (remainder < 2 ? 0 : 11 - remainder);
}

function documentIsValid(document) {
  const value = digits(document);
  if (value.length === 14) {
    if (/^(\d)\1+$/.test(value)) return false;
    const check = (length) => {
      const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
      const rest = sum % 11;
      return rest < 2 ? 0 : 11 - rest;
    };
    return check(12) === Number(value[12]) && check(13) === Number(value[13]);
  }
  if (value.length === 11) {
    if (/^(\d)\1+$/.test(value)) return false;
    const check = (length) => {
      let sum = 0;
      for (let index = 0; index < length; index += 1) sum += Number(value[index]) * (length + 1 - index);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    return check(9) === Number(value[9]) && check(10) === Number(value[10]);
  }
  return false;
}

const asList = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function fail(error, message, extra = {}) {
  return { error, message, ...extra };
}

// Lê o XML da NF-e sem carregar entidades externas e devolve só o que a entrada precisa.
function parseNfeXml(xml) {
  if (typeof xml !== "string" || !xml.trim()) return fail("invalid_xml", "Selecione o arquivo XML da nota.");
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) return fail("xml_too_large", "O XML é maior que o limite de 1,5 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return fail("invalid_xml", "O XML contém declarações não permitidas.");
  const text = xml.replace(/^\uFEFF/, "");
  if (XMLValidator.validate(text) !== true) return fail("invalid_xml", "O arquivo não é um XML válido.");

  let document;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: false,
      isArray: (name) => ["det", "dup", "rastro"].includes(name),
    }).parse(text);
  } catch (_error) {
    return fail("invalid_xml", "O arquivo não é um XML válido.");
  }

  const info = document?.nfeProc?.NFe?.infNFe || document?.NFe?.infNFe;
  if (!info || typeof info !== "object") {
    return fail("not_nfe", "Este XML não é uma NF-e. Envie o XML da nota fiscal de compra (modelo 55).");
  }
  const ide = info.ide || {};
  if (String(ide.mod ?? "55").trim() !== "55") {
    return fail("unsupported_model", "Somente NF-e modelo 55 pode dar entrada. Cupons (NFC-e) não são aceitos.");
  }
  const accessKey = digits(String(info["@_Id"] || "")).slice(0, 44);
  if (!accessKeyIsValid(accessKey)) {
    return fail("invalid_access_key", "A chave de acesso da nota é inválida. Confira se o XML não foi alterado.");
  }

  const emit = info.emit || {};
  const supplierDocument = digits(emit.CNPJ || emit.CPF);
  const supplier = {
    name: clean(emit.xNome, 200),
    tradeName: clean(emit.xFant, 200),
    document: supplierDocument,
    phone: digits(emit.enderEmit?.fone).slice(0, 20),
    email: clean(emit.email, 200),
    state: clean(emit.enderEmit?.UF, 2).toUpperCase(),
  };

  let skippedItems = 0;
  const items = [];
  asList(info.det).forEach((det, position) => {
    const prod = det?.prod;
    if (!prod || typeof prod !== "object") return;
    const codes = [];
    for (const raw of [prod.cEAN, prod.cEANTrib, prod.cProd]) {
      const code = clean(raw, 100);
      if (!code || code.toUpperCase() === "SEM GTIN" || codes.includes(code)) continue;
      codes.push(code);
    }
    const quantity = number(prod.qCom);
    if (!codes.length || quantity <= 0) {
      skippedItems += 1;
      return;
    }
    let unitCost = number(prod.vUnCom);
    if (unitCost <= 0 && number(prod.vProd) > 0) unitCost = number(prod.vProd) / quantity;

    const lots = asList(prod.rastro).map((lot) => isoDate(lot?.dVal)).filter(Boolean).sort();
    let expiry = isoDate(prod.med?.dVal) || lots[0] || null;
    if (!expiry) expiry = brazilianDate(det.infAdProd);

    items.push({
      index: Number(det["@_nItem"]) || position + 1,
      code: codes[0],
      codeCandidates: codes,
      description: clean(prod.xProd, 255) || `Produto ${codes[0]}`,
      ncm: clean(prod.NCM, 8),
      unit: clean(prod.uCom, 6),
      quantity: Math.round(quantity * 10000) / 10000,
      unitCost: Math.round(unitCost * 10000) / 10000,
      factorHint: factorFromXml(quantity, number(prod.qTrib), prod.uCom, prod.uTrib),
      pmc: roundMoney(number(prod.med?.vPMC)),
      expiry,
      multipleLots: lots.length > 1,
    });
  });
  if (!items.length) return fail("no_items", "Não foram encontrados itens válidos na NF-e.");
  if (items.length > MAX_ITEMS) return fail("too_many_items", `A nota tem mais de ${MAX_ITEMS} itens.`);

  const total = info.total?.ICMSTot || {};
  const itemsTotal = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));
  const totals = {
    invoice: roundMoney(number(total.vNF)) || itemsTotal,
    products: roundMoney(number(total.vProd)) || itemsTotal,
    icmsBase: roundMoney(number(total.vBC)),
    icms: roundMoney(number(total.vICMS)),
    icmsStBase: roundMoney(number(total.vBCST)),
    icmsSt: roundMoney(number(total.vST ?? total.vICMSST)),
  };

  const installments = asList(info.cobr?.dup)
    .map((dup) => ({
      number: clean(dup?.nDup, 20) || null,
      dueDate: isoDate(dup?.dVenc),
      amount: roundMoney(number(dup?.vDup)),
    }))
    .filter((dup) => dup.amount > 0)
    .slice(0, MAX_INSTALLMENTS);

  return {
    value: {
      origin: "XML",
      accessKey,
      number: clean(ide.nNF, 20),
      series: clean(ide.serie, 5),
      issueDate: isoDate(ide.dhEmi || ide.dEmi),
      supplier,
      totals,
      installments,
      items,
      skippedItems,
    },
  };
}

function canonicalCategory(value) {
  const wanted = fold(value);
  if (!wanted) return "";
  return CATEGORIES.find((category) => fold(category) === wanted) || null;
}

function canonicalUse(value) {
  const wanted = fold(value);
  if (!wanted) return "";
  return CONTINUOUS_USE.find((use) => fold(use) === wanted) || null;
}

// Valores sugeridos para a revisão: usa o PMC da nota e, na falta dele, o que já está cadastrado.
function suggestItem(item, match) {
  const currentPrice = Number(match?.preco_venda || 0);
  const salePrice = item.pmc > 0 ? item.pmc : currentPrice > 0 ? roundMoney(currentPrice) : 0;
  const promo = Number(match?.preco_promocional || 0);
  // Fator: o da nota (mais concreto) e, na falta dele, o último usado neste produto.
  const remembered = Number(match?.fator_conversao_padrao || 1);
  const conversionFactor = item.factorHint > 1 ? item.factorHint : remembered > 1 ? remembered : 1;
  const rememberedUnit = String(match?.unidade_compra || "").trim();
  const realCost = item.unitCost / conversionFactor;
  return {
    salePrice,
    marginPercent: realCost > 0 && salePrice > 0 ? roundMoney((salePrice / realCost - 1) * 100) : 0,
    conversionFactor,
    purchaseUnit: rememberedUnit && rememberedUnit.toUpperCase() !== "UN" ? rememberedUnit : item.unit || rememberedUnit || "UN",
    promoPrice: promo > 0 ? roundMoney(promo) : null,
    category: canonicalCategory(match?.categoria) || "",
    continuousUse: "",
    controlledType: "",
    expiry: item.expiry,
    createIfMissing: !match,
    include: !(match && Number(match.tipo_modelo) === 1),
  };
}

function serializeMatch(match) {
  if (!match) return null;
  return {
    productId: Number(match.produto_origem_id),
    code: String(match.codigo || ""),
    name: String(match.nome || ""),
    category: String(match.categoria || ""),
    salePrice: roundMoney(match.preco_venda || 0),
    promoPrice: Number(match.preco_promocional || 0) > 0 ? roundMoney(match.preco_promocional) : null,
    stock: Number(match.estoque || 0),
    conversionFactor: Math.max(Number(match.fator_conversao_padrao || 1), 1),
    purchaseUnit: String(match.unidade_compra || "UN"),
    kind: ["normal", "parent", "model"][Number(match.tipo_modelo || 0)] || "normal",
  };
}

function previewNote(parsed, matches) {
  return {
    origin: parsed.origin,
    accessKey: parsed.accessKey,
    number: parsed.number,
    series: parsed.series,
    issueDate: parsed.issueDate,
    supplier: parsed.supplier,
    totals: parsed.totals,
    installments: parsed.installments,
    skippedItems: parsed.skippedItems,
    items: parsed.items.map((item, position) => ({
      ...item,
      match: serializeMatch(matches[position]),
      suggested: suggestItem(item, matches[position]),
    })),
  };
}

function parseInstallments(list, fallbackTotal, issueDate, createPayable) {
  if (!createPayable) return { value: [] };
  if (isBlank(list) || (Array.isArray(list) && list.length === 0)) {
    return {
      value: [{ number: null, dueDate: addDays(issueDate || todayIso(), 30), amount: roundMoney(fallbackTotal) }],
      isDefault: true,
    };
  }
  if (!Array.isArray(list) || list.length > MAX_INSTALLMENTS) return fail("invalid_installments", "Confira os vencimentos informados.", { field: "installments" });
  const value = [];
  for (const [index, entry] of list.entries()) {
    const amount = Number(entry?.amount);
    const dueDate = isoDate(entry?.dueDate);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY || !dueDate) {
      return fail("invalid_installments", `Confira o vencimento ${index + 1}: informe data e valor.`, { field: "installments", row: index });
    }
    value.push({ number: clean(entry?.number, 20) || null, dueDate, amount: roundMoney(amount) });
  }
  return { value };
}

// Revisa um item com as mesmas exigências da tela "Alterar faturamento" do balcão.
function reviewItem(source, input, match, { today }) {
  const index = source.index;
  const itemFail = (field, message) => fail("invalid_item", message, { item: index, field });
  const include = input?.include !== false;
  if (!include) return { value: null };

  const unitCost = isBlank(input?.unitCost) ? source.unitCost : Number(input.unitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 9999999) return itemFail("unitCost", "Informe o custo da embalagem válido.");

  // Fator de conversão: `unitCost` é o custo da EMBALAGEM; o estoque trabalha em unidades de venda.
  const factorResult = parseFactor(input?.conversionFactor);
  if (factorResult.error) return itemFail("conversionFactor", factorResult.message || factorResult.error);
  const factor = factorResult.value;
  const totalUnits = round4(source.quantity * factor);
  if (factor > 1 && !Number.isInteger(totalUnits)) {
    return itemFail("conversionFactor", "A quantidade total de unidades precisa ser um número inteiro.");
  }
  const realCost = round4(unitCost / factor);

  let salePrice = isBlank(input?.salePrice) ? 0 : Number(input.salePrice);
  if (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > MAX_MONEY) return itemFail("salePrice", "Informe um preço de venda válido.");
  if (salePrice === 0 && !isBlank(input?.marginPercent) && realCost > 0) {
    const margin = Number(input.marginPercent);
    if (Number.isFinite(margin) && margin > -100 && margin < 100000) salePrice = realCost * (1 + margin / 100);
  }
  salePrice = roundMoney(salePrice);
  if (salePrice <= 0) return itemFail("salePrice", "Informe o PMC / preço de venda do produto.");

  let promoPrice = null;
  if (!isBlank(input?.promoPrice)) {
    promoPrice = Number(input.promoPrice);
    if (!Number.isFinite(promoPrice) || promoPrice <= 0 || roundMoney(promoPrice) >= salePrice) {
      return itemFail("promoPrice", "O preço promocional deve ser maior que zero e menor que o preço de venda.");
    }
    promoPrice = roundMoney(promoPrice);
  }

  const category = canonicalCategory(input?.category);
  if (category === null) return itemFail("category", "Escolha uma categoria da lista.");
  const continuousUse = canonicalUse(input?.continuousUse);
  if (continuousUse === null) return itemFail("continuousUse", "Escolha o tipo de uso da lista.");
  if (!match && category !== "Perfumaria" && !continuousUse) {
    return itemFail("continuousUse", "Produto novo precisa do tipo de uso (opcional só para Perfumaria).");
  }

  const controlledRaw = String(input?.controlledType ?? "").trim();
  const controlledType = !controlledRaw || fold(controlledRaw) === "nao controlado"
    ? null
    : CONTROLLED_TYPES.find((type) => fold(type) === fold(controlledRaw));
  if (controlledRaw && controlledType === undefined) return itemFail("controlledType", "Escolha o tipo controlado da lista.");

  const expiry = isoDate(input?.expiry);
  if (!expiry) return itemFail("expiry", "A validade é obrigatória (DD/MM/AAAA).");
  if (expiry < today) return itemFail("expiry", "Validade já vencida: confira a data antes de dar entrada.");
  if (expiry > addDays(today, 365 * 15)) return itemFail("expiry", "Validade muito distante: confira a data.");

  if (match && Number(match.tipo_modelo) === 1) {
    return itemFail("include", "Produto com modelos/tamanhos: dê entrada pelo modelo (ou retire este item).");
  }

  const createIfMissing = match ? false : input?.createIfMissing !== false;
  return {
    value: {
      index,
      code: source.code,
      codeCandidates: source.codeCandidates,
      description: source.description,
      unit: source.unit || "",
      // Para o balcão (qualquer versão): unidades de venda e custo unitário real.
      quantity: totalUnits,
      unitCost: realCost,
      // Detalhe da compra, para o histórico e para lembrar o fator no cadastro do produto.
      purchasedQuantity: source.quantity,
      conversionFactor: factor,
      packageCost: Math.round(unitCost * 10000) / 10000,
      purchaseUnit: clean(source.unit, 6) || "UN",
      salePrice,
      marginPercent: realCost > 0 ? roundMoney((salePrice / realCost - 1) * 100) : 0,
      promoPrice,
      category,
      continuousUse,
      controlledType,
      expiry,
      createIfMissing,
      productId: match ? Number(match.produto_origem_id) : null,
    },
  };
}

function parseManualHeader(header, now) {
  const supplierName = clean(header?.supplierName, 200);
  if (supplierName.length < 2) return fail("invalid_note", "Informe o nome do fornecedor.", { field: "supplierName" });
  const supplierDocument = digits(header?.supplierDocument);
  if (supplierDocument && !documentIsValid(supplierDocument)) return fail("invalid_note", "CNPJ/CPF do fornecedor inválido.", { field: "supplierDocument" });
  const number = clean(header?.number, 20);
  if (!/^[0-9A-Za-z./-]{1,20}$/.test(number)) return fail("invalid_note", "Informe o número da nota.", { field: "number" });
  const issueDate = isoDate(header?.issueDate);
  const today = todayIso(now);
  if (!issueDate || issueDate > today || issueDate < addDays(today, -400)) {
    return fail("invalid_note", "Informe a data de emissão da nota (até hoje, no máximo 400 dias atrás).", { field: "issueDate" });
  }
  let accessKey = null;
  if (!isBlank(header?.accessKey) && digits(header.accessKey)) {
    accessKey = digits(header.accessKey);
    if (!accessKeyIsValid(accessKey)) return fail("invalid_note", "A chave de acesso (44 números) é inválida.", { field: "accessKey" });
  }
  return {
    value: {
      supplier: {
        name: supplierName,
        tradeName: "",
        document: supplierDocument,
        phone: digits(header?.supplierPhone).slice(0, 20),
        email: "",
        state: "",
      },
      number,
      series: clean(header?.series, 5),
      issueDate,
      accessKey,
    },
  };
}

// Monta a nota final a ser enfileirada. `lookup(items)` consulta o catálogo do cliente da sessão.
// Nada que venha do navegador é aceito sem ser conferido de novo aqui.
async function buildPurchaseNote(body, lookup, now = new Date()) {
  const today = todayIso(now);
  const options = {
    registerSupplier: body?.options?.registerSupplier !== false,
    createPayable: body?.options?.createPayable !== false,
  };
  const reviews = Array.isArray(body?.items) ? body.items : null;
  if (!reviews) return fail("invalid_note", "Nenhum item informado.", { field: "items" });
  if (reviews.length > MAX_ITEMS) return fail("too_many_items", `A nota tem mais de ${MAX_ITEMS} itens.`);

  let base;
  let sources;
  if (body?.mode === "xml") {
    const parsed = parseNfeXml(body.xml);
    if (parsed.error) return parsed;
    base = parsed.value;
    sources = base.items;
  } else if (body?.mode === "manual") {
    const header = parseManualHeader(body.header, now);
    if (header.error) return header;
    sources = [];
    for (const [position, entry] of reviews.entries()) {
      const code = clean(entry?.code, 100);
      const description = clean(entry?.description, 255);
      const quantity = Number(entry?.quantity);
      if (!code || description.length < 2) return fail("invalid_item", "Informe código e descrição do item.", { item: position + 1, field: "description" });
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) return fail("invalid_item", "A quantidade deve ser um número inteiro maior que zero.", { item: position + 1, field: "quantity" });
      sources.push({
        index: position + 1,
        code,
        codeCandidates: [code],
        description,
        unit: clean(entry?.unit, 6),
        quantity,
        unitCost: Number(entry?.unitCost) || 0,
        expiry: null,
      });
    }
    base = { origin: "MANUAL", ...header.value, totals: null, installments: [], items: sources, skippedItems: 0 };
  } else {
    return fail("invalid_note", "Escolha entre importar o XML ou digitar a nota.", { field: "mode" });
  }

  const matches = await lookup(sources);
  const reviewByIndex = new Map();
  for (const [position, entry] of reviews.entries()) {
    const key = body.mode === "xml" ? Number(entry?.index) : position + 1;
    if (!Number.isInteger(key) || reviewByIndex.has(key)) return fail("invalid_note", "Itens duplicados ou fora da nota.", { field: "items" });
    reviewByIndex.set(key, entry);
  }
  if (body.mode === "xml" && sources.some((source) => !reviewByIndex.has(source.index))) {
    return fail("invalid_note", "Revise todos os itens da nota antes de confirmar.", { field: "items" });
  }
  if (body.mode === "xml" && [...reviewByIndex.keys()].some((key) => !sources.some((source) => source.index === key))) {
    return fail("invalid_note", "Itens duplicados ou fora da nota.", { field: "items" });
  }

  const items = [];
  for (const [position, source] of sources.entries()) {
    const review = reviewByIndex.get(source.index);
    const result = reviewItem(source, review, matches[position], { today });
    if (result.error) return result;
    if (result.value) items.push(result.value);
  }
  if (!items.length) return fail("invalid_note", "Mantenha pelo menos um item na nota.", { field: "items" });

  const itemsTotal = roundMoney(items.reduce((sum, item) => sum + item.purchasedQuantity * item.packageCost, 0));
  const totals = base.totals || { invoice: itemsTotal, products: itemsTotal, icmsBase: 0, icms: 0, icmsStBase: 0, icmsSt: 0 };
  const installmentSource = body.mode === "xml" && isBlank(body?.installments) ? base.installments : body?.installments;
  const installments = parseInstallments(installmentSource, totals.invoice || itemsTotal, base.issueDate, options.createPayable);
  if (installments.error) return installments;

  // Impede lançar duas vezes a mesma nota: pela chave de acesso ou, na nota de papel, por fornecedor + número + data.
  const dedupeKey = base.accessKey
    || `M${crypto.createHash("sha1")
      .update([base.supplier.document || fold(base.supplier.name), base.number, base.series, base.issueDate].join("|"))
      .digest("hex")}`;

  return {
    value: {
      origin: base.origin,
      accessKey: base.accessKey || null,
      dedupeKey,
      number: base.number,
      series: base.series,
      issueDate: base.issueDate,
      supplier: base.supplier,
      totals,
      installments: installments.value,
      items,
      options,
      xml: body.mode === "xml" ? body.xml : null,
      notes: clean(body?.notes, 500),
    },
    matches,
  };
}

const STATUS = ["PENDENTE", "PROCESSANDO", "APLICADO", "FALHOU", "CANCELADO"];

function safeJson(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

function serializePurchaseNote(row, { detail = false } = {}) {
  const extras = safeJson(row.extras_json, {});
  const result = safeJson(row.resultado_json, {});
  const note = {
    id: Number(row.id),
    origin: String(row.origem || "XML"),
    number: String(row.numero_nf || ""),
    series: String(row.serie || ""),
    issueDate: row.emissao ? String(row.emissao).slice(0, 10) : null,
    supplierName: String(row.fornecedor_nome || ""),
    supplierDocument: String(row.fornecedor_documento || ""),
    accessKey: row.chave_nfe ? String(row.chave_nfe) : null,
    totalValue: Number(row.valor_nf || 0),
    itemCount: Number(row.total_itens || 0),
    status: STATUS.includes(row.status) ? row.status : "PENDENTE",
    requestedAt: row.solicitado_em || null,
    appliedAt: row.aplicado_em || null,
    error: row.erro || null,
    counts: {
      updated: Number(row.itens_atualizados || 0),
      created: Number(row.itens_criados || 0),
      ignored: Number(row.itens_ignorados || 0),
    },
    payables: Array.isArray(extras.installments) ? extras.installments.length : 0,
  };
  if (!detail) return note;
  return {
    ...note,
    notes: String(row.observacoes || ""),
    options: extras.options || {},
    installments: Array.isArray(extras.installments) ? extras.installments : [],
    items: safeJson(row.itens_json, []).map((item) => {
      const outcome = (result.items || []).find((entry) => Number(entry.index) === Number(item.index));
      return {
        index: Number(item.index),
        code: String(item.code || ""),
        description: String(item.description || ""),
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.unitCost || 0),
        purchasedQuantity: Number(item.purchasedQuantity || item.quantity || 0),
        conversionFactor: Number(item.conversionFactor || 1),
        packageCost: Number(item.packageCost ?? item.unitCost ?? 0),
        purchaseUnit: String(item.purchaseUnit || ""),
        salePrice: Number(item.salePrice || 0),
        expiry: item.expiry || null,
        outcome: outcome ? String(outcome.outcome) : null,
        message: outcome?.message ? String(outcome.message) : null,
      };
    }),
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
  };
}

module.exports = {
  factorFromXml,
  parseFactor,
  CATEGORIES,
  CONTINUOUS_USE,
  CONTROLLED_TYPES,
  MAX_XML_BYTES,
  accessKeyIsValid,
  buildPurchaseNote,
  documentIsValid,
  parseNfeXml,
  previewNote,
  serializePurchaseNote,
};
