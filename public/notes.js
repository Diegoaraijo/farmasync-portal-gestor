/* Entrada de notas de compra pelo portal: importa o XML da NF-e ou digita a nota de papel,
   revisa item a item (mesmas regras do balcão) e envia para o FarmaSync lançar no estoque. */
(() => {
  "use strict";
  if (document.body.dataset.page !== "dashboard") return;

  const MAX_XML_BYTES = 1500000;
  const STATUS_LABEL = {
    PENDENTE: "Aguardando o balcão",
    PROCESSANDO: "Lançando no balcão",
    APLICADO: "Entrada concluída",
    FALHOU: "Não foi lançada",
    CANCELADO: "Cancelada",
  };
  const HEADER_IDS = {
    supplierName: "note-supplier",
    supplierDocument: "note-document",
    number: "note-number",
    issueDate: "note-issue-date",
    accessKey: "note-access-key",
  };
  const OUTCOME_LABEL = {
    ATUALIZADO: "Estoque atualizado",
    CRIADO: "Produto criado",
    JA_LANCADO: "Já estava lançado",
    IGNORADO: "Não lançado",
  };
  const ERROR_TEXT = {
    invalid_xml: "O arquivo não é um XML válido.",
    not_nfe: "Este XML não é de uma NF-e. Envie o XML da nota fiscal de compra.",
    unsupported_model: "Somente NF-e modelo 55 pode dar entrada.",
    invalid_access_key: "A chave de acesso da nota é inválida. Confira se o XML não foi alterado.",
    no_items: "Não foram encontrados itens válidos na nota.",
    too_many_items: "A nota tem itens demais para uma única entrada.",
    xml_too_large: "O XML é maior que 1,5 MB.",
    payload_too_large: "O arquivo é grande demais.",
    note_already_entered: "Esta nota já foi enviada ao balcão.",
    license_not_found: "Não foi possível identificar a licença desta farmácia.",
    reauth_required: "Confirme sua senha para continuar.",
  };

  let options = { categories: [], continuousUse: [], controlledTypes: [] };
  let notes = [];
  let draft = null;
  let pollTimer = null;
  let searchTimer = null;
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const money = (value) => currency.format(Number(value) || 0);
  const round2 = (value) => Math.round(value * 100) / 100;
  const num = (value) => {
    const parsed = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const todayIso = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const addDays = (iso, days) => {
    const date = new Date(`${iso}T12:00:00`);
    date.setDate(date.getDate() + days);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fold = (text) => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const icons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
    return node;
  }
  const icon = (name) => el("i", { "data-lucide": name });
  const button = (label, iconName, attrs = {}) => el("button", { type: "button", ...attrs }, iconName ? icon(iconName) : null, label ? el("span", {}, label) : null);

  function friendly(error, fallback = "Não foi possível concluir agora. Tente novamente.") {
    return error?.detail || ERROR_TEXT[error?.message] || fallback;
  }

  /* ---------- Lista de notas ---------- */

  function statusBadge(status) {
    return el("span", { class: `product-sync-badge ${String(status).toLowerCase()}` }, STATUS_LABEL[status] || status);
  }

  function noteCard(note) {
    const meta = [
      note.number ? `NF ${note.number}${note.series ? `/${note.series}` : ""}` : "Nota de papel",
      note.issueDate ? `emitida em ${formatDate(note.issueDate)}` : null,
      `${note.itemCount} ${note.itemCount === 1 ? "item" : "itens"}`,
      note.origin === "XML" ? "XML" : "Digitada",
    ].filter(Boolean).join(" · ");
    const counts = note.status === "APLICADO"
      ? `${note.counts.updated} atualizado(s) · ${note.counts.created} criado(s)${note.counts.ignored ? ` · ${note.counts.ignored} não lançado(s)` : ""}`
      : null;
    const card = el(
      "article",
      { class: `note-card ${note.status.toLowerCase()}` },
      el("div", { class: "note-card-main" }, el("strong", {}, note.supplierName || "Fornecedor não informado"), el("span", {}, meta),
        note.requestedAt ? el("small", {}, `Enviada em ${dateTime.format(new Date(note.requestedAt))}`) : null),
      el("div", { class: "note-card-value" }, el("span", {}, "Valor da nota"), el("strong", {}, money(note.totalValue))),
      el("div", { class: "note-card-status" }, statusBadge(note.status),
        counts ? el("small", {}, counts) : null,
        note.status === "FALHOU" && note.error ? el("small", { class: "note-error-text" }, note.error) : null),
      el(
        "div",
        { class: "note-card-actions" },
        button("Detalhes", "eye", { class: "secondary-button compact", "data-note-detail": note.id }),
        note.status === "PENDENTE" ? button("Cancelar", "ban", { class: "secondary-button compact", "data-note-cancel": note.id }) : null,
        note.status === "FALHOU" ? button("Tentar de novo", "rotate-cw", { class: "secondary-button compact", "data-note-retry": note.id }) : null,
      ),
    );
    return card;
  }

  function renderNotes() {
    const list = $("notes-list");
    list.replaceChildren(...notes.map(noteCard));
    list.hidden = notes.length === 0;
    $("notes-empty").hidden = notes.length > 0;
    icons();
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    const active = notes.some((note) => ["PENDENTE", "PROCESSANDO"].includes(note.status));
    pollTimer = window.setTimeout(loadNotes, active ? 5000 : 30000);
  }

  async function loadNotes() {
    try {
      if (!document.hidden) {
        const data = await api("/api/purchase-notes?limit=30");
        notes = data.notes;
        options = data.options || options;
        $("notes-error").hidden = true;
        renderNotes();
      }
    } catch (error) {
      if (error.message !== "unauthorized") $("notes-error").hidden = false;
    }
    $("notes-loading").hidden = true;
    schedulePoll();
  }

  function flash(message, tone = "ok") {
    const holder = $("notes-error");
    let banner = $("notes-flash");
    if (!banner) {
      banner = el("div", { id: "notes-flash", class: "notes-flash", role: "status" });
      holder.before(banner);
    }
    banner.className = `notes-flash ${tone}`;
    banner.textContent = message;
    banner.hidden = false;
    window.clearTimeout(flash.timer);
    flash.timer = window.setTimeout(() => { banner.hidden = true; }, 9000);
  }

  /* ---------- Diálogo ---------- */

  function openDialog(eyebrow, title) {
    $("note-dialog-eyebrow").textContent = eyebrow;
    $("note-dialog-title").textContent = title;
    const dialog = $("note-dialog");
    if (!dialog.open) dialog.showModal();
  }

  function setDialog(body, footer) {
    $("note-dialog-body").replaceChildren(...[].concat(body));
    $("note-dialog-footer").replaceChildren(...[].concat(footer || []));
    $("note-dialog-body").scrollTop = 0;
    icons();
  }

  function closeDialog() {
    draft = null;
    busy = false;
    const dialog = $("note-dialog");
    if (dialog.open) dialog.close();
  }

  function banner(text, tone = "error") {
    let node = $("note-banner");
    if (!node) {
      node = el("div", { id: "note-banner", role: "alert" });
      $("note-dialog-body").prepend(node);
    }
    node.className = `note-banner ${tone}`;
    node.textContent = text;
    node.hidden = !text;
    if (text) node.scrollIntoView({ block: "nearest" });
  }

  /* ---------- Entrada por XML ---------- */

  function startXml() {
    draft = { mode: "xml" };
    openDialog("Entrada de nota", "Importar XML da NF-e");
    const input = el("input", { id: "note-xml-input", type: "file", accept: ".xml,text/xml,application/xml", class: "note-file-input" });
    const zone = el(
      "label",
      { class: "note-dropzone", for: "note-xml-input" },
      icon("file-up"),
      el("strong", {}, "Escolher o XML da nota"),
      el("span", {}, "Toque aqui ou arraste o arquivo. O XML é o arquivo que o fornecedor envia por e-mail ou WhatsApp."),
      input,
    );
    input.addEventListener("change", () => input.files[0] && handleXmlFile(input.files[0]));
    for (const type of ["dragover", "dragenter"]) zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add("dragging"); });
    for (const type of ["dragleave", "drop"]) zone.addEventListener(type, () => zone.classList.remove("dragging"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      if (event.dataTransfer.files[0]) handleXmlFile(event.dataTransfer.files[0]);
    });
    setDialog(
      [el("div", { id: "note-banner", class: "note-banner", hidden: true }), zone,
        el("p", { class: "note-help" }, "Só tem a nota em papel? Feche esta janela e use ", el("strong", {}, "Digitar nota de papel"), ".")],
      button("Cancelar", null, { class: "secondary-button", onclick: closeDialog }),
    );
  }

  async function readXml(file) {
    const buffer = await file.arrayBuffer();
    const head = new TextDecoder("latin1").decode(buffer.slice(0, 200));
    const declared = /encoding=["']([^"']+)["']/i.exec(head)?.[1] || "utf-8";
    try {
      return new TextDecoder(declared).decode(buffer);
    } catch (_error) {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }

  async function handleXmlFile(file) {
    if (busy) return;
    if (file.size > MAX_XML_BYTES) return banner(ERROR_TEXT.xml_too_large);
    if (!/\.xml$/i.test(file.name) && !/xml/i.test(file.type)) return banner("Escolha o arquivo XML da nota (termina em .xml).");
    busy = true;
    banner("Lendo a nota e conferindo os produtos...", "info");
    try {
      const xml = await readXml(file);
      const data = await api("/api/purchase-notes/preview", { method: "POST", body: JSON.stringify({ xml }) });
      options = data.options || options;
      draft = {
        mode: "xml",
        xml,
        note: data.note,
        duplicate: data.duplicate,
        items: data.note.items.map(previewItem),
        installments: data.note.installments.map((entry) => ({ number: entry.number || "", dueDate: entry.dueDate || "", amount: String(entry.amount) })),
        registerSupplier: true,
        createPayable: true,
      };
      busy = false;
      renderReview();
    } catch (error) {
      busy = false;
      banner(friendly(error));
    }
  }

  /* ---------- Fator de conversão (embalagem de compra -> unidade de venda) ---------- */

  const factorOf = (item) => {
    const parsed = Number(String(item.conversionFactor ?? "").replace(",", "."));
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  };
  const realCost = (item) => num(item.unitCost) / factorOf(item);
  const unitMoney = (value) => `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)}`;

  function conversionText(item) {
    const packages = num(item.quantity);
    const factor = factorOf(item);
    const total = Math.round(packages * factor * 10000) / 10000;
    if (!(total > 0)) return "Informe a quantidade de embalagens para ver o resumo.";
    let text = `Entrarão ${quantityNumber.format(total)} ${total === 1 ? "unidade" : "unidades"} no estoque`;
    if (factor > 1) text += ` (${quantityNumber.format(packages)} × ${factor})`;
    if (num(item.unitCost) > 0) text += ` | Custo unitário real: ${unitMoney(realCost(item))}/un`;
    return text;
  }

  function updateConversion(card, item) {
    const box = card.querySelector("[data-conversion]");
    if (!box) return;
    box.textContent = conversionText(item);
    const fractional = factorOf(item) > 1 && !Number.isInteger(Math.round(num(item.quantity) * factorOf(item) * 10000) / 10000);
    box.classList.toggle("warn", fractional);
    if (fractional) box.textContent += " — a quantidade total precisa ser inteira.";
  }

  function previewItem(item) {
    const suggested = item.suggested;
    return {
      key: item.index,
      include: suggested.include,
      code: item.code,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      declaredCost: item.unitCost,
      match: item.match,
      fixed: true,
      multipleLots: item.multipleLots,
      unitCost: String(item.unitCost),
      conversionFactor: String(suggested.conversionFactor || 1),
      purchaseUnit: suggested.purchaseUnit || item.unit || "UN",
      salePrice: suggested.salePrice ? String(suggested.salePrice) : "",
      margin: suggested.salePrice && item.unitCost > 0 ? String(suggested.marginPercent) : "",
      promoPrice: suggested.promoPrice ? String(suggested.promoPrice) : "",
      category: suggested.category || "",
      continuousUse: suggested.continuousUse || "",
      controlledType: suggested.controlledType || "",
      expiry: suggested.expiry || "",
    };
  }

  /* ---------- Entrada digitada (nota de papel) ---------- */

  async function startManual() {
    if (!options.categories.length) await loadNotes();
    draft = {
      mode: "manual",
      items: [],
      installments: [],
      registerSupplier: true,
      createPayable: true,
      header: { supplierName: "", supplierDocument: "", number: "", issueDate: todayIso(), accessKey: "" },
      nextKey: 1,
    };
    openDialog("Entrada de nota", "Digitar nota de papel");
    renderManual();
  }

  function manualField(id, label, attrs = {}, hint) {
    return el("label", { class: "note-field" }, el("span", { class: "note-field-label" }, label),
      el("input", { id, autocomplete: "off", ...attrs }), hint ? el("small", {}, hint) : null,
      el("span", { id: `${id}-error`, class: "field-error", role: "alert", hidden: true }));
  }

  function renderManual() {
    const header = draft.header;
    const bind = (id, key) => {
      const input = $(id);
      input.value = header[key];
      input.addEventListener("input", () => {
        header[key] = input.value;
        input.removeAttribute("aria-invalid");
        $(`${id}-error`).hidden = true;
      });
    };
    const search = el("div", { class: "note-search" },
      el("label", { class: "product-search" }, icon("search"),
        el("input", { id: "note-product-search", type: "search", placeholder: "Buscar produto cadastrado por nome ou código", autocomplete: "off", maxlength: "100", "aria-label": "Buscar produto cadastrado" })),
      el("div", { id: "note-search-results", class: "note-search-results", hidden: true }),
      button("Produto não cadastrado", "package-plus", { class: "secondary-button compact", onclick: addManualNewItem }));
    setDialog(
      [
        el("div", { id: "note-banner", class: "note-banner", hidden: true }),
        el("section", { class: "note-block" },
          el("h4", {}, "Dados da nota"),
          el("div", { class: "note-grid" },
            manualField("note-supplier", "Fornecedor *", { maxlength: "200" }),
            manualField("note-document", "CNPJ/CPF do fornecedor", { inputmode: "numeric", maxlength: "18" }, "Opcional. Usado para cadastrar o fornecedor."),
            manualField("note-number", "Número da nota *", { maxlength: "20", inputmode: "numeric" }),
            manualField("note-issue-date", "Data de emissão *", { type: "date", max: todayIso() }),
            manualField("note-access-key", "Chave de acesso (44 números)", { inputmode: "numeric", maxlength: "54" }, "Opcional. Com a chave, a nota entra no relatório de NF-e importadas.")),
        ),
        el("section", { class: "note-block" }, el("h4", {}, "Produtos da nota"), search, el("div", { id: "note-items", class: "note-items" }),
          el("p", { id: "note-total", class: "note-total" })),
        installmentsBlock(),
      ],
      confirmFooter("Confirmar entrada"),
    );
    bind("note-supplier", "supplierName");
    bind("note-document", "supplierDocument");
    bind("note-number", "number");
    bind("note-issue-date", "issueDate");
    bind("note-access-key", "accessKey");
    $("note-product-search").addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(searchProducts, 250);
    });
    renderItems();
    renderInstallments();
  }

  async function searchProducts() {
    const term = $("note-product-search")?.value.trim();
    const holder = $("note-search-results");
    if (!holder) return;
    if (!term) {
      holder.hidden = true;
      return;
    }
    try {
      const data = await api(`/api/products?limit=8&search=${encodeURIComponent(term)}`);
      holder.replaceChildren(...(data.products.length ? data.products.map((product) => {
        const unusable = !product.code || product.kind === "parent";
        return el("button", { type: "button", class: "note-search-result", disabled: unusable, "data-product": product.id },
          el("strong", {}, product.name),
          el("span", {}, product.code ? `Código ${product.code}` : "Sem código"),
          el("span", {}, `Estoque ${quantityNumber.format(product.stock)} · ${money(product.salePrice)}`),
          unusable ? el("small", {}, product.kind === "parent" ? "Tem modelos: dê entrada pelo modelo" : "Cadastre o código no balcão") : null);
      }) : [el("p", { class: "history-message" }, "Nenhum produto encontrado. Use \"Produto não cadastrado\".")]));
      holder.hidden = false;
      holder.onclick = (event) => {
        const target = event.target.closest("[data-product]");
        const product = data.products.find((entry) => String(entry.id) === target?.dataset.product);
        if (!product) return;
        addManualCatalogItem(product);
        $("note-product-search").value = "";
        holder.hidden = true;
      };
    } catch (_error) {
      holder.replaceChildren(el("p", { class: "history-message error" }, "Não foi possível buscar agora."));
      holder.hidden = false;
    }
  }

  function manualItemBase() {
    return {
      key: draft.nextKey++, include: true, quantity: 1, unit: "", fixed: false, match: null, conversionFactor: "1", purchaseUnit: "UN",
      unitCost: "", salePrice: "", margin: "", promoPrice: "", category: "", continuousUse: "", controlledType: "", expiry: "",
      code: "", description: "",
    };
  }

  function canonicalOption(list, value) {
    const wanted = fold(value);
    return wanted ? list.find((option) => fold(option) === wanted) || "" : "";
  }

  function addManualCatalogItem(product) {
    draft.items.push({
      ...manualItemBase(),
      code: product.code,
      description: product.name,
      catalog: true,
      match: { productId: product.id, name: product.name, category: product.category, salePrice: product.salePrice, stock: product.stock, kind: product.kind },
      salePrice: product.salePrice ? String(product.salePrice) : "",
      conversionFactor: String(product.conversionFactor || 1),
      unit: product.purchaseUnit && product.purchaseUnit !== "UN" ? product.purchaseUnit : "",
      purchaseUnit: product.purchaseUnit || "UN",
      promoPrice: product.promoPrice ? String(product.promoPrice) : "",
      category: canonicalOption(options.categories, product.category),
    });
    renderItems();
    focusLastItem();
  }

  function addManualNewItem() {
    draft.items.push(manualItemBase());
    renderItems();
    focusLastItem();
  }

  function focusLastItem() {
    const cards = document.querySelectorAll(".note-item");
    const last = cards[cards.length - 1];
    last?.scrollIntoView({ block: "center", behavior: "smooth" });
    (last?.querySelector("[data-field='code']") || last?.querySelector("[data-field='quantity']"))?.focus({ preventScroll: true });
  }

  /* ---------- Itens ---------- */

  const FIELDS = [
    { key: "unitCost", label: "Custo da embalagem (R$)", type: "number", step: "0.01", min: "0" },
    { key: "conversionFactor", label: "Fator de conversão (un. por embalagem)", type: "number", step: "1", min: "1", numeric: true },
    { key: "salePrice", label: "PMC / preço de venda (R$) *", type: "number", step: "0.01", min: "0" },
    { key: "margin", label: "Margem de lucro (%)", type: "number", step: "0.01" },
    { key: "promoPrice", label: "Preço promocional (opcional)", type: "number", step: "0.01", min: "0" },
    { key: "category", label: "Categoria", select: "categories", blank: "Escolha" },
    { key: "continuousUse", label: "Uso contínuo", select: "continuousUse", blank: "" },
    { key: "controlledType", label: "Tipo controlado (SNGPC)", select: "controlledTypes", blank: "Não controlado" },
    { key: "expiry", label: "Validade *", type: "date", min: todayIso() },
  ];

  function fieldControl(item, position, field) {
    const common = { "data-item": position, "data-field": field.key, id: `note-item-${position}-${field.key}` };
    if (field.select) {
      const blank = field.key === "continuousUse" ? (item.match ? "Manter o atual" : "Escolha") : field.blank;
      const control = el("select", common, el("option", { value: "" }, blank),
        ...options[field.select].map((option) => el("option", { value: option }, option)));
      control.value = item[field.key];
      return control;
    }
    const control = el("input", { ...common, type: field.type, step: field.step, min: field.min, inputmode: field.type === "number" ? (field.numeric ? "numeric" : "decimal") : null, autocomplete: "off" });
    control.value = item[field.key];
    return control;
  }

  function itemBadge(item) {
    if (item.match?.kind === "parent") return el("span", { class: "product-tag neutral" }, "Produto com modelos");
    if (item.match) return el("span", { class: "product-tag promo" }, `Cadastrado · estoque ${quantityNumber.format(item.match.stock)}`);
    return el("span", { class: "product-tag warning" }, "Produto novo");
  }

  function itemCard(item, position) {
    const parent = item.match?.kind === "parent";
    const manual = draft.mode === "manual";
    const toggleLabel = item.match ? "Dar entrada neste item" : "Criar produto e dar entrada";
    const head = el("header", { class: "note-item-head" },
      manual
        ? el("strong", {}, item.catalog ? item.description : "Produto não cadastrado")
        : el("label", { class: "note-include" },
          el("input", { type: "checkbox", "data-item": position, "data-field": "include", checked: item.include, disabled: parent, "aria-label": toggleLabel }),
          el("strong", {}, item.description)),
      itemBadge(item),
      manual ? button("", "trash-2", { class: "icon-button", "data-remove-item": position, title: "Remover item", "aria-label": "Remover item" }) : null);
    const meta = el("p", { class: "note-item-meta" },
      item.code ? `Código ${item.code}` : "",
      !manual ? ` · ${quantityNumber.format(item.quantity)} ${item.unit || "emb."} · custo da embalagem na nota ${money(item.declaredCost)}` : "",
      item.multipleLots ? " · vários lotes: usada a menor validade" : "",
      parent ? " · dê entrada pelo modelo no balcão" : "");
    const body = el("div", { class: "note-item-body" });
    if (manual) {
      const top = el("div", { class: "note-grid" });
      if (!item.catalog) {
        top.append(
          el("label", { class: "note-field" }, el("span", { class: "note-field-label" }, "Código / EAN *"),
            el("input", { "data-item": position, "data-field": "code", value: item.code, maxlength: "100", autocomplete: "off", id: `note-item-${position}-code` }),
            el("span", { class: "field-error", role: "alert", hidden: true })),
          el("label", { class: "note-field wide" }, el("span", { class: "note-field-label" }, "Descrição *"),
            el("input", { "data-item": position, "data-field": "description", value: item.description, maxlength: "255", autocomplete: "off", id: `note-item-${position}-description` }),
            el("span", { class: "field-error", role: "alert", hidden: true })));
      }
      top.append(el("label", { class: "note-field" }, el("span", { class: "note-field-label" }, "Qtd. de embalagens (compra) *"),
        el("input", { "data-item": position, "data-field": "quantity", type: "number", min: "1", step: "1", inputmode: "numeric", value: item.quantity, id: `note-item-${position}-quantity` }),
        el("span", { class: "field-error", role: "alert", hidden: true })));
      body.append(top);
    }
    if (!parent) {
      body.append(el("div", { class: "note-grid" }, ...FIELDS.map((field) => el("label", { class: "note-field", "data-wrap": field.key },
        el("span", { class: "note-field-label" }, field.label), fieldControl(item, position, field),
        field.key === "margin" ? el("small", { class: "note-hint", "data-hint": "margin" }) : null,
        el("span", { class: "field-error", role: "alert", hidden: true })))),
        el("p", { class: "note-conversion", "data-conversion": "" }));
    }
    const card = el("article", { class: `note-item${item.include ? "" : " excluded"}${parent ? " parent" : ""}`, "data-card": position }, head, meta, body);
    updateHint(card, item);
    updateConversion(card, item);
    return card;
  }

  function renderItems() {
    const holder = $("note-items");
    holder.replaceChildren(...draft.items.map(itemCard));
    if (draft.mode === "manual" && !draft.items.length) {
      holder.append(el("p", { class: "history-message" }, "Busque um produto cadastrado ou adicione um produto novo para começar."));
    }
    updateTotals();
    icons();
  }

  function updateHint(card, item) {
    const hint = card.querySelector("[data-hint='margin']");
    if (!hint) return;
    const cost = realCost(item);
    const sale = num(item.salePrice);
    hint.textContent = cost > 0 && sale > 0 && sale < cost ? "Atenção: preço de venda abaixo do custo unitário real." : "";
    hint.classList.toggle("warn", Boolean(hint.textContent));
  }

  function setField(card, key, value) {
    const control = card.querySelector(`[data-field="${key}"]`);
    if (control) control.value = value;
  }

  // A margem e o preço de venda sempre partem do custo unitário real (custo da embalagem / fator).
  function syncPrices(item, field, card) {
    const cost = realCost(item);
    if (field === "salePrice" || field === "unitCost" || field === "conversionFactor") {
      const sale = num(item.salePrice);
      item.margin = cost > 0 && sale > 0 ? String(round2((sale / cost - 1) * 100)) : "";
      setField(card, "margin", item.margin);
    } else if (field === "margin" && cost > 0 && item.margin !== "") {
      item.salePrice = String(round2(cost * (1 + num(item.margin) / 100)));
      setField(card, "salePrice", item.salePrice);
    }
    updateHint(card, item);
    updateConversion(card, item);
  }

  function updateTotals() {
    const total = $("note-total");
    if (!total || draft?.mode !== "manual") return;
    const sum = draft.items.filter((item) => item.include).reduce((value, item) => value + num(item.quantity) * num(item.unitCost), 0);
    total.textContent = draft.items.length ? `Total da nota (itens): ${money(round2(sum))}` : "";
  }

  function clearItemError(card, key) {
    const wrap = card.querySelector(`[data-field="${key}"]`)?.closest(".note-field");
    wrap?.classList.remove("invalid");
    const message = wrap?.querySelector(".field-error");
    if (message) message.hidden = true;
    card.querySelector(`[data-field="${key}"]`)?.removeAttribute("aria-invalid");
  }

  function showItemError(position, key, message) {
    const card = document.querySelector(`[data-card="${position}"]`);
    const control = card?.querySelector(`[data-field="${key}"]`);
    if (!card) return false;
    const wrap = control?.closest(".note-field");
    wrap?.classList.add("invalid");
    control?.setAttribute("aria-invalid", "true");
    const holder = wrap?.querySelector(".field-error");
    if (holder) {
      holder.textContent = message;
      holder.hidden = false;
    }
    card.classList.add("has-error");
    return true;
  }

  function onItemInput(event) {
    const control = event.target.closest("[data-item][data-field]");
    if (!control || !draft) return;
    const position = Number(control.dataset.item);
    const item = draft.items[position];
    const card = control.closest(".note-item");
    const key = control.dataset.field;
    if (!item) return;
    item[key] = control.type === "checkbox" ? control.checked : control.value;
    clearItemError(card, key);
    card.classList.remove("has-error");
    if (key === "include") {
      card.classList.toggle("excluded", !item.include);
    }
    syncPrices(item, key, card);
    updateTotals();
  }

  /* ---------- Vencimentos e opções ---------- */

  function installmentsBlock() {
    return el("section", { class: "note-block" },
      el("h4", {}, "Contas a pagar"),
      el("label", { class: "note-check" }, el("input", { id: "note-create-payable", type: "checkbox", checked: draft.createPayable }), el("span", {}, "Gerar contas a pagar (boletos) desta nota")),
      el("div", { id: "note-installments-area" },
        el("div", { class: "note-quick" },
          el("label", { class: "note-field" }, el("span", { class: "note-field-label" }, "Parcelamento rápido"),
            el("select", { id: "note-quick-installments" },
              el("option", { value: "" }, "Escolha para preencher"), el("option", { value: "0" }, "À vista (hoje)"),
              el("option", { value: "30" }, "30 dias"), el("option", { value: "30,60" }, "30/60 dias"), el("option", { value: "30,60,90" }, "30/60/90 dias")))),
        el("div", { id: "note-installments", class: "note-installments" }),
        button("Adicionar vencimento", "plus", { class: "secondary-button compact", id: "note-add-installment" }),
        el("p", { id: "note-installments-sum", class: "note-help" }),
        el("p", { class: "note-help" }, "Sem vencimentos informados, o sistema gera um boleto para 30 dias após a emissão, como na importação de XML.")),
      el("label", { class: "note-check" }, el("input", { id: "note-register-supplier", type: "checkbox", checked: draft.registerSupplier }), el("span", {}, "Cadastrar o fornecedor se ainda não existir")));
  }

  function noteTotal() {
    if (draft.mode === "xml") return draft.note.totals.invoice;
    return round2(draft.items.filter((item) => item.include).reduce((value, item) => value + num(item.quantity) * num(item.unitCost), 0));
  }

  function renderInstallments() {
    const holder = $("note-installments");
    if (!holder) return;
    holder.replaceChildren(...draft.installments.map((entry, position) => el("div", { class: "note-installment" },
      el("input", { type: "date", value: entry.dueDate, "data-installment": position, "data-installment-field": "dueDate", "aria-label": `Vencimento ${position + 1}` }),
      el("input", { type: "number", step: "0.01", min: "0", inputmode: "decimal", value: entry.amount, "data-installment": position, "data-installment-field": "amount", "aria-label": `Valor ${position + 1}` }),
      button("", "trash-2", { class: "icon-button", "data-remove-installment": position, title: "Remover vencimento", "aria-label": `Remover vencimento ${position + 1}` }))));
    $("note-installments-area").hidden = !draft.createPayable;
    updateInstallmentSum();
    icons();
  }

  function updateInstallmentSum() {
    const holder = $("note-installments-sum");
    if (!holder) return;
    const sum = round2(draft.installments.reduce((value, entry) => value + num(entry.amount), 0));
    const total = noteTotal();
    holder.textContent = draft.installments.length ? `Soma dos vencimentos: ${money(sum)} · valor da nota: ${money(total)}` : "";
    holder.classList.toggle("warn", draft.installments.length > 0 && Math.abs(sum - total) > 0.05);
  }

  function quickInstallments(value) {
    if (!value) return;
    const days = value.split(",").map(Number);
    const total = noteTotal();
    const base = draft.mode === "xml" ? draft.note.issueDate || todayIso() : draft.header.issueDate || todayIso();
    const cents = Math.round(total * 100);
    draft.installments = days.map((offset, position) => {
      const share = Math.floor(cents / days.length) + (position === days.length - 1 ? cents % days.length : 0);
      return { number: "", dueDate: addDays(value === "0" ? todayIso() : base, offset), amount: (share / 100).toFixed(2) };
    });
    renderInstallments();
  }

  function onInstallmentEvent(event) {
    const control = event.target.closest("[data-installment]");
    if (control && draft) {
      draft.installments[Number(control.dataset.installment)][control.dataset.installmentField] = control.value;
      updateInstallmentSum();
    }
  }

  /* ---------- Validação e envio ---------- */

  function itemProblems(item) {
    const problems = {};
    if (!item.include) return problems;
    if (draft.mode === "manual") {
      if (!item.code.trim()) problems.code = "Informe o código ou EAN.";
      if (item.description.trim().length < 2) problems.description = "Informe a descrição.";
      const quantity = num(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) problems.quantity = "Use um número inteiro maior que zero.";
    }
    const sale = num(item.salePrice);
    const rawFactor = String(item.conversionFactor ?? "").trim();
    if (rawFactor !== "" && (!Number.isInteger(Number(rawFactor)) || Number(rawFactor) < 1 || Number(rawFactor) > 100000)) {
      problems.conversionFactor = "Use um número inteiro de 1 a 100000.";
    } else if (factorOf(item) > 1 && !Number.isInteger(Math.round(num(item.quantity) * factorOf(item) * 10000) / 10000)) {
      problems.conversionFactor = "A quantidade total de unidades precisa ser inteira.";
    }
    if (sale <= 0) problems.salePrice = "Informe o PMC / preço de venda.";
    if (item.promoPrice !== "" && (num(item.promoPrice) <= 0 || num(item.promoPrice) >= sale)) problems.promoPrice = "Deve ser menor que o preço de venda.";
    if (!item.expiry) problems.expiry = "A validade é obrigatória.";
    else if (item.expiry < todayIso()) problems.expiry = "Validade já vencida: confira a data.";
    if (!item.match && item.category !== "Perfumaria" && !item.continuousUse) problems.continuousUse = "Escolha o tipo de uso (opcional só para Perfumaria).";
    return problems;
  }

  function headerProblems() {
    const header = draft.header;
    const problems = {};
    if (header.supplierName.trim().length < 2) problems["note-supplier"] = "Informe o fornecedor.";
    const document = header.supplierDocument.replace(/\D/g, "");
    if (document && ![11, 14].includes(document.length)) problems["note-document"] = "Informe um CNPJ (14) ou CPF (11).";
    if (!/^[0-9A-Za-z./-]{1,20}$/.test(header.number.trim())) problems["note-number"] = "Informe o número da nota.";
    if (!header.issueDate || header.issueDate > todayIso()) problems["note-issue-date"] = "Informe a data de emissão (até hoje).";
    const key = header.accessKey.replace(/\D/g, "");
    if (header.accessKey.trim() && key.length !== 44) problems["note-access-key"] = "A chave tem 44 números.";
    return problems;
  }

  function showHeaderProblems(problems) {
    let first = null;
    for (const [id, message] of Object.entries(problems)) {
      const input = $(id);
      input.setAttribute("aria-invalid", "true");
      $(`${id}-error`).textContent = message;
      $(`${id}-error`).hidden = false;
      first ||= input;
    }
    return first;
  }

  function validateDraft() {
    document.querySelectorAll(".note-item.has-error").forEach((card) => card.classList.remove("has-error"));
    let firstControl = null;
    if (draft.mode === "manual") {
      const problems = headerProblems();
      firstControl = showHeaderProblems(problems);
      if (!draft.items.some((item) => item.include)) {
        banner("Adicione pelo menos um produto à nota.");
        return firstControl || $("note-product-search");
      }
    } else if (!draft.items.some((item) => item.include)) {
      banner("Mantenha pelo menos um item marcado para dar entrada.");
      return document.querySelector("[data-field='include']");
    }
    draft.items.forEach((item, position) => {
      for (const [key, message] of Object.entries(itemProblems(item))) {
        showItemError(position, key, message);
        firstControl ||= document.querySelector(`[data-card="${position}"] [data-field="${key}"]`);
      }
    });
    if (draft.createPayable) {
      const invalid = draft.installments.some((entry) => !entry.dueDate || num(entry.amount) <= 0);
      if (invalid) {
        banner("Confira os vencimentos: informe data e valor em todas as linhas ou remova a linha.");
        firstControl ||= $("note-installments").querySelector("input");
      }
    }
    return firstControl;
  }

  function buildPayload() {
    const reviewed = draft.items.map((item) => ({
      ...(draft.mode === "xml" ? { index: item.key } : { code: item.code.trim(), description: item.description.trim(), quantity: num(item.quantity), unit: item.unit }),
      include: item.include,
      unitCost: item.unitCost === "" ? undefined : num(item.unitCost),
      conversionFactor: factorOf(item),
      salePrice: item.salePrice === "" ? undefined : num(item.salePrice),
      promoPrice: item.promoPrice === "" ? null : num(item.promoPrice),
      category: item.category,
      continuousUse: item.continuousUse,
      controlledType: item.controlledType,
      expiry: item.expiry,
    }));
    const payload = {
      mode: draft.mode,
      items: reviewed,
      installments: draft.createPayable ? draft.installments.map((entry) => ({ number: entry.number || undefined, dueDate: entry.dueDate, amount: num(entry.amount) })) : [],
      options: { registerSupplier: draft.registerSupplier, createPayable: draft.createPayable },
    };
    if (draft.mode === "xml") payload.xml = draft.xml;
    else payload.header = { ...draft.header };
    return payload;
  }

  function itemPositionFromServer(error) {
    if (draft.mode === "xml") return draft.items.findIndex((item) => item.key === error.item);
    return Number(error.item) - 1;
  }

  async function submit() {
    if (busy || !draft) return;
    banner("");
    const first = validateDraft();
    if (first) {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      first.focus({ preventScroll: true });
      if (!$("note-banner").textContent) banner("Corrija os campos destacados para continuar.");
      return;
    }
    busy = true;
    const confirm = $("note-confirm");
    confirm.disabled = true;
    confirm.querySelector("span").textContent = "Enviando...";
    try {
      const result = await api("/api/purchase-notes", { method: "POST", body: JSON.stringify(buildPayload()) });
      busy = false;
      closeDialog();
      flash(`Nota enviada (#${result.id}). O FarmaSync lança no balcão em instantes: acompanhe o andamento abaixo.`);
      await loadNotes();
      $("notes-list").scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      busy = false;
      confirm.disabled = false;
      confirm.querySelector("span").textContent = "Confirmar entrada";
      if (error.message === "invalid_item") {
        const position = itemPositionFromServer(error);
        if (showItemError(position, error.field, error.detail || "Confira este campo.")) {
          document.querySelector(`[data-card="${position}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        banner(error.detail || "Confira os itens destacados.");
      } else if (error.message === "invalid_note" && HEADER_IDS[error.field]) {
        const id = HEADER_IDS[error.field];
        showHeaderProblems({ [id]: error.detail || "Confira este campo." });
        $(id).focus();
        banner(error.detail || "Confira os dados da nota.");
      } else if (error.message === "note_already_entered") {
        banner(`Esta nota já foi enviada${error.existingId ? ` (#${error.existingId})` : ""}. Veja a lista de notas.`);
      } else {
        banner(friendly(error));
      }
    }
  }

  function confirmFooter(label) {
    return [
      button("Cancelar", null, { class: "secondary-button", onclick: closeDialog }),
      button(label, "cloud-upload", { id: "note-confirm", class: "primary-button", onclick: submit }),
    ];
  }

  /* ---------- Revisão do XML ---------- */

  function summaryRow(label, value) {
    return el("div", {}, el("span", {}, label), el("strong", {}, value || "—"));
  }

  function renderReview() {
    const note = draft.note;
    const matched = draft.items.filter((item) => item.match).length;
    const fresh = draft.items.filter((item) => !item.match).length;
    const blocks = [el("div", { id: "note-banner", class: "note-banner", hidden: true })];
    if (draft.duplicate) {
      blocks.push(el("div", { class: "note-banner error", role: "alert" },
        `Esta nota já foi enviada (#${draft.duplicate.id}, ${STATUS_LABEL[draft.duplicate.status] || draft.duplicate.status}). Não é possível dar entrada duas vezes.`));
    }
    blocks.push(el("section", { class: "note-summary" },
      summaryRow("Fornecedor", note.supplier.name),
      summaryRow("CNPJ/CPF", note.supplier.document),
      summaryRow("Nota", `${note.number}${note.series ? `/${note.series}` : ""}`),
      summaryRow("Emissão", note.issueDate ? formatDate(note.issueDate) : ""),
      summaryRow("Valor da nota", money(note.totals.invoice)),
      summaryRow("Itens", `${draft.items.length} (${matched} cadastrados, ${fresh} novos)`),
      el("div", { class: "wide" }, el("span", {}, "Chave de acesso"), el("strong", { class: "note-key" }, note.accessKey))));
    if (note.skippedItems) {
      blocks.push(el("div", { class: "note-banner info" }, `${note.skippedItems} item(ns) da nota sem código ou quantidade foram ignorados, como no balcão.`));
    }
    blocks.push(el("section", { class: "note-block" }, el("h4", {}, "Revise os produtos"),
      el("p", { class: "note-help" }, "Confira preços, validade e categoria. Itens novos exigem o tipo de uso (opcional só para Perfumaria). Desmarque o que não deve entrar."),
      el("div", { id: "note-items", class: "note-items" })));
    blocks.push(installmentsBlock());
    setDialog(blocks, [
      button("Voltar", null, { class: "secondary-button", onclick: startXml }),
      button("Confirmar entrada", "cloud-upload", { id: "note-confirm", class: "primary-button", onclick: submit, disabled: Boolean(draft.duplicate) }),
    ]);
    renderItems();
    renderInstallments();
    openDialog("Entrada de nota", `Revisar NF ${note.number}`);
  }

  /* ---------- Detalhes, cancelar e tentar de novo ---------- */

  async function showDetail(id) {
    openDialog("Entrada de nota", "Detalhes da nota");
    setDialog(el("p", { class: "history-message" }, "Carregando..."), button("Fechar", null, { class: "secondary-button", onclick: closeDialog }));
    try {
      const note = await api(`/api/purchase-notes/${id}`);
      const rows = note.items.map((item) => el("div", { class: "note-detail-item" },
        el("div", {}, el("strong", {}, item.description), el("span", {}, `Código ${item.code} · ${quantityNumber.format(item.quantity)} un${item.conversionFactor > 1 ? ` (${quantityNumber.format(item.purchasedQuantity)} ${item.purchaseUnit || "emb."} × ${item.conversionFactor}, custo da embalagem ${money(item.packageCost)}, unitário real ${unitMoney(item.unitCost)})` : ""} · venda ${money(item.salePrice)}${item.expiry ? ` · validade ${formatDate(item.expiry)}` : ""}`)),
        item.outcome ? el("span", { class: `product-tag ${item.outcome === "IGNORADO" ? "danger" : item.outcome === "CRIADO" ? "promo" : "neutral"}`, title: item.message || "" }, OUTCOME_LABEL[item.outcome] || item.outcome) : null,
        item.message && item.outcome ? el("small", {}, item.message) : null));
      const parts = [
        el("section", { class: "note-summary" },
          summaryRow("Fornecedor", note.supplierName), summaryRow("Nota", note.number ? `${note.number}${note.series ? `/${note.series}` : ""}` : "Nota de papel"),
          summaryRow("Valor", money(note.totalValue)), summaryRow("Situação", STATUS_LABEL[note.status]),
          summaryRow("Contas a pagar", note.options?.createPayable === false ? "Não geradas" : `${note.payables} vencimento(s)`),
          note.accessKey ? el("div", { class: "wide" }, el("span", {}, "Chave de acesso"), el("strong", { class: "note-key" }, note.accessKey)) : null),
      ];
      if (note.error) parts.push(el("div", { class: "note-banner error" }, note.error));
      for (const warning of note.warnings) parts.push(el("div", { class: "note-banner info" }, warning));
      parts.push(el("section", { class: "note-block" }, el("h4", {}, "Itens"), ...rows));
      const footer = [button("Fechar", null, { class: "secondary-button", onclick: closeDialog })];
      if (note.status === "PENDENTE") footer.push(button("Cancelar entrada", "ban", { class: "secondary-button", onclick: () => cancelNote(note.id) }));
      if (note.status === "FALHOU") footer.push(button("Tentar de novo", "rotate-cw", { class: "primary-button", onclick: () => retryNote(note.id) }));
      setDialog(parts, footer);
    } catch (error) {
      setDialog(el("div", { class: "note-banner error" }, friendly(error, "Não foi possível carregar a nota.")), button("Fechar", null, { class: "secondary-button", onclick: closeDialog }));
    }
  }

  async function cancelNote(id) {
    if (!window.confirm("Cancelar esta entrada? A nota não será lançada no balcão.")) return;
    try {
      await api(`/api/purchase-notes/${id}/cancel`, { method: "POST", body: "{}" });
      closeDialog();
      flash("Entrada cancelada.");
    } catch (error) {
      closeDialog();
      flash(error.message === "note_not_cancellable" ? "O balcão já começou a lançar esta nota e ela não pode mais ser cancelada." : friendly(error), "error");
    }
    loadNotes();
  }

  async function retryNote(id) {
    try {
      await api(`/api/purchase-notes/${id}/retry`, { method: "POST", body: "{}" });
      closeDialog();
      flash("Nota reenviada ao balcão.");
    } catch (error) {
      closeDialog();
      flash(error.message === "note_already_entered" ? "Esta nota já foi enviada em outra entrada." : friendly(error), "error");
    }
    loadNotes();
  }

  /* ---------- Inicialização ---------- */

  function initialize() {
    $("note-start-xml")?.addEventListener("click", startXml);
    $("note-start-manual")?.addEventListener("click", startManual);
    $("note-dialog-close")?.addEventListener("click", closeDialog);
    $("note-dialog")?.addEventListener("cancel", () => { draft = null; busy = false; });
    $("note-dialog")?.addEventListener("close", () => { draft = null; });
    $("notes-list")?.addEventListener("click", (event) => {
      const detail = event.target.closest("[data-note-detail]");
      const cancel = event.target.closest("[data-note-cancel]");
      const retry = event.target.closest("[data-note-retry]");
      if (detail) showDetail(detail.dataset.noteDetail);
      if (cancel) cancelNote(cancel.dataset.noteCancel);
      if (retry) retryNote(retry.dataset.noteRetry);
    });
    const body = $("note-dialog-body");
    body.addEventListener("input", (event) => { onItemInput(event); onInstallmentEvent(event); });
    body.addEventListener("change", (event) => {
      onItemInput(event);
      onInstallmentEvent(event);
      if (event.target.id === "note-quick-installments") { quickInstallments(event.target.value); event.target.value = ""; }
      if (event.target.id === "note-create-payable") { draft.createPayable = event.target.checked; renderInstallments(); }
      if (event.target.id === "note-register-supplier") draft.registerSupplier = event.target.checked;
    });
    body.addEventListener("click", (event) => {
      const removeItem = event.target.closest("[data-remove-item]");
      const removeInstallment = event.target.closest("[data-remove-installment]");
      if (removeItem) { draft.items.splice(Number(removeItem.dataset.removeItem), 1); renderItems(); }
      if (removeInstallment) { draft.installments.splice(Number(removeInstallment.dataset.removeInstallment), 1); renderInstallments(); }
      if (event.target.closest("#note-add-installment")) {
        const base = draft.mode === "xml" ? draft.note.issueDate : draft.header.issueDate;
        draft.installments.push({ number: "", dueDate: addDays(base || todayIso(), 30), amount: draft.installments.length ? "" : noteTotal().toFixed(2) });
        renderInstallments();
      }
    });
    loadNotes();
  }

  window.addEventListener("DOMContentLoaded", initialize);
})();
