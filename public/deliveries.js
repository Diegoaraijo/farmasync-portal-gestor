/* Baixa de entregas pelo portal: lista as entregas pendentes publicadas pelo balcão, deixa o gestor escolher quais baixar
   (com o código de segurança do cliente nos pedidos do aplicativo) e acompanha o balcão executando a baixa. */
(() => {
  "use strict";
  if (document.body.dataset.page !== "dashboard") return;

  const STATE_LABEL = {
    PENDENTE: "Aguardando o balcão",
    PROCESSANDO: "Baixando no balcão",
    APLICADO: "Baixada",
    FALHOU: "Não foi baixada",
    EXPIRADO: "Pedido expirado",
  };
  const ERROR_TEXT = {
    invalid_request: "Escolha ao menos uma entrega.",
    too_many_deliveries: "Escolha no máximo 20 entregas por vez.",
    invalid_sale_id: "Entrega inválida.",
    invalid_code: "O código de segurança tem 4 números.",
    license_not_found: "Não foi possível identificar a licença desta farmácia.",
    reauth_required: "Confirme sua senha para continuar.",
    request_not_cancellable: "O balcão já começou a baixar esta entrega.",
  };
  const RESULT_TEXT = {
    not_pending: "não está mais na lista de pendentes",
    code_required: "precisa do código de segurança do cliente",
    too_many_attempts: "teve muitas tentativas recentes; aguarde 30 minutos ou baixe pelo balcão",
    already_requested: "já tem um pedido de baixa em andamento",
  };
  const ACTIVE = new Set(["PENDENTE", "PROCESSANDO"]);

  let deliveries = [];
  let sync = { stale: true, ageSeconds: null };
  let limits = { maxPerRequest: 20, expiresMinutes: 30 };
  const selected = new Set();
  const watching = new Set();
  let pollTimer = null;
  let loaded = false;
  let submitting = false;

  const $ = (id) => document.getElementById(id);
  const money = (value) => currency.format(Number(value) || 0);
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

  function waitLabel(minutes) {
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
  }

  const requestOf = (delivery) => delivery.request;
  const isActive = (delivery) => ACTIVE.has(delivery.request?.status);
  const isDone = (delivery) => delivery.request?.status === "APLICADO";
  const canSelect = (delivery) => !isActive(delivery) && !isDone(delivery);

  function flash(message, tone = "ok") {
    const holder = $("delivery-flash-holder");
    let banner = $("delivery-flash");
    if (!banner) {
      banner = el("div", { id: "delivery-flash", class: "notes-flash", role: "status" });
      holder.append(banner);
    }
    banner.className = `notes-flash ${tone}`;
    banner.textContent = message;
    banner.hidden = false;
    window.clearTimeout(flash.timer);
    flash.timer = window.setTimeout(() => { banner.hidden = true; }, 12000);
  }

  /* ---------- Lista ---------- */

  function statusBadge(delivery) {
    const status = delivery.request?.status;
    if (!status) return null;
    return el("span", { class: `product-sync-badge ${status.toLowerCase()}` }, STATE_LABEL[status] || status);
  }

  function deliveryCard(delivery) {
    const request = requestOf(delivery);
    const meta = [
      delivery.time ? `Saiu às ${delivery.time}` : null,
      `espera ${waitLabel(delivery.waitMinutes)}`,
      delivery.deliveryPerson ? `entregador ${delivery.deliveryPerson}` : null,
      delivery.payment || null,
    ].filter(Boolean).join(" · ");
    const origin = delivery.origin === "APP"
      ? el("span", { class: "delivery-origin app" }, delivery.orderNumber ? `App ${delivery.orderNumber}` : "App")
      : el("span", { class: "delivery-origin" }, "Balcão");
    const selectable = canSelect(delivery);
    const detail = isDone(delivery)
      ? request.resultText
      : request?.error;
    const actions = [];
    if (selectable) actions.push(button(request?.status === "FALHOU" || request?.status === "EXPIRADO" ? "Tentar de novo" : "Baixar", "package-check", { class: "primary-button compact", "data-delivery-settle": delivery.saleId }));
    if (request?.cancellable) actions.push(button("Cancelar pedido", "ban", { class: "secondary-button compact", "data-delivery-cancel": request.id }));
    return el(
      "article",
      { class: `note-card delivery-card${delivery.urgent && !isDone(delivery) ? " urgent" : ""}${isDone(delivery) ? " done" : ""}`, "data-sale": delivery.saleId },
      el("label", { class: "delivery-check", title: selectable ? "Selecionar entrega" : "Entrega em andamento" },
        el("input", { type: "checkbox", "data-delivery-select": delivery.saleId, checked: selectable && selected.has(delivery.saleId), disabled: !selectable, "aria-label": `Selecionar a venda ${delivery.saleId}` })),
      el("div", { class: "note-card-main" },
        el("strong", {}, `Venda #${delivery.saleId}${delivery.customer ? ` · ${delivery.customer}` : ""}`),
        el("span", {}, meta),
        el("div", { class: "delivery-tags" }, origin, delivery.urgent && !isDone(delivery) ? el("span", { class: "product-tag danger" }, "Urgente") : null)),
      el("div", { class: "note-card-value" }, el("span", {}, "Valor"), el("strong", {}, money(delivery.amount))),
      el("div", { class: "note-card-status" }, statusBadge(delivery), detail ? el("small", { class: request?.status === "FALHOU" || request?.status === "EXPIRADO" ? "note-error-text" : "" }, detail) : null),
      el("div", { class: "note-card-actions" }, ...actions),
    );
  }

  function updateSelectionUi() {
    const selectable = deliveries.filter(canSelect);
    const count = [...selected].filter((id) => selectable.some((delivery) => delivery.saleId === id)).length;
    const total = selectable.filter((delivery) => selected.has(delivery.saleId)).reduce((sum, delivery) => sum + delivery.amount, 0);
    const trigger = $("delivery-settle-selected");
    trigger.disabled = count === 0;
    trigger.querySelector("span").textContent = count ? `Baixar selecionadas (${count})` : "Baixar selecionadas";
    $("delivery-settle-count").textContent = deliveries.length
      ? `${deliveries.length} ${deliveries.length === 1 ? "entrega pendente" : "entregas pendentes"}${count ? ` · ${count} selecionada(s) · ${money(total)}` : ""}`
      : "";
    const all = $("delivery-select-all");
    all.disabled = selectable.length === 0;
    all.checked = selectable.length > 0 && count === selectable.length;
    all.indeterminate = count > 0 && count < selectable.length;
  }

  function syncNote() {
    const note = $("delivery-sync-note");
    if (!loaded) { note.hidden = true; return; }
    const minutes = sync.ageSeconds === null ? null : Math.floor(sync.ageSeconds / 60);
    if (sync.stale) {
      note.className = "delivery-sync-note warn";
      note.textContent = minutes === null
        ? "O balcão ainda não enviou a lista de entregas. Abra o FarmaSync atualizado no balcão para sincronizar."
        : `O balcão não atualiza a lista há ${minutes} min. Se ele estiver desligado ou sem internet, os pedidos de baixa aguardam até ${limits.expiresMinutes} min.`;
    } else {
      note.className = "delivery-sync-note";
      note.textContent = minutes < 1 ? "Lista sincronizada com o balcão agora há pouco." : `Lista sincronizada com o balcão há ${minutes} min.`;
    }
    note.hidden = false;
  }

  function render() {
    const list = $("delivery-settle-list");
    list.replaceChildren(...deliveries.map(deliveryCard));
    list.hidden = deliveries.length === 0;
    $("delivery-settle-toolbar").hidden = deliveries.length === 0;
    $("delivery-settle-empty").hidden = deliveries.length > 0 || sync.syncedAt === null;
    syncNote();
    updateSelectionUi();
    icons();
  }

  function reportWatched(previous) {
    if (!watching.size) return;
    const done = [];
    const failed = [];
    for (const saleId of [...watching]) {
      const current = deliveries.find((delivery) => delivery.saleId === saleId);
      const request = current?.request;
      if (!current || request?.status === "APLICADO") {
        done.push(saleId);
        watching.delete(saleId);
      } else if (request?.status === "FALHOU" || request?.status === "EXPIRADO") {
        failed.push({ saleId, error: request.error });
        watching.delete(saleId);
      } else if (!request && previous.some((delivery) => delivery.saleId === saleId && isActive(delivery))) {
        watching.delete(saleId);
      }
    }
    if (failed.length) flash(`Venda #${failed[0].saleId}: ${failed[0].error || "não foi possível baixar."}${failed.length > 1 ? ` (+${failed.length - 1} com problema)` : ""}`, "error");
    else if (done.length) flash(done.length === 1 ? `Entrega #${done[0]} baixada no balcão e nos demais painéis.` : `${done.length} entregas baixadas no balcão e nos demais painéis.`);
    // O balcão republica a lista logo depois de baixar: uma nova consulta tira as baixadas da tela.
    if (done.length) window.setTimeout(() => load({ manual: true }), 3000);
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    const busy = deliveries.some(isActive) || watching.size > 0;
    pollTimer = window.setTimeout(load, busy ? 3000 : 20000);
  }

  async function load({ manual = false } = {}) {
    try {
      if (!document.hidden || manual) {
        const data = await api("/api/deliveries/pending");
        const previous = deliveries;
        deliveries = data.deliveries;
        sync = data.sync;
        limits = data.limits || limits;
        loaded = true;
        for (const id of [...selected]) if (!deliveries.some((delivery) => delivery.saleId === id && canSelect(delivery))) selected.delete(id);
        $("delivery-settle-error").hidden = true;
        render();
        reportWatched(previous);
      }
    } catch (error) {
      if (error.message !== "unauthorized") $("delivery-settle-error").hidden = false;
    }
    $("delivery-settle-loading").hidden = true;
    schedulePoll();
  }

  /* ---------- Diálogo de confirmação ---------- */

  function closeDialog() {
    submitting = false;
    const dialog = $("delivery-dialog");
    if (dialog.open) dialog.close();
  }

  function codeValid(input) {
    return /^\d{4}$/.test(input.value.trim());
  }

  function confirmDialog(items) {
    const total = items.reduce((sum, delivery) => sum + delivery.amount, 0);
    const rows = items.map((delivery) => el(
      "div",
      { class: "delivery-confirm-row" },
      el("div", {},
        el("strong", {}, `Venda #${delivery.saleId}${delivery.customer ? ` · ${delivery.customer}` : ""}`),
        el("span", {}, [delivery.deliveryPerson ? `entregador ${delivery.deliveryPerson}` : null, delivery.payment].filter(Boolean).join(" · ") || "Entrega"),
        delivery.codeRequired ? el("span", { class: "delivery-origin app" }, delivery.orderNumber ? `Pedido do app ${delivery.orderNumber}` : "Pedido do app") : null),
      el("strong", { class: "delivery-confirm-amount" }, money(delivery.amount)),
      delivery.codeRequired ? el("label", { class: "note-field delivery-code-field" },
        el("span", { class: "note-field-label" }, "Código de segurança do cliente"),
        el("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "4", autocomplete: "off", placeholder: "4 números", "data-code-for": delivery.saleId, "aria-label": `Código de segurança da venda ${delivery.saleId}` }),
        el("small", {}, "O cliente mostra este código no aplicativo.")) : null,
    ));
    const hasApp = items.some((delivery) => delivery.codeRequired);
    const confirm = el("input", { type: "checkbox", id: "delivery-confirm-check" });
    const submit = button("Confirmar baixa", "package-check", { class: "primary-button", id: "delivery-confirm-submit", disabled: true });
    const body = [
      el("div", { id: "delivery-banner", class: "note-banner error", role: "alert", hidden: true }),
      el("section", { class: "note-summary" },
        el("div", {}, el("span", {}, "Entregas"), el("strong", {}, String(items.length))),
        el("div", {}, el("span", {}, "Valor total"), el("strong", {}, money(total)))),
      el("div", { class: "delivery-confirm-list" }, ...rows),
      hasApp ? el("p", { class: "note-help" }, "Pedidos do aplicativo só são concluídos com o código de 4 dígitos do cliente. A baixa vale para o balcão, o aplicativo e o painel da farmácia.") : null,
      el("label", { class: "note-check delivery-confirm-check" }, confirm,
        el("span", {}, items.length === 1 ? "Confirmo que o entregador retornou e a prestação de contas (dinheiro/comprovante) foi conferida." : "Confirmo que os entregadores retornaram e a prestação de contas (dinheiro/comprovantes) foi conferida.")),
    ];
    const footer = [button("Cancelar", null, { class: "secondary-button", onclick: closeDialog }), submit];
    $("delivery-dialog-title").textContent = items.length === 1 ? "Baixar entrega" : `Baixar ${items.length} entregas`;
    $("delivery-dialog-body").replaceChildren(...body);
    $("delivery-dialog-footer").replaceChildren(...footer);
    const refresh = () => {
      const codes = [...$("delivery-dialog-body").querySelectorAll("[data-code-for]")];
      submit.disabled = submitting || !confirm.checked || !codes.every(codeValid);
    };
    $("delivery-dialog-body").oninput = (event) => {
      if (event.target.matches("[data-code-for]")) event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
      refresh();
    };
    confirm.addEventListener("change", refresh);
    submit.addEventListener("click", () => submitSettlement(items, submit));
    const dialog = $("delivery-dialog");
    if (!dialog.open) dialog.showModal();
    icons();
    $("delivery-dialog-body").querySelector("[data-code-for]")?.focus();
  }

  async function submitSettlement(items, submit) {
    if (submitting) return;
    const banner = $("delivery-banner");
    const payload = items.map((delivery) => {
      const input = $("delivery-dialog-body").querySelector(`[data-code-for="${delivery.saleId}"]`);
      return { saleId: delivery.saleId, ...(input ? { code: input.value.trim() } : {}) };
    });
    submitting = true;
    submit.disabled = true;
    submit.querySelector("span").textContent = "Enviando...";
    try {
      const data = await api("/api/deliveries/settle", { method: "POST", body: JSON.stringify({ deliveries: payload }) });
      const queued = data.results.filter((result) => result.status === "queued");
      const rejected = data.results.filter((result) => result.status !== "queued");
      queued.forEach((result) => { watching.add(result.saleId); selected.delete(result.saleId); });
      if (rejected.length && !queued.length) {
        banner.textContent = rejected.map((result) => `Venda #${result.saleId} ${RESULT_TEXT[result.status] || "não pôde ser enviada"}.`).join(" ");
        banner.hidden = false;
        submitting = false;
        submit.querySelector("span").textContent = "Confirmar baixa";
        submit.disabled = false;
        return;
      }
      closeDialog();
      if (rejected.length) flash(`${queued.length} enviada(s) ao balcão. ${rejected.map((result) => `Venda #${result.saleId} ${RESULT_TEXT[result.status] || "não pôde ser enviada"}.`).join(" ")}`, "error");
      else flash(queued.length === 1 ? "Pedido enviado ao balcão. A baixa acontece em segundos." : `${queued.length} pedidos enviados ao balcão. As baixas acontecem em segundos.`);
    } catch (error) {
      submitting = false;
      banner.textContent = friendly(error);
      banner.hidden = false;
      submit.querySelector("span").textContent = "Confirmar baixa";
      submit.disabled = false;
      return;
    }
    load({ manual: true });
  }

  async function cancelRequest(id) {
    if (!window.confirm("Cancelar este pedido de baixa? A entrega continua pendente.")) return;
    try {
      await api(`/api/deliveries/requests/${id}/cancel`, { method: "POST", body: "{}" });
      flash("Pedido de baixa cancelado.");
    } catch (error) {
      flash(friendly(error), "error");
    }
    load({ manual: true });
  }

  /* ---------- Inicialização ---------- */

  function openFor(ids) {
    const items = ids.map((id) => deliveries.find((delivery) => delivery.saleId === id)).filter((delivery) => delivery && canSelect(delivery));
    if (!items.length) return;
    if (items.length > limits.maxPerRequest) {
      flash(`Escolha no máximo ${limits.maxPerRequest} entregas por vez.`, "error");
      return;
    }
    confirmDialog(items);
  }

  function initialize() {
    if (!$("baixa-entregas")) return;
    $("delivery-refresh").addEventListener("click", () => load({ manual: true }));
    $("delivery-settle-selected").addEventListener("click", () => openFor([...selected]));
    $("delivery-dialog-close").addEventListener("click", closeDialog);
    $("delivery-dialog").addEventListener("close", () => { submitting = false; });
    $("delivery-select-all").addEventListener("change", (event) => {
      deliveries.filter(canSelect).forEach((delivery) => {
        if (event.target.checked) selected.add(delivery.saleId);
        else selected.delete(delivery.saleId);
      });
      render();
    });
    $("delivery-settle-list").addEventListener("change", (event) => {
      const box = event.target.closest("[data-delivery-select]");
      if (!box) return;
      const id = Number(box.dataset.deliverySelect);
      if (box.checked) selected.add(id);
      else selected.delete(id);
      updateSelectionUi();
    });
    $("delivery-settle-list").addEventListener("click", (event) => {
      const settle = event.target.closest("[data-delivery-settle]");
      const cancel = event.target.closest("[data-delivery-cancel]");
      if (settle) openFor([Number(settle.dataset.deliverySettle)]);
      if (cancel) cancelRequest(cancel.dataset.deliveryCancel);
    });
    load();
  }

  window.addEventListener("DOMContentLoaded", initialize);
})();
