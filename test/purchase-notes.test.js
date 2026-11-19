const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createApp } = require("../src/app");
const { hashPassword } = require("../src/security");
const {
  accessKeyIsValid,
  buildPurchaseNote,
  documentIsValid,
  parseNfeXml,
  serializePurchaseNote,
} = require("../src/purchase-notes");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "nfe-compra.xml"), "utf8");
const KEY = "33261112345678000195550010000123451876543218";

const existingProduct = {
  produto_origem_id: 10, codigo: "7891234567895", nome: "Dipirona 500mg", categoria: "Genérico",
  preco_venda: 8.5, preco_promocional: 7.9, estoque: 4, tipo_modelo: 0,
};
const parentProduct = { ...existingProduct, produto_origem_id: 11, codigo: "7899999999994", nome: "Chinelo", tipo_modelo: 1 };
const lookupFor = (table) => async (sources) => sources.map((source) => table.find((row) => source.codeCandidates.includes(row.codigo)) || null);

const validReviews = () => [
  { index: 1, salePrice: 9.9, expiry: "2030-06-30", category: "Generico" },
  { index: 2, salePrice: 25, expiry: "2030-05-01", category: "Perfumaria", createIfMissing: true },
  { index: 3, include: false },
];

test("lê a NF-e: fornecedor, chave, itens, validade pelo lote mais curto e duplicatas", () => {
  const { value, error } = parseNfeXml(FIXTURE);
  assert.equal(error, undefined);
  assert.equal(value.accessKey, KEY);
  assert.equal(value.number, "12345");
  assert.equal(value.issueDate, "2026-11-09");
  assert.equal(value.supplier.name, "Distribuidora Saúde & Vida Ltda");
  assert.equal(value.supplier.document, "12345678000195");
  assert.equal(value.supplier.state, "RJ");
  assert.equal(value.totals.invoice, 177);
  assert.deepEqual(value.items.map((item) => item.codeCandidates), [["7891234567895", "1001"], ["SH-200"], ["7899999999994", "0000555"]]);
  assert.equal(value.items[0].pmc, 9.9);
  assert.equal(value.items[0].expiry, "2028-06-30");
  assert.equal(value.items[1].expiry, null);
  assert.equal(value.items[2].expiry, "2027-03-31");
  assert.equal(value.items[2].multipleLots, true);
  assert.deepEqual(value.installments.map((item) => [item.dueDate, item.amount]), [["2026-12-09", 88.5], ["2027-01-08", 88.5]]);
});

test("recusa XML perigoso, quebrado, de outro tipo, adulterado ou grande demais", () => {
  const code = (xml) => parseNfeXml(xml).error;
  assert.equal(code(""), "invalid_xml");
  assert.equal(code("<a><b></a>"), "invalid_xml");
  assert.equal(code(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><a>&e;</a>`), "invalid_xml");
  assert.equal(code("<resNFe><chNFe>1</chNFe></resNFe>"), "not_nfe");
  assert.equal(code(FIXTURE.replace("<mod>55</mod>", "<mod>65</mod>")), "unsupported_model");
  assert.equal(code(FIXTURE.replace(KEY, `${KEY.slice(0, 43)}9`)), "invalid_access_key");
  assert.equal(code(FIXTURE.replace(/<det[\s\S]*<\/det>/, "")), "no_items");
  assert.equal(code(`${FIXTURE}${"x".repeat(1600000)}`), "xml_too_large");
});

test("valida chave de acesso e CNPJ/CPF pelos dígitos verificadores", () => {
  assert.equal(accessKeyIsValid(KEY), true);
  assert.equal(accessKeyIsValid(`${KEY.slice(0, 43)}0`), false);
  assert.equal(documentIsValid("12.345.678/0001-95"), true);
  assert.equal(documentIsValid("12345678000196"), false);
  assert.equal(documentIsValid("529.982.247-25"), true);
  assert.equal(documentIsValid("11111111111"), false);
});

test("nota XML revisada vira item a item, com margem calculada e produto existente reconhecido", async () => {
  const built = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: validReviews() }, lookupFor([existingProduct, parentProduct]));
  assert.equal(built.error, undefined, JSON.stringify(built));
  const { value } = built;
  assert.equal(value.dedupeKey, KEY);
  assert.equal(value.accessKey, KEY);
  assert.equal(value.items.length, 2);
  assert.deepEqual(
    [value.items[0].productId, value.items[0].createIfMissing, value.items[0].marginPercent, value.items[0].category],
    [10, false, 120, "Generico"],
  );
  assert.deepEqual([value.items[1].productId, value.items[1].createIfMissing, value.items[1].continuousUse], [null, true, ""]);
  assert.equal(value.installments.length, 2);
  assert.equal(value.xml, FIXTURE);
});

test("regras do balcão: PMC, validade, uso contínuo, promoção e produto com modelos", async () => {
  const lookup = lookupFor([existingProduct, parentProduct]);
  const run = async (mutate) => {
    const items = validReviews();
    mutate(items);
    return buildPurchaseNote({ mode: "xml", xml: FIXTURE, items }, lookup);
  };
  const semPmc = await run((items) => { items[1].salePrice = 0; });
  assert.deepEqual([semPmc.error, semPmc.item, semPmc.field], ["invalid_item", 2, "salePrice"]);
  const semValidade = await run((items) => { items[1].expiry = ""; });
  assert.deepEqual([semValidade.item, semValidade.field], [2, "expiry"]);
  const vencida = await run((items) => { items[0].expiry = "2020-01-01"; });
  assert.deepEqual([vencida.item, vencida.field], [1, "expiry"]);
  const novoSemUso = await run((items) => { items[1].category = "Generico"; });
  assert.deepEqual([novoSemUso.item, novoSemUso.field], [2, "continuousUse"]);
  const novoComUso = await run((items) => { items[1].category = "Generico"; items[1].continuousUse = "tarja vermelha"; });
  assert.equal(novoComUso.value.items[1].continuousUse, "Tarja vermelha");
  const promoAlta = await run((items) => { items[0].promoPrice = 9.9; });
  assert.deepEqual([promoAlta.item, promoAlta.field], [1, "promoPrice"]);
  const categoriaInvalida = await run((items) => { items[0].category = "Qualquer"; });
  assert.equal(categoriaInvalida.field, "category");
  const controlado = await run((items) => { items[0].controlledType = "Antibiótico"; });
  assert.equal(controlado.value.items[0].controlledType, "Antibiótico");
  const controladoRuim = await run((items) => { items[0].controlledType = "Outro"; });
  assert.equal(controladoRuim.field, "controlledType");
  const comModelos = await run((items) => { items[2] = { index: 3, salePrice: 10, expiry: "2030-01-01" }; });
  assert.deepEqual([comModelos.item, comModelos.field], [3, "include"]);
  const nenhum = await run((items) => items.forEach((item) => { item.include = false; }));
  assert.equal(nenhum.field, "items");
});

test("o que o navegador envia não amplia a nota: itens fora do XML ou repetidos são recusados", async () => {
  const lookup = lookupFor([]);
  const base = validReviews();
  const extra = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: [...base, { index: 9, salePrice: 1, expiry: "2030-01-01" }] }, lookup);
  assert.equal(extra.error, "invalid_note");
  const repetido = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: [base[0], base[0], base[1]] }, lookup);
  assert.equal(repetido.error, "invalid_note");
  const faltando = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: [base[0]] }, lookup);
  assert.equal(faltando.error, "invalid_note");
});

test("vencimentos: usa os do XML, aceita ajuste e gera um de 30 dias quando não há nenhum", async () => {
  const lookup = lookupFor([existingProduct]);
  const withoutDup = FIXTURE.replace(/<cobr>[\s\S]*<\/cobr>/, "");
  const defaultDue = await buildPurchaseNote({ mode: "xml", xml: withoutDup, items: validReviews().map((item) => (item.index === 3 ? { ...item, include: true, salePrice: 30, expiry: "2030-01-01", category: "Perfumaria" } : item)) }, lookup);
  assert.deepEqual(defaultDue.value.installments, [{ number: null, dueDate: "2026-12-09", amount: 177 }]);

  const custom = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: validReviews(), installments: [{ dueDate: "2027-02-01", amount: 177 }] }, lookup);
  assert.deepEqual(custom.value.installments, [{ number: null, dueDate: "2027-02-01", amount: 177 }]);
  const invalid = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: validReviews(), installments: [{ dueDate: "31/02/2027", amount: 10 }] }, lookup);
  assert.equal(invalid.error, "invalid_installments");
  const none = await buildPurchaseNote({ mode: "xml", xml: FIXTURE, items: validReviews(), options: { createPayable: false } }, lookup);
  assert.deepEqual(none.value.installments, []);
});

test("nota de papel (digitada): exige fornecedor, número e data, e não duplica", async () => {
  const lookup = lookupFor([existingProduct]);
  const today = new Date().toISOString().slice(0, 10);
  const manual = (overrides = {}) => ({
    mode: "manual",
    header: { supplierName: "Drogaria Atacado", supplierDocument: "12.345.678/0001-95", number: "778", issueDate: today, ...overrides },
    items: [
      { code: "7891234567895", description: "Dipirona 500mg", quantity: 12, unitCost: 4.1, salePrice: 9.5, expiry: "2030-01-31", category: "Generico" },
      { code: "NOVO-1", description: "Produto novo", quantity: 3, unitCost: 10, salePrice: 19.9, expiry: "2030-01-31", category: "Perfumaria" },
    ],
  });
  const built = await buildPurchaseNote(manual(), lookup);
  assert.equal(built.error, undefined, JSON.stringify(built));
  assert.equal(built.value.origin, "MANUAL");
  assert.equal(built.value.accessKey, null);
  assert.match(built.value.dedupeKey, /^M[0-9a-f]{40}$/);
  assert.equal(built.value.totals.invoice, 79.2);
  assert.equal(built.value.installments.length, 1);
  assert.equal(built.value.items[0].productId, 10);

  const again = await buildPurchaseNote(manual(), lookup);
  assert.equal(again.value.dedupeKey, built.value.dedupeKey);
  assert.equal((await buildPurchaseNote(manual({ supplierName: "" }), lookup)).field, "supplierName");
  assert.equal((await buildPurchaseNote(manual({ supplierDocument: "11.111.111/1111-11" }), lookup)).field, "supplierDocument");
  assert.equal((await buildPurchaseNote(manual({ number: "" }), lookup)).field, "number");
  assert.equal((await buildPurchaseNote(manual({ issueDate: "2999-01-01" }), lookup)).field, "issueDate");
  assert.equal((await buildPurchaseNote(manual({ accessKey: "123" }), lookup)).field, "accessKey");
  assert.equal((await buildPurchaseNote(manual({ accessKey: KEY }), lookup)).value.dedupeKey, KEY);
  const fraction = manual();
  fraction.items[0].quantity = 1.5;
  assert.equal((await buildPurchaseNote(fraction, lookup)).field, "quantity");
});

test("serializa a nota para a tela sem expor o XML nem o conteúdo bruto", () => {
  const note = serializePurchaseNote({
    id: 5, origem: "XML", chave_nfe: KEY, numero_nf: "12345", serie: "1", emissao: "2026-11-09",
    fornecedor_nome: "Fornecedor", fornecedor_documento: "12345678000195", valor_nf: "177.00",
    total_itens: 2, status: "APLICADO", itens_atualizados: 1, itens_criados: 1, itens_ignorados: 0,
    extras_json: JSON.stringify({ installments: [{}, {}] }),
    itens_json: JSON.stringify([{ index: 1, code: "1", description: "A", quantity: 2, unitCost: 3, salePrice: 5 }]),
    resultado_json: JSON.stringify({ items: [{ index: 1, outcome: "CRIADO", message: "ok" }], warnings: ["aviso"] }),
    xml_conteudo: "<secreto/>",
  }, { detail: true });
  assert.equal(note.totalValue, 177);
  assert.equal(note.payables, 2);
  assert.deepEqual(note.items[0].outcome, "CRIADO");
  assert.deepEqual(note.warnings, ["aviso"]);
  assert.equal(JSON.stringify(note).includes("secreto"), false);
});

async function startServer() {
  const credentials = hashPassword("senha-segura-123");
  const state = { queued: [], cancelled: [], retried: [], seenClients: [], active: new Map(), nextId: 1 };
  const repository = {
    health: async () => {},
    userByEmail: async () => ({ id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash }),
    createSession: async (_userId, tokenHash) => { state.token = tokenHash; },
    sessionByTokenHash: async (tokenHash) => (tokenHash === state.token ? { user_id: 7, cliente_id: 42 } : null),
    deleteSession: async () => {},
    matchCatalogProducts: async (clientId, sources) => {
      state.seenClients.push(clientId);
      return lookupFor([existingProduct, parentProduct])(sources);
    },
    activePurchaseNote: async (_clientId, key) => state.active.get(key) || null,
    enqueuePurchaseNote: async (clientId, userId, note) => {
      state.seenClients.push(clientId);
      if (state.active.has(note.dedupeKey)) return { duplicate: true, existingId: state.active.get(note.dedupeKey).id, existingStatus: "PENDENTE" };
      const queued = { id: state.nextId++, status: "PENDENTE" };
      state.active.set(note.dedupeKey, queued);
      state.queued.push({ clientId, userId, note });
      return queued;
    },
    purchaseNotesByClientId: async (clientId) => {
      state.seenClients.push(clientId);
      return [{ id: 1, origem: "XML", numero_nf: "1", fornecedor_nome: "F", valor_nf: 10, total_itens: 1, status: "PENDENTE" }];
    },
    purchaseNoteById: async (clientId, id) => (clientId === 42 && id === 1 ? { id: 1, status: "FALHOU", erro: "x", itens_json: "[]" } : null),
    cancelPurchaseNote: async (clientId, id) => { state.cancelled.push([clientId, id]); return id === 1; },
    retryPurchaseNote: async (clientId, id) => { state.retried.push([clientId, id]); return id === 1 ? { retried: true } : { retried: false }; },
  };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gestor@farmacia.test", password: "senha-segura-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = (method, url, body) => fetch(`${baseUrl}${url}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { state, baseUrl, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("API: exige sessão, mostra a prévia sem gravar e usa sempre o cliente da sessão", async (context) => {
  const server = await startServer();
  context.after(server.close);

  const anonymous = await fetch(`${server.baseUrl}/api/purchase-notes`);
  assert.equal(anonymous.status, 401);

  const preview = await server.call("POST", "/api/purchase-notes/preview", { xml: FIXTURE, cliente_id: 999 });
  assert.equal(preview.status, 200);
  const body = await preview.json();
  assert.equal(body.note.items.length, 3);
  assert.equal(body.note.items[0].match.productId, 10);
  assert.equal(body.note.items[0].suggested.category, "Generico");
  assert.equal(body.note.items[0].suggested.promoPrice, 7.9);
  assert.equal(body.note.items[1].match, null);
  assert.equal(body.note.items[1].suggested.createIfMissing, true);
  assert.equal(body.note.items[2].suggested.include, false);
  assert.equal(body.duplicate, null);
  assert.ok(body.options.categories.includes("Perfumaria"));
  assert.equal(server.state.queued.length, 0);

  const bad = await server.call("POST", "/api/purchase-notes/preview", { xml: "<x/>" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "not_nfe");

  const send = await server.call("POST", "/api/purchase-notes", { mode: "xml", xml: FIXTURE, items: validReviews(), cliente_id: 999 });
  assert.equal(send.status, 202);
  assert.deepEqual(await send.json(), { id: 1, status: "PENDENTE" });
  assert.equal(server.state.queued[0].clientId, 42);
  assert.equal(server.state.queued[0].userId, 7);
  assert.ok(server.state.seenClients.every((clientId) => clientId === 42));

  const duplicate = await server.call("POST", "/api/purchase-notes", { mode: "xml", xml: FIXTURE, items: validReviews() });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "note_already_entered");

  const previewAgain = await (await server.call("POST", "/api/purchase-notes/preview", { xml: FIXTURE })).json();
  assert.equal(previewAgain.duplicate.id, 1);

  const invalid = await server.call("POST", "/api/purchase-notes", { mode: "xml", xml: FIXTURE, items: [] });
  assert.equal(invalid.status, 400);
});

test("API: lista, detalha, cancela e reenvia só notas da própria farmácia", async (context) => {
  const server = await startServer();
  context.after(server.close);
  const list = await (await server.call("GET", "/api/purchase-notes")).json();
  assert.equal(list.notes[0].status, "PENDENTE");
  assert.ok(list.options.continuousUse.length > 3);
  assert.equal((await server.call("GET", "/api/purchase-notes/1")).status, 200);
  assert.equal((await server.call("GET", "/api/purchase-notes/2")).status, 404);
  assert.equal((await server.call("GET", "/api/purchase-notes/abc")).status, 404);
  assert.equal((await server.call("POST", "/api/purchase-notes/1/cancel")).status, 200);
  assert.equal((await server.call("POST", "/api/purchase-notes/2/cancel")).status, 409);
  assert.equal((await server.call("POST", "/api/purchase-notes/1/retry")).status, 202);
  assert.equal((await server.call("POST", "/api/purchase-notes/2/retry")).status, 409);
  assert.deepEqual(server.state.cancelled[0], [42, 1]);
});

test("API: aceita XML de até 1,5 MB nas notas e continua limitando as demais rotas a 32 KB", async (context) => {
  const server = await startServer();
  context.after(server.close);
  const huge = await server.call("POST", "/api/purchase-notes/preview", { xml: "x".repeat(2600000) });
  assert.equal(huge.status, 413);
  const small = await server.call("PUT", "/api/products/1", { name: "x".repeat(40000) });
  assert.equal(small.status, 413);
});

test("fator de conversão: 2 caixas de 24 a R$ 72,00 viram 48 unidades a R$ 3,00 (compatível com balcões antigos)", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const lookup = lookupFor([{ ...existingProduct, fator_conversao_padrao: 24, unidade_compra: "CX" }]);
  const body = (factor, extra = {}) => ({
    mode: "manual",
    header: { supplierName: "Drogaria Atacado", supplierDocument: "12.345.678/0001-95", number: "900", issueDate: today },
    items: [{ code: "7891234567895", description: "Dorflex", quantity: 2, unit: "CX", unitCost: 72, salePrice: 6, expiry: "2030-01-31", category: "Generico", conversionFactor: factor, ...extra }],
  });

  const built = await buildPurchaseNote(body(24), lookup);
  assert.equal(built.error, undefined, JSON.stringify(built));
  const item = built.value.items[0];
  assert.deepEqual(
    [item.quantity, item.unitCost, item.purchasedQuantity, item.conversionFactor, item.packageCost, item.purchaseUnit, item.marginPercent],
    [48, 3, 2, 24, 72, "CX", 100],
  );
  assert.equal(built.value.totals.invoice, 144, "o valor da nota continua sendo embalagens x custo da embalagem");

  const semFator = await buildPurchaseNote(body(undefined), lookup);
  assert.deepEqual([semFator.value.items[0].quantity, semFator.value.items[0].unitCost, semFator.value.items[0].conversionFactor], [2, 72, 1]);

  for (const ruim of [0, -2, 2.5, "abc", 1000000]) {
    const result = await buildPurchaseNote(body(ruim), lookup);
    assert.deepEqual([result.error, result.field], ["invalid_item", "conversionFactor"], String(ruim));
  }
  const quebrado = await buildPurchaseNote(body(3, { quantity: 2 }), lookup);
  assert.equal(quebrado.error, undefined);
});

test("fator de conversão sugerido: pela própria NF-e e, na falta dela, o último usado no produto", () => {
  const { factorFromXml } = require("../src/purchase-notes");
  assert.equal(factorFromXml(2, 48, "CX", "UN"), 24);
  assert.equal(factorFromXml(2, 48, "UN", "UN"), null);
  assert.equal(factorFromXml(2, 5, "CX", "UN"), null);
  assert.equal(factorFromXml(2, 2, "CX", "UN"), null);

  const { previewNote } = require("../src/purchase-notes");
  const parsed = parseNfeXml(FIXTURE).value;
  const remembered = { ...existingProduct, fator_conversao_padrao: 12, unidade_compra: "FD" };
  const preview = previewNote(parsed, [remembered, null, null]);
  assert.equal(preview.items[0].suggested.conversionFactor, 12);
  assert.equal(preview.items[0].suggested.purchaseUnit, "FD");
  assert.equal(preview.items[0].match.conversionFactor, 12);
  assert.equal(preview.items[1].suggested.conversionFactor, 1);
  assert.equal(preview.items[1].suggested.purchaseUnit, "UN");
});
