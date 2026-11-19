const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const calendarDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const quantityNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
let inventoryAlerts = [];
let inventoryFilter = "expiry";
let managedProducts = [];
let productSearchTimer = null;
let clubCoupons = [];
let clubMembers = [];
let clubCashbacks = [];
let clubRiskAlerts = [];
let selectedClubRiskAlert = null;
let clubShare = { url: "", invitation: "" };

function formatDate(value) {
  return value ? calendarDate.format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : "";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOGIN_EMAIL_KEY = "farmasync_portal_email";
const LOGIN_REMEMBER_KEY = "farmasync_portal_remember";

function setFieldError(input, message) {
  const holder = document.getElementById(`${input.id}-error`);
  input.setAttribute("aria-invalid", message ? "true" : "false");
  input.closest(".input-wrap")?.classList.toggle("invalid", Boolean(message));
  if (holder) {
    holder.textContent = message || "";
    holder.hidden = !message;
  }
}

function emailProblem(input) {
  const value = input.value.trim();
  if (!value) return "Informe o e-mail cadastrado.";
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return "Este campo aceita somente e-mail, por exemplo nome@farmacia.com.br.";
  }
  return "";
}

function passwordProblem(input) {
  if (!input.value) return "Informe a senha.";
  if (input.value.length > 128) return "A senha pode ter no máximo 128 caracteres.";
  return "";
}

function waitText(seconds) {
  const minutes = Math.max(1, Math.ceil(Number(seconds || 0) / 60));
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 401) {
    if (document.body.dataset.page !== "login") window.location.replace("/");
    throw new Error("unauthorized");
  }
  if (response.status === 429) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(new Error("too_many_attempts"), { retryAfterSeconds: payload.retryAfterSeconds });
  }
  if (response.status === 403) {
    const payload = await response.json().catch(() => ({}));
    if (payload.error === "reauth_required") {
      try { await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch (_error) { /* o login abaixo cria nova sessão */ }
      window.location.replace("/?confirmar=1");
      throw new Error("reauth_required");
    }
    if (payload.error === "password_change_required") {
      if (document.body.dataset.page !== "first-access") {
        window.location.replace("/primeiro-acesso");
      }
      throw new Error("password_change_required");
    }
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(new Error(payload.error || "request_failed"), {
      field: payload.field,
      item: payload.item,
      row: payload.row,
      detail: payload.message,
      existingId: payload.existingId,
    });
  }
  return response.json();
}

function initializeLogin() {
  const form = document.getElementById("login-form");
  if (!form) return;
  const passwordInput = document.getElementById("login-password");
  const rememberInput = document.getElementById("login-remember");
  const emailField = document.getElementById("login-email");
  try {
    const savedEmail = localStorage.getItem(LOGIN_EMAIL_KEY);
    if (savedEmail && emailField && !emailField.value) emailField.value = savedEmail;
    if (rememberInput) rememberInput.checked = localStorage.getItem(LOGIN_REMEMBER_KEY) === "1";
  } catch (_error) { /* armazenamento indisponível */ }
  if (new URLSearchParams(window.location.search).get("confirmar") === "1") {
    const notice = document.getElementById("login-reauth-notice");
    if (notice) notice.hidden = false;
  }
  (emailField && emailField.value ? passwordInput : emailField)?.focus();
  const passwordToggle = document.getElementById("toggle-password");
  passwordToggle?.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    passwordToggle.title = showing ? "Mostrar senha" : "Ocultar senha";
    passwordToggle.setAttribute("aria-label", passwordToggle.title);
    passwordToggle.innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}"></i>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    passwordInput.focus();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const error = document.getElementById("login-error");
    const emailInput = document.getElementById("login-email");
    error.hidden = true;
    const emailMessage = emailProblem(emailInput);
    const passwordMessage = passwordProblem(passwordInput);
    setFieldError(emailInput, emailMessage);
    setFieldError(passwordInput, passwordMessage);
    if (emailMessage || passwordMessage) {
      (emailMessage ? emailInput : passwordInput).focus();
      return;
    }
    button.disabled = true;
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
          remember: rememberInput?.checked === true,
        }),
      });
      try {
        localStorage.setItem(LOGIN_EMAIL_KEY, emailInput.value.trim().toLowerCase());
        localStorage.setItem(LOGIN_REMEMBER_KEY, rememberInput?.checked ? "1" : "0");
      } catch (_error) { /* armazenamento indisponível: segue sem lembrar */ }
      window.location.replace(result.passwordChangeRequired ? "/primeiro-acesso" : "/painel");
    } catch (requestError) {
      if (requestError.message === "invalid_email") {
        setFieldError(emailInput, "Este campo aceita somente e-mail, por exemplo nome@farmacia.com.br.");
        emailInput.focus();
      } else if (requestError.message === "invalid_password") {
        setFieldError(passwordInput, "A senha pode ter no máximo 128 caracteres.");
      } else if (requestError.message === "too_many_attempts") {
        error.textContent = `Muitas tentativas incorretas. Por segurança, aguarde ${waitText(requestError.retryAfterSeconds)} e tente novamente.`;
        error.hidden = false;
      } else if (requestError.message === "unauthorized") {
        error.textContent = "E-mail ou senha inválidos.";
        error.hidden = false;
        passwordInput.select();
      } else {
        error.textContent = "Não foi possível acessar agora. Tente novamente.";
        error.hidden = false;
      }
      button.disabled = false;
    }
  });
  const loginEmail = document.getElementById("login-email");
  loginEmail?.addEventListener("blur", () => {
    if (loginEmail.value.trim()) setFieldError(loginEmail, emailProblem(loginEmail));
  });
  loginEmail?.addEventListener("input", () => setFieldError(loginEmail, ""));
  passwordInput?.addEventListener("input", () => setFieldError(passwordInput, ""));
}

async function initializeFirstAccess() {
  if (document.body.dataset.page !== "first-access") return;
  try {
    const session = await api("/api/auth/session");
    if (!session.passwordChangeRequired) {
      window.location.replace("/painel");
      return;
    }
  } catch (error) {
    if (error.message === "unauthorized") return;
  }
  const form = document.getElementById("first-access-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const error = document.getElementById("first-access-error");
    const values = new FormData(form);
    const password = String(values.get("password") || "");
    const confirmation = String(values.get("confirmation") || "");
    error.hidden = true;
    if (password !== confirmation) {
      error.textContent = "As senhas informadas não são iguais.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ password, confirmation }),
      });
      window.location.replace("/painel");
    } catch (requestError) {
      error.textContent = requestError.message === "weak_password"
        ? "Use uma senha com pelo menos 10 caracteres."
        : "Não foi possível salvar a nova senha. Tente novamente.";
      error.hidden = false;
      button.disabled = false;
    }
  });
}

function initializePasswordRecovery() {
  const forgotForm = document.getElementById("forgot-password-form");
  const forgotEmail = document.getElementById("forgot-email");
  forgotEmail?.addEventListener("input", () => setFieldError(forgotEmail, ""));
  forgotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = forgotForm.querySelector("button[type=submit]");
    const message = document.getElementById("forgot-password-message");
    message.hidden = true;
    const problem = emailProblem(forgotEmail);
    setFieldError(forgotEmail, problem);
    if (problem) {
      forgotEmail.focus();
      return;
    }
    button.disabled = true;
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail.value.trim() }),
      });
      forgotForm.querySelector("label").hidden = true;
      button.hidden = true;
      message.textContent = "Se o e-mail estiver cadastrado, você receberá as instruções em alguns minutos.";
      message.hidden = false;
    } catch (requestError) {
      message.textContent = requestError.message === "too_many_attempts"
        ? `Muitos pedidos seguidos. Aguarde ${waitText(requestError.retryAfterSeconds || 900)} e tente novamente.`
        : "Não foi possível enviar agora. Tente novamente mais tarde.";
      message.hidden = false;
      button.disabled = false;
    }
  });

  const resetForm = document.getElementById("reset-password-form");
  if (!resetForm) return;
  const token = new URLSearchParams(window.location.search).get("token") || "";
  // O token só serve para esta tela: sai da barra de endereço e do histórico.
  if (token) window.history.replaceState(null, "", window.location.pathname);
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = resetForm.querySelector("button[type=submit]");
    const error = document.getElementById("reset-password-error");
    const values = new FormData(resetForm);
    const password = String(values.get("password") || "");
    const confirmation = String(values.get("confirmation") || "");
    error.hidden = true;
    if (password !== confirmation) {
      error.textContent = "As senhas informadas não são iguais.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password, confirmation }),
      });
      window.location.replace("/?senha-redefinida=1");
    } catch (requestError) {
      error.textContent = requestError.message === "weak_password"
        ? "Use uma senha com pelo menos 10 caracteres."
        : "Este link é inválido ou expirou. Solicite um novo link.";
      error.hidden = false;
      button.disabled = false;
    }
  });
}

function metric(id, amount, count, countLabel) {
  setText(`${id}-value`, currency.format(amount));
  setText(`${id}-detail`, `${count} ${count === 1 ? countLabel : `${countLabel}s`}`);
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarPeriod(period) {
  const today = new Date();
  if (period === "previous-month") {
    return {
      start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      end: new Date(today.getFullYear(), today.getMonth(), 0),
    };
  }
  if (period === "current-month") {
    return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
  }
  return { start: today, end: today };
}

function setHistoryPeriod(period) {
  const { start, end } = calendarPeriod(period);
  document.getElementById("history-start").value = localIsoDate(start);
  document.getElementById("history-end").value = localIsoDate(end);
}

function historyRow(day, maximumAmount) {
  const row = document.createElement("div");
  row.className = "history-row";
  row.setAttribute("role", "row");

  const date = document.createElement("time");
  date.dateTime = day.date;
  date.textContent = shortDate.format(new Date(`${day.date}T12:00:00`)).replace(".", "");
  const progress = document.createElement("progress");
  progress.max = maximumAmount || 1;
  progress.value = day.salesAmount;
  progress.setAttribute("aria-label", `${currency.format(day.salesAmount)} em ${day.salesCount} vendas`);
  const amount = document.createElement("strong");
  amount.textContent = currency.format(day.salesAmount);
  const count = document.createElement("span");
  count.textContent = `${day.salesCount} venda${day.salesCount === 1 ? "" : "s"}`;
  row.append(date, progress, amount, count);
  return row;
}

async function loadSalesHistory() {
  const start = document.getElementById("history-start").value;
  const end = document.getElementById("history-end").value;
  const error = document.getElementById("history-error");
  const loading = document.getElementById("history-loading");
  const content = document.getElementById("history-content");
  error.hidden = true;
  loading.hidden = false;
  content.hidden = true;
  try {
    const data = await api(`/api/sales-history?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    setText("period-sales-value", currency.format(data.totals.salesAmount));
    setText("period-sales-detail", `${data.totals.salesCount} vendas concluídas`);
    setText("period-ticket-value", currency.format(data.totals.averageTicket));
    const movements = data.totals.exchangesCount + data.totals.returnsCount + data.totals.cancellationsCount;
    setText("period-movements-value", String(movements));
    setText("period-movements-detail", `${data.totals.exchangesCount} trocas · ${data.totals.returnsCount} devoluções · ${data.totals.cancellationsCount} cancelamentos`);
    const list = document.getElementById("history-list");
    const maximumAmount = Math.max(0, ...data.daily.map((day) => day.salesAmount));
    list.replaceChildren(...data.daily.slice().reverse().map((day) => historyRow(day, maximumAmount)));
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

function campaignRow(campaign) {
  const row = document.createElement("article");
  row.className = "campaign-row";
  const heading = document.createElement("div");
  heading.className = "campaign-row-heading";
  const title = document.createElement("strong");
  title.textContent = campaign.name;
  const badges = document.createElement("span");
  badges.className = "campaign-badges";
  const status = document.createElement("small");
  status.className = campaign.active ? "status-active" : "status-closed";
  status.textContent = campaign.active ? "Ativa" : "Encerrada";
  const mode = document.createElement("small");
  mode.textContent = campaign.mode === "ONLINE" ? "Online" : "Local";
  badges.append(status, mode);
  heading.append(title, badges);

  const period = document.createElement("span");
  period.className = "campaign-period";
  period.textContent = `${calendarDate.format(new Date(`${campaign.startDate}T12:00:00`))} a ${calendarDate.format(new Date(`${campaign.endDate}T12:00:00`))}`;
  const metrics = document.createElement("div");
  metrics.className = "campaign-metrics";
  for (const [value, label] of [
    [campaign.metrics.participations, "participações"],
    [campaign.metrics.winners, "ganhadores"],
    [campaign.metrics.pendingPrizes, "pendentes"],
  ]) {
    const item = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(strong, ` ${label}`);
    metrics.append(item);
  }
  const prizes = document.createElement("p");
  prizes.textContent = campaign.prizes.length
    ? campaign.prizes.map((prize) => `${prize.name} (${prize.monthlyQuantity}/mês)`).join(" · ")
    : "Nenhum prêmio configurado";
  row.append(heading, period, metrics, prizes);
  return row;
}

function winnerRow(winner) {
  const row = document.createElement("article");
  row.className = "winner-row";
  const icon = document.createElement("span");
  icon.className = "winner-icon";
  icon.innerHTML = '<i data-lucide="gift"></i>';
  const info = document.createElement("div");
  const prize = document.createElement("strong");
  prize.textContent = winner.prizeName;
  const campaign = document.createElement("span");
  campaign.textContent = winner.campaignName;
  const date = document.createElement("time");
  date.dateTime = winner.awardedAt;
  date.textContent = dateTime.format(new Date(winner.awardedAt.replace(" ", "T")));
  info.append(prize, campaign, date);
  const state = document.createElement("div");
  state.className = "winner-state";
  const code = document.createElement("span");
  code.textContent = `Final ${winner.codeSuffix || "---"}`;
  const badge = document.createElement("small");
  badge.className = winner.withdrawn ? "status-withdrawn" : "status-pending";
  badge.textContent = winner.withdrawn ? "Retirado" : "Pendente";
  state.append(code, badge);
  row.append(icon, info, state);
  return row;
}

async function loadCampaigns() {
  const error = document.getElementById("campaigns-error");
  const loading = document.getElementById("campaigns-loading");
  const content = document.getElementById("campaigns-content");
  error.hidden = true;
  loading.hidden = false;
  content.hidden = true;
  try {
    const data = await api("/api/campaigns");
    setText("campaign-active-value", data.totals.activeCampaigns);
    setText("campaign-participations-value", data.totals.participations);
    setText("campaign-winners-value", data.totals.winners);
    setText("campaign-pending-value", data.totals.pendingPrizes);
    const campaignList = document.getElementById("campaign-list");
    const winnerList = document.getElementById("winner-list");
    campaignList.replaceChildren(...data.campaigns.map(campaignRow));
    winnerList.replaceChildren(...data.recentWinners.map(winnerRow));
    if (!data.campaigns.length) campaignList.textContent = "Nenhuma campanha sincronizada.";
    if (!data.recentWinners.length) winnerList.textContent = "Nenhum ganhador registrado.";
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

function clubMemberRow(member) {
  const row = document.createElement("article");
  row.className = "club-member-row";
  const identity = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = member.name;
  const phone = document.createElement("span");
  phone.textContent = `Telefone final ${member.phoneSuffix} · ${member.active ? "Ativo" : "Bloqueado"}`;
  identity.append(name, phone);
  if (member.tier) {
    const tier = document.createElement("small");
    tier.className = `club-tier-tag club-tier-tag-${member.tier.toLowerCase()}`;
    tier.textContent = { BRONZE: "Bronze", PRATA: "Prata", OURO: "Ouro" }[member.tier] || member.tier;
    identity.append(tier);
  }
  const points = document.createElement("div");
  const balance = document.createElement("strong");
  balance.textContent = quantityNumber.format(member.balance);
  const label = document.createElement("span");
  label.textContent = "pontos";
  const action = document.createElement("button");
  action.className = "icon-button";
  action.type = "button";
  action.dataset.clubMemberAction = member.id;
  action.title = "Administrar membro";
  action.setAttribute("aria-label", `Administrar ${member.name}`);
  action.innerHTML = '<i data-lucide="settings-2"></i>';
  points.append(balance, label, action);
  row.classList.toggle("inactive", !member.active);
  row.append(identity, points);
  return row;
}

function searchableClubMemberText(member) {
  return `${member.name || ""} ${member.phoneSuffix || ""}`
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function renderClubMembers() {
  const query = String(document.getElementById("club-member-search")?.value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const members = query
    ? clubMembers.filter((member) => searchableClubMemberText(member).includes(query))
    : clubMembers;
  document.getElementById("club-member-list").replaceChildren(...members.map(clubMemberRow));
  setText("club-member-count", query
    ? `${members.length} de ${clubMembers.length} encontrados`
    : `${clubMembers.length} ${clubMembers.length === 1 ? "membro" : "membros"} · maior saldo primeiro`);
  const empty = document.getElementById("club-member-empty");
  empty.textContent = query ? "Nenhum membro encontrado nesta busca." : "Nenhum membro cadastrado.";
  empty.hidden = members.length > 0;
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function setClubMemberActionFields() {
  const action = document.getElementById("club-member-action").value;
  document.getElementById("club-member-phone-field").hidden = action !== "phone";
  document.getElementById("club-member-points-field").hidden = action !== "points";
  document.getElementById("club-member-cashback-field").hidden = action !== "cashback-grant";
  document.getElementById("club-member-birth-date-field").hidden = action !== "birth-date";
  document.getElementById("club-member-merge-field").hidden = true;
  document.getElementById("club-member-merge").checked = false;
  document.getElementById("club-member-form-error").hidden = true;
}

function openClubMemberDialog(member) {
  const dialog = document.getElementById("club-member-dialog");
  document.getElementById("club-member-id").value = member.id;
  setText("club-member-dialog-title", member.name);
  setText("club-member-dialog-detail", `Telefone final ${member.phoneSuffix} · ${quantityNumber.format(member.balance)} pontos`);
  const action = document.getElementById("club-member-action");
  action.replaceChildren(
    new Option("Trocar telefone", "phone"),
    new Option("Ajustar pontos", "points"),
    new Option("Conceder cashback manual", "cashback-grant"),
    new Option(member.birthDate ? "Corrigir data de nascimento" : "Cadastrar data de nascimento", "birth-date"),
    new Option(member.cashbackBlocked ? "Desbloquear cashback" : "Bloquear cashback", member.cashbackBlocked ? "cashback-unblock" : "cashback-block"),
    new Option(member.active ? "Bloquear conta" : "Reativar conta", member.active ? "block" : "reactivate"),
  );
  document.getElementById("club-member-phone").value = "";
  document.getElementById("club-member-points").value = "";
  document.getElementById("club-member-cashback").value = "";
  document.getElementById("club-member-birth-date").value = member.birthDate || "";
  document.getElementById("club-member-reason").value = "";
  setClubMemberActionFields();
  dialog.showModal();
}

function clubMemberErrorMessage(error) {
  return {
    invalid_phone: "Informe um telefone válido com DDD.",
    insufficient_points: "A remoção é maior que o saldo disponível.",
    coupon_conflict: "As duas contas possuem o mesmo cupom ativado. A mesclagem foi interrompida para preservar os benefícios.",
    member_not_found: "Este membro não está mais disponível.",
  }[error.message] || "Não foi possível concluir a alteração agora.";
}

async function saveClubMemberAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const error = document.getElementById("club-member-form-error");
  const memberId = document.getElementById("club-member-id").value;
  const action = document.getElementById("club-member-action").value;
  const reason = document.getElementById("club-member-reason").value.trim();
  button.disabled = true;
  error.hidden = true;
  try {
    if (action === "phone") {
      await api(`/api/club/members/${memberId}/phone`, {
        method: "PUT",
        body: JSON.stringify({
          phone: document.getElementById("club-member-phone").value,
          merge: document.getElementById("club-member-merge").checked,
          reason,
        }),
      });
    } else if (action === "points") {
      await api(`/api/club/members/${memberId}/points`, {
        method: "POST",
        body: JSON.stringify({ points: Number(document.getElementById("club-member-points").value), reason }),
      });
    } else if (action === "birth-date") {
      await api(`/api/club/members/${memberId}/birth-date`, {
        method: "PUT",
        body: JSON.stringify({ birthDate: document.getElementById("club-member-birth-date").value, reason }),
      });
    } else if (action === "cashback-grant") {
      await api(`/api/club/members/${memberId}/cashback`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(document.getElementById("club-member-cashback").value), reason }),
      });
    } else if (action === "cashback-block" || action === "cashback-unblock") {
      await api(`/api/club/members/${memberId}/cashback-block`, {
        method: "PUT", body: JSON.stringify({ blocked: action === "cashback-block", reason }),
      });
    } else {
      await api(`/api/club/members/${memberId}/status`, {
        method: "PUT", body: JSON.stringify({ active: action === "reactivate", reason }),
      });
    }
    document.getElementById("club-member-dialog").close();
    await loadClub();
  } catch (requestError) {
    if (requestError.message === "phone_exists") {
      document.getElementById("club-member-merge-field").hidden = false;
      error.textContent = "Este telefone já pertence a outra conta. Marque a opção de mesclagem para unir pontos e benefícios.";
    } else {
      error.textContent = clubMemberErrorMessage(requestError);
    }
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function cashbackStateLabel(cashback) {
  return { PENDENTE: "Pendente", RESERVADO: "Reservado", USADO: "Usado", CANCELADO: "Cancelado" }[cashback.state] || cashback.state;
}

function clubCashbackRow(cashback) {
  const row = document.createElement("article");
  row.className = `club-cashback-row ${cashback.state.toLowerCase()}`;
  const info = document.createElement("div");
  const heading = document.createElement("div");
  const member = document.createElement("strong");
  member.textContent = cashback.memberName;
  const state = document.createElement("small");
  state.textContent = cashbackStateLabel(cashback);
  heading.append(member, state);
  const detail = document.createElement("span");
  detail.textContent = `${cashback.origin === "MANUAL" ? "Concessão manual" : "Conversão de pontos"} · ${dateTime.format(new Date(cashback.createdAt.replace(" ", "T")))}`;
  info.append(heading, detail);
  const amount = document.createElement("strong");
  amount.textContent = currency.format(cashback.amount);
  row.append(info, amount);
  if (cashback.state === "PENDENTE") {
    const cancel = document.createElement("button");
    cancel.className = "icon-button";
    cancel.type = "button";
    cancel.title = "Cancelar cashback";
    cancel.setAttribute("aria-label", `Cancelar cashback de ${cashback.memberName}`);
    cancel.dataset.clubCashbackCancel = cashback.id;
    cancel.innerHTML = '<i data-lucide="ban"></i>';
    row.append(cancel);
  }
  return row;
}

function clubReferralPerson(name, phoneSuffix, label) {
  const person = document.createElement("div");
  person.className = "club-referral-person";
  const caption = document.createElement("small");
  caption.textContent = label;
  const memberName = document.createElement("strong");
  memberName.textContent = name;
  const phone = document.createElement("span");
  phone.textContent = phoneSuffix ? `Telefone final ${phoneSuffix}` : "Telefone não informado";
  person.append(caption, memberName, phone);
  return person;
}

function clubReferralRow(referral) {
  const row = document.createElement("article");
  row.className = `club-referral-row ${referral.firstPurchaseCompleted ? "completed" : "pending"}`;
  const referrer = clubReferralPerson(referral.referrerName, referral.referrerPhoneSuffix, "Quem indicou");
  const arrow = document.createElement("i");
  arrow.dataset.lucide = "arrow-right";
  arrow.setAttribute("aria-hidden", "true");
  const referred = clubReferralPerson(referral.referredName, referral.referredPhoneSuffix, "Quem foi indicado");
  const result = document.createElement("div");
  result.className = "club-referral-result";
  const state = document.createElement("strong");
  state.textContent = referral.firstPurchaseCompleted ? "Primeira compra concluída" : "Aguardando primeira compra";
  const detail = document.createElement("span");
  detail.textContent = referral.firstPurchaseCompleted
    ? `${quantityNumber.format(referral.bonusPointsEach || 0)} pontos para cada um`
    : `Indicação em ${dateTime.format(new Date(referral.referredAt.replace(" ", "T")))}`;
  result.append(state, detail);
  if (referral.firstPurchaseCompleted && referral.bonusCreditedAt) {
    const creditedAt = document.createElement("small");
    creditedAt.textContent = `Bônus liberado em ${dateTime.format(new Date(referral.bonusCreditedAt.replace(" ", "T")))}`;
    result.append(creditedAt);
  }
  row.append(referrer, arrow, referred, result);
  return row;
}

function openCashbackCancelDialog(cashback) {
  const dialog = document.getElementById("club-cashback-cancel-dialog");
  document.getElementById("club-cashback-cancel-id").value = cashback.id;
  document.getElementById("club-cashback-cancel-member-id").value = cashback.memberId;
  setText("club-cashback-cancel-detail", `${cashback.memberName} · ${currency.format(cashback.amount)}`);
  document.getElementById("club-cashback-cancel-reason").value = "";
  document.getElementById("club-cashback-cancel-error").hidden = true;
  dialog.showModal();
}

async function cancelClubCashback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const error = document.getElementById("club-cashback-cancel-error");
  button.disabled = true;
  error.hidden = true;
  try {
    await api(`/api/club/cashbacks/${document.getElementById("club-cashback-cancel-id").value}/cancel`, {
      method: "POST",
      body: JSON.stringify({ memberId: Number(document.getElementById("club-cashback-cancel-member-id").value), reason: document.getElementById("club-cashback-cancel-reason").value.trim() }),
    });
    document.getElementById("club-cashback-cancel-dialog").close();
    await loadClub();
  } catch (requestError) {
    error.textContent = { already_redeemed: "Este cashback já foi usado e não pode ser cancelado.", reserved: "Este cashback está reservado no caixa e não pode ser cancelado.", already_canceled: "Este cashback já foi cancelado." }[requestError.message] || "Não foi possível cancelar o cashback agora.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function clubCouponRow(coupon) {
  const row = document.createElement("article");
  row.className = `club-coupon-row${coupon.active && !coupon.expired ? "" : " inactive"}`;
  const info = document.createElement("div");
  const heading = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = coupon.title;
  const status = document.createElement("small");
  status.textContent = coupon.expired ? "Vencido" : (coupon.active ? "Ativo" : "Inativo");
  heading.append(title, status);
  const description = document.createElement("span");
  description.textContent = coupon.description;
  const details = document.createElement("small");
  details.textContent = `${coupon.code} · ${quantityNumber.format(coupon.pointsCost)} pontos · ${coupon.activations} ativações · ${coupon.redemptions} resgates`;
  info.append(heading, description, details);
  const actions = document.createElement("div");
  const edit = document.createElement("button");
  edit.className = "icon-button";
  edit.type = "button";
  edit.title = "Editar cupom";
  edit.dataset.clubCouponEdit = coupon.id;
  edit.innerHTML = '<i data-lucide="pencil"></i>';
  const toggle = document.createElement("button");
  toggle.className = "icon-button";
  toggle.type = "button";
  toggle.title = coupon.expired
    ? "Edite a validade para reativar"
    : (coupon.active ? "Desativar cupom" : "Ativar cupom");
  toggle.dataset.clubCouponToggle = coupon.id;
  toggle.innerHTML = `<i data-lucide="${coupon.active ? "pause" : "play"}"></i>`;
  toggle.disabled = coupon.expired;
  actions.append(edit, toggle);
  row.append(info, actions);
  return row;
}

function resetClubCouponForm() {
  const form = document.getElementById("club-coupon-form");
  form.reset();
  document.getElementById("club-coupon-id").value = "";
  document.getElementById("club-coupon-points").value = "0";
  document.getElementById("club-coupon-cancel").hidden = true;
  const submit = form.querySelector("button[type=submit]");
  submit.querySelector("span").textContent = "Adicionar cupom";
  submit.querySelector("i")?.setAttribute("data-lucide", "plus");
  document.getElementById("club-coupon-error").hidden = true;
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function editClubCoupon(coupon) {
  document.getElementById("club-coupon-id").value = coupon.id;
  document.getElementById("club-coupon-title").value = coupon.title;
  document.getElementById("club-coupon-code").value = coupon.code;
  document.getElementById("club-coupon-points").value = coupon.pointsCost;
  document.getElementById("club-coupon-expiry").value = String(coupon.expiresAt).replace(" ", "T").slice(0, 16);
  document.getElementById("club-coupon-description").value = coupon.description;
  document.getElementById("club-coupon-cancel").hidden = false;
  const submit = document.querySelector("#club-coupon-form button[type=submit]");
  submit.querySelector("span").textContent = "Salvar alterações";
  submit.querySelector("i")?.setAttribute("data-lucide", "save");
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  document.getElementById("club-coupon-title").focus();
}

function clubCouponPayload(active = true) {
  return {
    title: document.getElementById("club-coupon-title").value,
    code: document.getElementById("club-coupon-code").value,
    pointsCost: Number(document.getElementById("club-coupon-points").value),
    expiresAt: document.getElementById("club-coupon-expiry").value,
    description: document.getElementById("club-coupon-description").value,
    active,
  };
}

async function saveClubCoupon(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = document.getElementById("club-coupon-id").value;
  const current = clubCoupons.find((coupon) => String(coupon.id) === id);
  const error = document.getElementById("club-coupon-error");
  const button = form.querySelector("button[type=submit]");
  error.hidden = true;
  button.disabled = true;
  try {
    await api(id ? `/api/club/coupons/${id}` : "/api/club/coupons", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(clubCouponPayload(current?.active ?? true)),
    });
    resetClubCouponForm();
    await loadClub();
  } catch (requestError) {
    error.textContent = requestError.message === "coupon_code_exists"
      ? "Já existe um cupom com esse código."
      : "Não foi possível salvar o cupom. Confira os dados.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function saveClubPointsValidity(event) {
  event.preventDefault();
  const select = document.getElementById("club-validity-months");
  const button = event.currentTarget.querySelector("button[type=submit]");
  const status = document.getElementById("club-validity-status");
  button.disabled = true;
  status.textContent = "";
  try {
    const months = select.value === "none" ? null : Number(select.value);
    await api("/api/club/points-validity", {
      method: "PUT",
      body: JSON.stringify({ months }),
    });
    status.textContent = "Regra salva. Créditos anteriores não foram alterados.";
    await loadClub();
  } catch (_error) {
    status.textContent = "Não foi possível salvar a regra.";
  } finally {
    button.disabled = false;
  }
}

async function saveClubTiers(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const status = document.getElementById("club-tiers-status");
  const silverAmount = Number(document.getElementById("club-tier-silver").value);
  const goldAmount = Number(document.getElementById("club-tier-gold").value);
  button.disabled = true;
  status.textContent = "";
  try {
    await api("/api/club/tiers", {
      method: "PUT",
      body: JSON.stringify({ silverAmount, goldAmount }),
    });
    status.textContent = "Níveis salvos. Já valem para o próximo cálculo dos membros.";
    await loadClub();
  } catch (_error) {
    status.textContent = "Não foi possível salvar os níveis. O valor do ouro deve ser maior que o da prata.";
  } finally {
    button.disabled = false;
  }
}

async function saveClubReferralBonus(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const status = document.getElementById("club-referral-status");
  const points = Number(document.getElementById("club-referral-points").value);
  button.disabled = true;
  status.textContent = "";
  try {
    await api("/api/club/referral-bonus", {
      method: "PUT",
      body: JSON.stringify({ points }),
    });
    status.textContent = "Bônus salvo. Vale para indicações a partir de agora.";
    await loadClub();
  } catch (_error) {
    status.textContent = "Não foi possível salvar o bônus.";
  } finally {
    button.disabled = false;
  }
}

async function saveClubCashbackRate(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const status = document.getElementById("club-cashback-status");
  const pointsPerReal = Number(document.getElementById("club-cashback-rate").value);
  button.disabled = true;
  status.textContent = "";
  try {
    await api("/api/club/cashback-rate", {
      method: "PUT",
      body: JSON.stringify({ pointsPerReal }),
    });
    status.textContent = "Taxa salva. Vale para novas conversões a partir de agora.";
    await loadClub();
  } catch (_error) {
    status.textContent = "Não foi possível salvar a taxa.";
  } finally {
    button.disabled = false;
  }
}

async function saveClubBirthdayCampaign(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const status = document.getElementById("club-birthday-status");
  const enabled = document.getElementById("club-birthday-enabled").checked;
  const points = Number(document.getElementById("club-birthday-points").value);
  const leadDays = Number(document.getElementById("club-birthday-lead-days").value);
  button.disabled = true;
  status.textContent = "";
  try {
    await api("/api/club/birthday-campaign", {
      method: "PUT",
      body: JSON.stringify({ enabled, points, leadDays }),
    });
    status.textContent = "Campanha salva. Cada membro elegível recebe uma vez por ano.";
    await loadClub();
  } catch (_error) {
    status.textContent = "Não foi possível salvar a campanha.";
  } finally {
    button.disabled = false;
  }
}

async function toggleClubCoupon(coupon) {
  await api(`/api/club/coupons/${coupon.id}`, {
    method: "PUT",
    body: JSON.stringify({
      title: coupon.title, description: coupon.description, code: coupon.code,
      pointsCost: coupon.pointsCost, expiresAt: coupon.expiresAt, active: !coupon.active,
    }),
  });
  await loadClub();
}

async function copyClubText(value, button, successText) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch (_error) {
    const input = document.getElementById("club-share-url");
    input.value = value;
    input.select();
    document.execCommand("copy");
    input.value = clubShare.url;
  }
  const label = button.querySelector("span");
  const original = label.textContent;
  label.textContent = successText;
  window.setTimeout(() => { label.textContent = original; }, 1800);
}

async function loadClub() {
  const error = document.getElementById("club-error");
  const loading = document.getElementById("club-loading");
  const content = document.getElementById("club-content");
  error.hidden = true;
  loading.hidden = false;
  try {
    const data = await api("/api/club");
    clubCoupons = data.coupons;
    clubCashbacks = Array.isArray(data.cashbacks) ? data.cashbacks : [];
    clubMembers = [...data.recentMembers].sort((left, right) =>
      Number(right.balance || 0) - Number(left.balance || 0)
      || String(left.name || "").localeCompare(String(right.name || ""), "pt-BR"));
    setText("club-members-value", data.metrics.activeMembers);
    setText("club-marketing-value", `${data.metrics.marketingMembers} autorizaram comunicações`);
    setText("club-points-value", quantityNumber.format(data.metrics.pointsBalance));
    setText("club-expiring-value", data.metrics.pointsExpiring30Days > 0
      ? `${quantityNumber.format(data.metrics.pointsExpiring30Days)} vencem até ${formatDate(data.metrics.nextPointsExpiration)}`
      : "nenhum ponto vence nos próximos 30 dias");
    setText("club-coupons-value", data.metrics.activeCoupons);
    setText("club-activations-value", `${data.metrics.activatedCoupons} ativações`);
    setText("club-redemptions-value", data.metrics.redeemedCoupons);
    const tierDistribution = data.metrics.tierDistribution || { BRONZE: 0, PRATA: 0, OURO: 0 };
    setText("club-tier-gold-value", quantityNumber.format(tierDistribution.OURO || 0));
    setText("club-tier-detail-value", `${quantityNumber.format(tierDistribution.PRATA || 0)} prata · ${quantityNumber.format(tierDistribution.BRONZE || 0)} bronze`);
    setText("club-referrals-value", quantityNumber.format(data.metrics.referredMembers || 0));
    const referrals = Array.isArray(data.referrals) ? data.referrals : [];
    setText("club-referrals-count", `${referrals.length} ${referrals.length === 1 ? "indicação recente" : "indicações recentes"}`);
    document.getElementById("club-referrals-list").replaceChildren(...referrals.map(clubReferralRow));
    document.getElementById("club-referrals-empty").hidden = referrals.length > 0;
    const cashback = data.metrics.cashback || { issuedCount: 0, issuedAmount: 0, openCount: 0, openAmount: 0, redeemedCount: 0, redeemedAmount: 0, canceledCount: 0, canceledAmount: 0 };
    setText("club-cashback-value", currency.format(cashback.issuedAmount || 0));
    setText("club-cashback-detail-value", `${currency.format(cashback.redeemedAmount || 0)} já usados no caixa`);
    setText("club-cashback-issued", `${currency.format(cashback.issuedAmount || 0)} · ${cashback.issuedCount || 0}`);
    setText("club-cashback-open", `${currency.format(cashback.openAmount || 0)} · ${cashback.openCount || 0}`);
    setText("club-cashback-redeemed", `${currency.format(cashback.redeemedAmount || 0)} · ${cashback.redeemedCount || 0}`);
    setText("club-cashback-canceled", `${currency.format(cashback.canceledAmount || 0)} · ${cashback.canceledCount || 0}`);
    setText("club-cashback-count", `${clubCashbacks.length} recentes`);
    document.getElementById("club-cashback-list").replaceChildren(...clubCashbacks.map(clubCashbackRow));
    document.getElementById("club-cashback-empty").hidden = clubCashbacks.length > 0;
    renderClubRisk(data.riskMonitoring);
    const publicLink = document.getElementById("club-public-link");
    clubShare.url = `https://clube.farmasync.dev.br/loja/${encodeURIComponent(data.store.slug)}`;
    clubShare.invitation = `Olá! A ${data.store.name} agora tem um Clube Digital. Acesse sua carteirinha, pontos e benefícios: ${clubShare.url}`;
    publicLink.href = clubShare.url;
    document.getElementById("club-validity-months").value = data.store.pointsValidityMonths === null
      ? "none" : String(data.store.pointsValidityMonths);
    document.getElementById("club-tier-silver").value = data.store.tierThresholds?.silver ?? 300;
    document.getElementById("club-tier-gold").value = data.store.tierThresholds?.gold ?? 800;
    document.getElementById("club-referral-points").value = data.store.referralBonusPoints ?? 50;
    document.getElementById("club-cashback-rate").value = data.store.cashbackPointsPerReal ?? 100;
    document.getElementById("club-birthday-enabled").checked = data.store.birthdayEnabled !== false;
    document.getElementById("club-birthday-points").value = data.store.birthdayPoints ?? 150;
    document.getElementById("club-birthday-lead-days").value = data.store.birthdayLeadDays ?? 30;
    document.getElementById("club-share-url").value = clubShare.url;
    document.getElementById("club-whatsapp-share").href = `https://wa.me/?text=${encodeURIComponent(clubShare.invitation)}`;
    document.getElementById("club-coupon-list").replaceChildren(...data.coupons.map(clubCouponRow));
    renderClubMembers();
    setText("club-coupon-count", `${data.coupons.length} ${data.coupons.length === 1 ? "cupom exibido" : "cupons exibidos"}`);
    document.getElementById("club-coupon-empty").hidden = data.coupons.length > 0;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

function renderClubRisk(monitoring = {}) {
  const alerts = Array.isArray(monitoring.alerts) ? monitoring.alerts : [];
  clubRiskAlerts = alerts;
  setText("club-risk-period", `Últimos ${monitoring.periodDays || 30} dias`);
  setText("club-risk-sales", quantityNumber.format(monitoring.monitoredSales || 0));
  setText("club-risk-alerts", quantityNumber.format(monitoring.alertCount || 0));
  setText("club-risk-reversals", quantityNumber.format(monitoring.reversedSales || 0));
  const list = document.getElementById("club-risk-list");
  list.replaceChildren(...alerts.map((alert, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `club-risk-row ${alert.severity || "low"}`;
    row.dataset.clubRiskAlert = index;
    row.setAttribute("aria-label", `Investigar alerta: ${alert.title}`);
    const icon = document.createElement("span");
    icon.className = "club-risk-icon";
    icon.innerHTML = '<i data-lucide="shield-alert"></i>';
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = alert.title;
    const detail = document.createElement("span");
    detail.textContent = alert.detail;
    const context = document.createElement("small");
    context.textContent = [
      alert.memberName,
      alert.operatorId ? `operador ${alert.operatorId}` : null,
      alert.lastEventAt ? dateTime.format(new Date(alert.lastEventAt.replace(" ", "T"))) : null,
    ].filter(Boolean).join(" · ");
    content.append(title, detail, context);
    const severity = document.createElement("b");
    severity.textContent = alert.severity === "high" ? "Alta" : alert.severity === "medium" ? "Média" : "Atenção";
    const open = document.createElement("i");
    open.dataset.lucide = "chevron-right";
    row.append(icon, content, severity, open);
    return row;
  }));
  document.getElementById("club-risk-empty").hidden = alerts.length > 0;
}

function clubRiskSaleRow(sale) {
  const row = document.createElement("article");
  row.className = "club-risk-sale-row";
  const heading = document.createElement("div");
  const saleNumber = document.createElement("strong");
  saleNumber.textContent = sale.saleId ? `Venda #${sale.saleId}` : (sale.reference || "Venda sem número");
  const soldAt = document.createElement("time");
  soldAt.textContent = sale.soldAt ? dateTime.format(new Date(sale.soldAt.replace(" ", "T"))) : "Horário não informado";
  heading.append(saleNumber, soldAt);
  const metrics = document.createElement("div");
  const values = [
    ["Valor", sale.amount === null ? "Não informado" : currency.format(sale.amount)],
    ["Pontos", quantityNumber.format(sale.points || 0)],
    ["Pagamento", sale.paymentMethod || "Não informado"],
    ["Canal", sale.saleChannel === "BALCAO" ? "Balcão" : sale.saleChannel === "ENTREGA" ? "Entrega" : (sale.saleChannel || "Não informado")],
  ];
  for (const [label, value] of values) {
    const metric = document.createElement("div");
    const caption = document.createElement("span");
    const content = document.createElement("strong");
    caption.textContent = label;
    content.textContent = value;
    metric.append(caption, content);
    metrics.append(metric);
  }
  const context = document.createElement("small");
  context.textContent = [
    sale.operatorId ? `Operador ${sale.operatorId}` : null,
    sale.linkedAt ? `Carteirinha vinculada às ${new Date(sale.linkedAt.replace(" ", "T")).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : null,
    sale.reversedAt ? "Pontos estornados" : null,
  ].filter(Boolean).join(" · ");
  row.append(heading, metrics, context);
  return row;
}

function openClubRiskDialog(alert) {
  selectedClubRiskAlert = alert;
  setText("club-risk-dialog-title", alert.title);
  setText("club-risk-dialog-detail", alert.detail);
  setText("club-risk-dialog-member", alert.memberName || "Não identificado");
  setText("club-risk-dialog-operator", alert.operatorId ? `#${alert.operatorId}` : "Não informado");
  setText("club-risk-dialog-date", alert.lastEventAt
    ? dateTime.format(new Date(alert.lastEventAt.replace(" ", "T"))) : "Não informada");
  const sales = Array.isArray(alert.relatedSales) ? alert.relatedSales : [];
  setText("club-risk-dialog-count", `${sales.length} ${sales.length === 1 ? "venda" : "vendas"}`);
  document.getElementById("club-risk-dialog-sales").replaceChildren(...sales.map(clubRiskSaleRow));
  const memberAction = document.getElementById("club-risk-dialog-member-action");
  memberAction.hidden = !clubMembers.some((member) => Number(member.id) === Number(alert.memberId));
  document.getElementById("club-risk-dialog").showModal();
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function closeClubRiskDialog() {
  document.getElementById("club-risk-dialog")?.close();
  selectedClubRiskAlert = null;
}

function inventoryBadge(text, tone) {
  const badge = document.createElement("small");
  badge.className = `inventory-badge ${tone}`;
  badge.textContent = text;
  return badge;
}

function inventoryRow(product) {
  const row = document.createElement("article");
  row.className = "inventory-row";
  const identity = document.createElement("div");
  identity.className = "inventory-identity";
  const name = document.createElement("strong");
  name.textContent = product.name;
  const detail = document.createElement("span");
  detail.textContent = [product.code, product.category].filter(Boolean).join(" · ");
  identity.append(name, detail);

  const stock = document.createElement("div");
  stock.className = "inventory-stock";
  const stockValue = document.createElement("strong");
  stockValue.textContent = quantityNumber.format(product.currentStock);
  const stockLabel = document.createElement("span");
  stockLabel.textContent = product.minimumStock > 0
    ? `em estoque · mínimo ${quantityNumber.format(product.minimumStock)}`
    : "em estoque";
  stock.append(stockValue, stockLabel);

  const badges = document.createElement("div");
  badges.className = "inventory-badges";
  if (product.expired) badges.append(inventoryBadge("Vencido", "danger"));
  else if (product.daysUntilExpiry !== null && product.daysUntilExpiry <= 60) {
    badges.append(inventoryBadge(`Vence em ${product.daysUntilExpiry} dias`, "warning"));
  }
  if (product.outOfStock) badges.append(inventoryBadge("Sem estoque", "danger"));
  else if (product.lowStock) badges.append(inventoryBadge("Estoque baixo", "warning"));
  if (product.missingExpiry) badges.append(inventoryBadge("Sem validade", "neutral"));

  const expiry = document.createElement("span");
  expiry.className = "inventory-expiry";
  expiry.textContent = product.expiryDate
    ? calendarDate.format(new Date(`${product.expiryDate}T12:00:00`))
    : "Validade não informada";
  row.append(identity, stock, badges, expiry);
  return row;
}

function renderInventory() {
  const query = document.getElementById("inventory-search").value.trim().toLocaleLowerCase("pt-BR");
  const filtered = inventoryAlerts.filter((product) => {
    const matchesText = !query || `${product.name} ${product.code} ${product.category}`.toLocaleLowerCase("pt-BR").includes(query);
    const matchesType = inventoryFilter === "all"
      || (inventoryFilter === "expiry" && (product.expired || product.missingExpiry || (product.daysUntilExpiry !== null && product.daysUntilExpiry <= 60)))
      || (inventoryFilter === "stock" && (product.outOfStock || product.lowStock));
    return matchesText && matchesType;
  });
  document.getElementById("inventory-list").replaceChildren(...filtered.map(inventoryRow));
  document.getElementById("inventory-empty").hidden = filtered.length > 0;
}

function productUpdateBadge(update) {
  const badge = document.createElement("span");
  const status = String(update?.status || "");
  const labels = {
    PENDENTE: "Aguardando balcão",
    PROCESSANDO: "Aplicando",
    APLICADO: "Atualizado",
    FALHOU: "Falha na atualização",
  };
  badge.className = `product-sync-badge ${status.toLocaleLowerCase("pt-BR") || "synced"}`;
  badge.textContent = labels[status] || "Sincronizado";
  if (update?.error) badge.title = update.error;
  return badge;
}

const brDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
let productFilter = "all";
let productTotal = 0;
let productCounts = {};
let lastProductRender = "";

function productTag(text, tone) {
  const tag = document.createElement("span");
  tag.className = `product-tag ${tone}`;
  tag.textContent = text;
  return tag;
}

function promoSummary(product) {
  const parts = [];
  if (product.promoPrice) parts.push(`Promoção ${currency.format(product.promoPrice)}`);
  if (product.promoQty && product.promoPackagePrice) {
    parts.push(`Leve ${product.promoQty} por ${currency.format(product.promoPackagePrice)}`);
  }
  return parts;
}

function productRow(product) {
  const row = document.createElement("article");
  row.className = `product-row${product.onPromotion ? " on-promotion" : ""}`;

  const identity = document.createElement("div");
  identity.className = "product-identity";
  const name = document.createElement("strong");
  name.textContent = product.name;
  const detail = document.createElement("span");
  const details = [product.code ? `Código ${product.code}` : "Sem código informado"];
  if (product.category) details.push(product.category);
  if (product.expiryDate) details.push(`Validade ${brDate.format(new Date(`${product.expiryDate}T12:00:00`))}`);
  detail.textContent = details.join(" · ");
  identity.append(name, detail);

  const price = document.createElement("div");
  price.className = "product-value";
  const priceLabel = document.createElement("span");
  priceLabel.textContent = product.promoPrice ? "Preço promocional" : "Preço";
  const priceValue = document.createElement("strong");
  priceValue.textContent = currency.format(product.promoPrice || product.salePrice);
  if (product.promoPrice) priceValue.className = "promo-price";
  price.append(priceLabel, priceValue);
  if (product.promoPrice) {
    const regular = document.createElement("s");
    regular.textContent = currency.format(product.salePrice);
    price.append(regular);
  }

  const stock = document.createElement("div");
  stock.className = "product-value";
  const stockLabel = document.createElement("span");
  stockLabel.textContent = product.minimumStock > 0 ? `Estoque · mín. ${quantityNumber.format(product.minimumStock)}` : "Estoque";
  const stockValue = document.createElement("strong");
  stockValue.textContent = quantityNumber.format(product.stock);
  stock.append(stockLabel, stockValue);

  const actions = document.createElement("div");
  actions.className = "product-actions";
  actions.append(productUpdateBadge(product.update));
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-button compact";
  edit.dataset.productEdit = String(product.id);
  edit.innerHTML = '<i data-lucide="pencil"></i><span>Editar</span>';
  actions.append(edit);

  const tags = document.createElement("div");
  tags.className = "product-tags";
  for (const text of promoSummary(product)) tags.append(productTag(text, "promo"));
  if (product.outOfStock) tags.append(productTag("Sem estoque", "danger"));
  else if (product.lowStock) tags.append(productTag("Estoque baixo", "warning"));
  if (product.expired) tags.append(productTag("Vencido", "danger"));
  else if (product.expiringSoon) tags.append(productTag(`Vence em ${product.daysUntilExpiry} dias`, "warning"));
  if (product.kind === "model") tags.append(productTag("Modelo de produto", "neutral"));
  if (product.kind === "parent") tags.append(productTag("Produto com modelos", "neutral"));
  if (!product.hasDetails) tags.append(productTag("Atualize o FarmaSync deste computador para ver e editar promoções", "neutral"));

  row.append(identity, price, stock, actions);
  if (tags.children.length) row.append(tags);
  if (product.update?.error && product.update.status === "APLICADO") {
    const note = document.createElement("small");
    note.className = "product-note";
    note.textContent = product.update.error;
    row.append(note);
  }
  return row;
}

function renderProducts() {
  const list = document.getElementById("product-list");
  const empty = document.getElementById("product-manager-empty");
  const count = document.getElementById("product-count");
  const shown = managedProducts.length;
  const renderKey = JSON.stringify([managedProducts, productTotal, productCounts, productFilter, document.getElementById("product-search")?.value.trim()]);
  if (renderKey === lastProductRender) return;
  lastProductRender = renderKey;
  const scrollTop = list.scrollTop;
  list.replaceChildren(...managedProducts.map(productRow));
  list.scrollTop = scrollTop;
  list.hidden = shown === 0;
  empty.hidden = shown > 0;
  empty.textContent = productFilter === "all" && !document.getElementById("product-search")?.value.trim()
    ? "Nenhum produto publicado ainda. Os produtos aparecem aqui depois que o FarmaSync enviar o catálogo."
    : "Nenhum produto encontrado com esta busca ou filtro.";
  count.hidden = shown === 0;
  count.textContent = productTotal > shown
    ? `Mostrando ${shown} de ${productTotal} produtos, em ordem alfabética. Use a busca ou os filtros para ver os demais.`
    : `${productTotal} ${productTotal === 1 ? "produto encontrado" : "produtos encontrados"}`;
  for (const key of ["all", "promo", "lowstock", "nostock", "expiry"]) {
    setText(`product-filter-${key}`, quantityNumber.format(productCounts[key] || 0));
  }
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

async function loadProducts() {
  const error = document.getElementById("product-manager-error");
  const loading = document.getElementById("product-manager-loading");
  const search = document.getElementById("product-search")?.value.trim() || "";
  error.hidden = true;
  if (!managedProducts.length) loading.hidden = false;
  try {
    const data = await api(`/api/products?limit=200&filter=${encodeURIComponent(productFilter)}&search=${encodeURIComponent(search)}`);
    productTotal = data.total;
    productCounts = data.counts || {};
    managedProducts = data.products.map((product) => {
      if (["PENDENTE", "PROCESSANDO"].includes(product.update?.status)) {
        const update = product.update;
        return {
          ...product,
          name: update.name,
          salePrice: update.salePrice,
          stock: update.stock,
          ...(update.promoChanged ? {
            promoPrice: update.promoPrice,
            promoQty: update.promoQty,
            promoPackagePrice: update.promoPackagePrice,
            onPromotion: Boolean(update.promoPrice || (update.promoQty && update.promoPackagePrice)),
          } : {}),
        };
      }
      return product;
    });
    renderProducts();
    loading.hidden = true;
  } catch (_requestError) {
    loading.hidden = true;
    error.hidden = false;
  }
}

function closeProductDialog() {
  document.getElementById("product-edit-dialog")?.close();
}

let editingProduct = null;
let editingInitialPromo = null;
const productDialogFields = {
  name: "product-edit-name",
  salePrice: "product-edit-price",
  stock: "product-edit-stock",
  promoPrice: "product-edit-promo-price",
  promoQty: "product-edit-promo-qty",
  promoPackagePrice: "product-edit-promo-package",
};

function dialogInput(field) {
  return document.getElementById(productDialogFields[field]);
}

function optionalNumber(input) {
  const text = String(input.value ?? "").trim().replace(",", ".");
  return text === "" ? null : Number(text);
}

function readProductForm() {
  return {
    name: dialogInput("name").value.trim(),
    salePrice: Number(String(dialogInput("salePrice").value).replace(",", ".")),
    stock: Number(dialogInput("stock").value),
    promoPrice: optionalNumber(dialogInput("promoPrice")),
    promoQty: optionalNumber(dialogInput("promoQty")),
    promoPackagePrice: optionalNumber(dialogInput("promoPackagePrice")),
  };
}

// Mesmas regras do servidor, para avisar antes de enviar e mostrar a mensagem no campo certo.
function productFormProblems(values) {
  const problems = {};
  if (values.name.length < 2 || values.name.length > 255) problems.name = "Informe o nome do produto (2 a 255 letras).";
  if (!Number.isFinite(values.salePrice) || values.salePrice < 0.01) problems.salePrice = "Informe um preço de venda maior que zero.";
  if (!Number.isSafeInteger(values.stock)) problems.stock = "Informe o estoque em número inteiro.";
  const price = Number.isFinite(values.salePrice) ? values.salePrice : 0;
  if (values.promoPrice !== null && (!Number.isFinite(values.promoPrice) || values.promoPrice <= 0 || values.promoPrice >= price)) {
    problems.promoPrice = "O preço promocional deve ser maior que zero e menor que o preço de venda.";
  }
  if (values.promoQty !== null && (!Number.isSafeInteger(values.promoQty) || values.promoQty < 2 || values.promoQty > 999)) {
    problems.promoQty = "Informe uma quantidade inteira de 2 a 999.";
  }
  if (values.promoPackagePrice !== null && (!Number.isFinite(values.promoPackagePrice) || values.promoPackagePrice <= 0)) {
    problems.promoPackagePrice = "Informe o valor do pacote maior que zero.";
  }
  if (!problems.promoQty && !problems.promoPackagePrice) {
    if (values.promoQty !== null && values.promoPackagePrice === null) problems.promoPackagePrice = "Informe por quanto sai o pacote.";
    else if (values.promoQty === null && values.promoPackagePrice !== null) problems.promoQty = "Informe quantas unidades levam no pacote.";
    else if (values.promoQty !== null && values.promoPackagePrice >= Math.round(values.promoQty * (values.promoPrice ?? price) * 100) / 100) {
      problems.promoPackagePrice = "O valor do pacote precisa ser menor que comprar as unidades separadas.";
    }
  }
  return problems;
}

function updateProductPromoPreview() {
  const values = readProductForm();
  const preview = document.getElementById("product-edit-promo-preview");
  const lines = [];
  if (values.promoPrice !== null && Number.isFinite(values.promoPrice) && values.promoPrice > 0) {
    lines.push(`Preço no balcão: ${currency.format(values.salePrice || 0)} → ${currency.format(values.promoPrice)}.`);
  }
  if (values.promoQty && values.promoPackagePrice) {
    lines.push(`Leve ${values.promoQty} por ${currency.format(values.promoPackagePrice)} (${currency.format(values.promoPackagePrice / values.promoQty)} cada).`);
  }
  preview.textContent = lines.join(" ") || "Sem promoção ativa.";
}

function setProductDialogLocks(product) {
  const isModel = product.kind === "model";
  const isParent = product.kind === "parent";
  const promoLocked = isModel || !product.hasDetails;
  dialogInput("name").disabled = isModel;
  dialogInput("salePrice").disabled = isModel;
  dialogInput("stock").disabled = isParent;
  for (const field of ["promoPrice", "promoQty", "promoPackagePrice"]) dialogInput(field).disabled = promoLocked;
  document.getElementById("product-edit-promo-clear").disabled = promoLocked;
  const info = document.getElementById("product-edit-info");
  const messages = [];
  if (isModel) messages.push("Este é um modelo de produto: nome, preço e promoção seguem o produto principal. Aqui você altera só o estoque.");
  if (isParent) messages.push("O estoque deste produto vem da soma dos seus modelos. Ajuste o estoque pelos modelos no balcão.");
  if (!product.hasDetails && !isModel) messages.push("Para editar promoções, atualize o FarmaSync deste computador. Nome, preço e estoque já podem ser alterados.");
  info.textContent = messages.join(" ");
  info.hidden = messages.length === 0;
}

function openProductDialog(product) {
  editingProduct = product;
  const details = [product.code ? `Código ${product.code}` : "Produto sem código"];
  if (product.category) details.push(product.category);
  if (product.expiryDate) details.push(`Validade ${brDate.format(new Date(`${product.expiryDate}T12:00:00`))}`);
  setText("product-edit-code", details.join(" · "));
  document.getElementById("product-edit-id").value = product.id;
  dialogInput("name").value = product.name;
  dialogInput("salePrice").value = Number(product.salePrice).toFixed(2);
  dialogInput("stock").value = product.stock;
  dialogInput("promoPrice").value = product.promoPrice ? Number(product.promoPrice).toFixed(2) : "";
  dialogInput("promoQty").value = product.promoQty || "";
  dialogInput("promoPackagePrice").value = product.promoPackagePrice ? Number(product.promoPackagePrice).toFixed(2) : "";
  editingInitialPromo = {
    promoPrice: product.promoPrice || null,
    promoQty: product.promoQty || null,
    promoPackagePrice: product.promoPackagePrice || null,
  };
  for (const field of Object.keys(productDialogFields)) setFieldError(dialogInput(field), "");
  document.getElementById("product-edit-error").hidden = true;
  setProductDialogLocks(product);
  updateProductPromoPreview();
  document.getElementById("product-edit-dialog").showModal();
  (dialogInput("name").disabled ? dialogInput("stock") : dialogInput("name")).focus();
}

const productSaveMessages = {
  pc_update_required: "Para editar promoções, atualize o FarmaSync deste computador.",
  model_follows_parent: "Este modelo segue o produto principal. Altere nome, preço e promoção no produto principal.",
  parent_stock_from_models: "O estoque deste produto vem dos modelos. Ajuste pelos modelos no balcão.",
  too_many_attempts: "Muitas alterações em pouco tempo. Aguarde alguns minutos e tente de novo.",
};

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = document.getElementById("product-edit-error");
  const id = Number(document.getElementById("product-edit-id").value);
  const values = readProductForm();
  const problems = productFormProblems(values);
  for (const field of Object.keys(productDialogFields)) setFieldError(dialogInput(field), problems[field] || "");
  error.hidden = true;
  const firstProblem = Object.keys(productDialogFields).find((field) => problems[field]);
  if (firstProblem) {
    dialogInput(firstProblem).focus();
    return;
  }
  const payload = { name: values.name, salePrice: values.salePrice, stock: values.stock };
  const promoChanged = ["promoPrice", "promoQty", "promoPackagePrice"].some((key) => values[key] !== editingInitialPromo[key]);
  const canSendPromo = editingProduct.kind !== "model" && editingProduct.hasDetails && promoChanged;
  if (canSendPromo) {
    payload.promoPrice = values.promoPrice;
    payload.promoQty = values.promoQty;
    payload.promoPackagePrice = values.promoPackagePrice;
  }
  button.disabled = true;
  try {
    await api(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    managedProducts = managedProducts.map((product) => product.id === id ? {
      ...product,
      name: payload.name,
      salePrice: payload.salePrice,
      stock: payload.stock,
      ...(canSendPromo ? {
        promoPrice: payload.promoPrice,
        promoQty: payload.promoQty,
        promoPackagePrice: payload.promoPackagePrice,
        onPromotion: Boolean(payload.promoPrice || (payload.promoQty && payload.promoPackagePrice)),
      } : {}),
      update: { status: "PENDENTE", error: null },
    } : product);
    renderProducts();
    closeProductDialog();
    loadProducts();
  } catch (requestError) {
    if (requestError.field && dialogInput(requestError.field)) {
      setFieldError(dialogInput(requestError.field), "Revise este campo.");
      dialogInput(requestError.field).focus();
    }
    error.textContent = productSaveMessages[requestError.message]
      || (requestError.message === "invalid_product_update"
        ? "Revise os campos destacados."
        : "Não foi possível enviar a alteração. Tente novamente.");
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function loadInventory() {
  const error = document.getElementById("inventory-error");
  const loading = document.getElementById("inventory-loading");
  const content = document.getElementById("inventory-content");
  error.hidden = true;
  loading.hidden = false;
  content.hidden = true;
  try {
    const data = await api("/api/inventory");
    setText("inventory-products-value", quantityNumber.format(data.summary.activeProducts));
    setText("inventory-units-value", quantityNumber.format(data.summary.stockUnits));
    setText("inventory-cost-value", currency.format(data.summary.stockCost));
    setText("inventory-out-value", data.summary.outOfStock);
    setText("inventory-low-value", data.summary.lowStock);
    setText("inventory-expired-value", data.summary.expired);
    setText("inventory-expiring-value", data.summary.expiringSoon);
    setText("inventory-missing-expiry", `${data.summary.missingExpiry} sem validade cadastrada`);
    inventoryAlerts = data.alerts;
    renderInventory();
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

const paymentMethodNames = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  DEBITO: "Cartão de débito",
  CREDITO: "Cartão de crédito",
  COMPRA_LOJA: "Compra na loja",
  CREDITO_LOJA: "Crédito da loja",
  CREDITO_TROCA: "Crédito de troca",
};

function cashPaymentRow(method, total) {
  const row = document.createElement("article");
  row.className = "cash-payment-row";
  const label = document.createElement("strong");
  label.textContent = paymentMethodNames[method.code] || method.code.replaceAll("_", " ");
  const bar = document.createElement("progress");
  bar.max = total || 1;
  bar.value = method.amount;
  bar.setAttribute("aria-label", `${label.textContent}: ${currency.format(method.amount)}`);
  const amount = document.createElement("span");
  amount.textContent = currency.format(method.amount);
  const share = document.createElement("small");
  share.textContent = total > 0 ? `${Math.round((method.amount / total) * 100)}%` : "0%";
  row.append(label, bar, amount, share);
  return row;
}

function cashSessionRow(session) {
  const row = document.createElement("article");
  row.className = "cash-session-row";
  const operator = document.createElement("strong");
  operator.textContent = session.operatorName;
  const opened = document.createElement("span");
  opened.textContent = `Abertura: ${dateTime.format(new Date(session.openedAt.replace(" ", "T")))}`;
  const closed = document.createElement("span");
  closed.textContent = session.closedAt
    ? `Fechamento: ${dateTime.format(new Date(session.closedAt.replace(" ", "T")))}`
    : "Caixa aberto";
  closed.className = session.closedAt ? "" : "open";
  row.append(operator, opened, closed);
  return row;
}

async function loadCash() {
  const error = document.getElementById("cash-error");
  const loading = document.getElementById("cash-loading");
  const content = document.getElementById("cash-content");
  error.hidden = true;
  loading.hidden = false;
  content.hidden = true;
  try {
    const data = await api("/api/cash");
    setText("cash-payments-value", currency.format(data.totalPaymentsToday));
    setText("cash-expected-value", currency.format(data.expectedBalanceOpen));
    setText("cash-opening-detail", `${currency.format(data.openingBalanceOpen)} de saldo inicial`);
    setText("cash-withdrawals-value", currency.format(data.withdrawalsOpen));
    setText("cash-supplies-value", currency.format(data.suppliesOpen));
    setText("cash-open-sessions", `${data.openSessions} aberto${data.openSessions === 1 ? "" : "s"}`);
    setText("cash-closed-sessions", `${data.closedSessionsToday} fechado${data.closedSessionsToday === 1 ? "" : "s"} hoje`);
    const status = document.getElementById("cash-session-status");
    status.className = `cash-session-status ${data.openSessions > 0 ? "open" : "closed"}`;
    status.innerHTML = `<i data-lucide="${data.openSessions > 0 ? "circle-dot" : "circle-check"}"></i><strong>${data.openSessions > 0 ? "Caixa aberto" : "Caixas fechados"}</strong>`;
    document.getElementById("cash-payment-list").replaceChildren(
      ...data.paymentMethods.map((method) => cashPaymentRow(method, data.totalPaymentsToday)),
    );
    document.getElementById("cash-payment-empty").hidden = data.paymentMethods.length > 0;
    document.getElementById("cash-session-list").replaceChildren(
      ...data.sessions.map(cashSessionRow),
    );
    document.getElementById("cash-session-empty").hidden = data.sessions.length > 0;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

function minutesLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
}

function syncAgeLabel(minutes) {
  if (minutes === null) return "Nenhum pacote recebido";
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours} hora${hours === 1 ? "" : "s"}`;
}

function syncModuleRow(module) {
  const icons = {
    sales: "chart-no-axes-combined",
    campaigns: "gift",
    inventory: "package-search",
    cash: "wallet-cards",
    "deliveries-credit": "bike",
    "suspicious-actions": "shield-alert",
  };
  const row = document.createElement("article");
  row.className = `sync-module-row ${module.status}`;
  row.innerHTML = `<span class="sync-module-icon"><i data-lucide="${icons[module.id] || "database"}"></i></span><div><strong></strong><span>Incluído no pacote operacional</span></div><small></small>`;
  row.querySelector("strong").textContent = module.name;
  row.querySelector("small").textContent = module.statusLabel;
  return row;
}

async function loadSyncHealth() {
  const error = document.getElementById("sync-health-error");
  const loading = document.getElementById("sync-health-loading");
  const content = document.getElementById("sync-health-content");
  const refresh = document.getElementById("sync-health-refresh");
  error.hidden = true;
  loading.hidden = false;
  refresh.disabled = true;
  try {
    const data = await api("/api/sync-health");
    const messages = {
      current: "Os dados operacionais estão chegando normalmente.",
      attention: "O último pacote está atrasado. Acompanhe a próxima atualização.",
      interrupted: "O FarmaSync não envia novos dados há mais de uma hora.",
      never: "O portal ainda não recebeu dados deste estabelecimento.",
    };
    const overview = document.getElementById("sync-health-overview");
    overview.className = `sync-health-overview ${data.status}`;
    setText("sync-health-status", data.statusLabel);
    setText("sync-health-detail", messages[data.status]);
    setText("sync-health-last", data.lastSuccessfulSyncAt ? dateTime.format(new Date(data.lastSuccessfulSyncAt)) : "--");
    setText("sync-health-age", syncAgeLabel(data.ageMinutes));
    document.getElementById("sync-health-modules").replaceChildren(...data.modules.map(syncModuleRow));
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  } finally {
    refresh.disabled = false;
  }
}

function operationalPeriodLabel(period) {
  const start = period?.startDate ? calendarDate.format(new Date(`${period.startDate}T12:00:00`)) : "--";
  const end = period?.endDate ? calendarDate.format(new Date(`${period.endDate}T12:00:00`)) : "--";
  return start === end ? start : `${start} a ${end}`;
}

async function loadDeliveryPeriod(period = "today") {
  const error = document.getElementById("delivery-credit-error");
  const loading = document.getElementById("delivery-credit-loading");
  const content = document.getElementById("delivery-credit-content");
  error.hidden = true;
  if (content.hidden) loading.hidden = false;
  try {
    const data = await api(`/api/deliveries-credit?period=${encodeURIComponent(period)}`);
    setText("delivery-reference", operationalPeriodLabel(data.period));
    setText("delivery-pending-value", data.deliveries.pending);
    setText("delivery-pending-amount", currency.format(data.deliveries.pendingAmount));
    setText("delivery-urgent-value", data.deliveries.urgent);
    setText("delivery-wait-value", data.deliveries.pending > 0 ? minutesLabel(data.deliveries.longestWaitMinutes) : "--");
    setText("delivery-completed-value", data.deliveries.completedToday);
    setText("delivery-completed-amount", currency.format(data.deliveries.completedAmountToday));
    setText("delivery-average-value", data.deliveries.completedToday > 0 ? minutesLabel(data.deliveries.averageMinutesToday) : "--");
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

async function loadCreditPeriod(period = "today") {
  const error = document.getElementById("delivery-credit-error");
  const loading = document.getElementById("delivery-credit-loading");
  const content = document.getElementById("delivery-credit-content");
  error.hidden = true;
  if (content.hidden) loading.hidden = false;
  try {
    const data = await api(`/api/deliveries-credit?period=${encodeURIComponent(period)}`);
    setText("credit-reference", operationalPeriodLabel(data.period));
    setText("credit-pending-amount", currency.format(data.credit.pendingAmount));
    setText("credit-pending-count", `${data.credit.pending} registro${data.credit.pending === 1 ? "" : "s"} em aberto no período`);
    setText("credit-paid-amount", currency.format(data.credit.paidAmountToday));
    setText("credit-paid-count", `${data.credit.paidToday} baixa${data.credit.paidToday === 1 ? "" : "s"} no período`);
    setText("credit-oldest-value", data.credit.pending > 0 ? `${data.credit.oldestDays} dia${data.credit.oldestDays === 1 ? "" : "s"}` : "--");
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

function suspiciousActionRow(category) {
  const row = document.createElement("article");
  row.className = "suspicious-action-row";
  row.innerHTML = `<span class="suspicious-action-icon"><i data-lucide="triangle-alert"></i></span><div><strong></strong><small></small></div><span class="suspicious-action-count"></span>`;
  row.querySelector("strong").textContent = category.label;
  row.querySelector("small").textContent = category.lastEventAt
    ? `Última ocorrência: ${dateTime.format(new Date(category.lastEventAt.replace(" ", "T")))}`
    : "Sem horário registrado";
  row.querySelector(".suspicious-action-count").textContent = category.count;
  return row;
}

function suspiciousOccurrenceRow(occurrence) {
  const details = document.createElement("details");
  details.className = "suspicious-occurrence";
  details.innerHTML = `<summary><span class="suspicious-occurrence-icon"><i data-lucide="file-warning"></i></span><div><strong></strong><time></time></div><span class="suspicious-occurrence-open">Ver detalhes <i data-lucide="chevron-down"></i></span></summary><div class="suspicious-occurrence-body"><p></p><div class="suspicious-occurrence-metrics"><div><span>Valor estimado</span><strong></strong></div><div><span>Produtos</span><strong></strong></div><div><span>Unidades</span><strong></strong></div></div><small>Dados de operador, produtos e venda permanecem protegidos no FarmaSync.</small></div>`;
  details.querySelector("summary strong").textContent = occurrence.label;
  details.querySelector("time").textContent = occurrence.occurredAt
    ? dateTime.format(new Date(occurrence.occurredAt.replace(" ", "T")))
    : "Horário não informado";
  details.querySelector(".suspicious-occurrence-body p").textContent = occurrence.explanation;
  const metrics = details.querySelectorAll(".suspicious-occurrence-metrics strong");
  metrics[0].textContent = currency.format(occurrence.estimatedAmount);
  metrics[1].textContent = `${occurrence.itemLines} linha${occurrence.itemLines === 1 ? "" : "s"}`;
  metrics[2].textContent = quantityNumber.format(occurrence.units);
  return details;
}

async function loadSuspiciousActions(period = "today") {
  const error = document.getElementById("suspicious-actions-error");
  const loading = document.getElementById("suspicious-actions-loading");
  const content = document.getElementById("suspicious-actions-content");
  const empty = document.getElementById("suspicious-actions-empty");
  const occurrencesEmpty = document.getElementById("suspicious-occurrences-empty");
  error.hidden = true;
  loading.hidden = false;
  content.hidden = true;
  try {
    const data = await api(`/api/suspicious-actions?period=${encodeURIComponent(period)}`);
    const start = data.period?.startDate ? calendarDate.format(new Date(`${data.period.startDate}T12:00:00`)) : "--";
    const end = data.period?.endDate ? calendarDate.format(new Date(`${data.period.endDate}T12:00:00`)) : "--";
    setText("suspicious-actions-reference", `Ocorrências de ${start}${start === end ? "" : ` a ${end}`}`);
    setText("suspicious-actions-total", data.total);
    setText("suspicious-actions-last", data.lastEventAt
      ? `Última: ${dateTime.format(new Date(data.lastEventAt.replace(" ", "T")))}`
      : "Nenhuma ocorrência no período");
    const categories = data.categories.filter((category) => category.count > 0);
    document.getElementById("suspicious-actions-list").replaceChildren(...categories.map(suspiciousActionRow));
    empty.hidden = categories.length > 0;
    const occurrences = Array.isArray(data.occurrences) ? data.occurrences : [];
    document.getElementById("suspicious-occurrences-list").replaceChildren(...occurrences.map(suspiciousOccurrenceRow));
    occurrencesEmpty.hidden = occurrences.length > 0;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    loading.hidden = true;
    content.hidden = false;
  } catch (requestError) {
    loading.hidden = true;
    if (requestError.message !== "unauthorized") error.hidden = false;
  }
}

async function loadDashboard() {
  const errorPanel = document.getElementById("dashboard-error");
  try {
    const data = await api("/api/dashboard");
    errorPanel.hidden = true;
    setText("pharmacy-name", data.pharmacy.name);
    metric("sales", data.today.salesAmount, data.today.salesCount, "venda");
    setText("ticket-value", currency.format(data.today.averageTicket));
    setText("ticket-detail", "por venda concluída");
    metric("exchanges", data.today.exchangesAmount, data.today.exchangesCount, "troca");
    metric("returns", data.today.returnsAmount, data.today.returnsCount, "devolução");
    setText("cancellations-value", currency.format(data.today.cancellationsAmount));
    setText("cancellations-detail", `${data.today.cancellationsCount} registro${data.today.cancellationsCount === 1 ? "" : "s"} hoje`);

    const sync = document.getElementById("sync-status");
    sync.className = `sync-status ${data.sync.stale ? "stale" : "online"}`;
    sync.querySelector("strong").textContent = data.sync.stale ? "Dados desatualizados" : "Dados atualizados";
    sync.title = data.sync.snapshotAt ? `Último envio: ${dateTime.format(new Date(data.sync.snapshotAt))}` : "Ainda não houve sincronização";
  } catch (requestError) {
    if (requestError.message !== "unauthorized") errorPanel.hidden = false;
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_error) { /* sessão local será abandonada */ }
  window.location.replace("/");
}

function initializeSidebarNavigation() {
  const links = [...document.querySelectorAll(".sidebar .nav-item, .mobile-navigation .nav-item")];
  const sectionLinks = links.filter((link) => link.hash);
  const overviewLink = links.find((link) => !link.hash);

  function activate(link) {
    links.forEach((item) => {
      const active = link && item.hash === link.hash;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  sectionLinks.forEach((link) => {
    link.addEventListener("click", () => {
      activate(link);
      closeMobileNavigation();
    });
  });

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (!visible) return;
    activate(sectionLinks.find((link) => link.hash === `#${visible.target.id}`));
  }, { rootMargin: "-15% 0px -65% 0px", threshold: [0, 0.1, 0.25] });

  sectionLinks.forEach((link) => {
    const section = document.querySelector(link.hash);
    if (section) observer.observe(section);
  });
  window.addEventListener("scroll", () => {
    if (window.scrollY < 180) activate(overviewLink);
  }, { passive: true });
}

function closeMobileNavigation() {
  const navigation = document.getElementById("mobile-navigation");
  const button = document.getElementById("mobile-menu-button");
  if (!navigation || !button) return;
  navigation.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

function initializeMobileNavigation() {
  const navigation = document.getElementById("mobile-navigation");
  const button = document.getElementById("mobile-menu-button");
  if (!navigation || !button) return;
  button.addEventListener("click", () => {
    const opening = navigation.hidden;
    navigation.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", (event) => {
    if (!navigation.hidden && !navigation.contains(event.target) && !button.contains(event.target)) closeMobileNavigation();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNavigation();
  });
}

function initializeDashboard() {
  if (document.body.dataset.page !== "dashboard") return;
  initializeSidebarNavigation();
  initializeMobileNavigation();
  document.getElementById("retry-button")?.addEventListener("click", loadDashboard);
  document.getElementById("logout-button")?.addEventListener("click", logout);
  document.getElementById("mobile-logout-button")?.addEventListener("click", logout);
  document.getElementById("sync-health-refresh")?.addEventListener("click", loadSyncHealth);
  document.getElementById("club-coupon-form")?.addEventListener("submit", saveClubCoupon);
  document.getElementById("club-validity-form")?.addEventListener("submit", saveClubPointsValidity);
  document.getElementById("club-tiers-form")?.addEventListener("submit", saveClubTiers);
  document.getElementById("club-referral-form")?.addEventListener("submit", saveClubReferralBonus);
  document.getElementById("club-cashback-form")?.addEventListener("submit", saveClubCashbackRate);
  document.getElementById("club-birthday-form")?.addEventListener("submit", saveClubBirthdayCampaign);
  document.getElementById("club-member-form")?.addEventListener("submit", saveClubMemberAction);
  document.getElementById("club-cashback-cancel-form")?.addEventListener("submit", cancelClubCashback);
  document.getElementById("club-member-action")?.addEventListener("change", setClubMemberActionFields);
  document.getElementById("club-member-dialog-close")?.addEventListener("click", () => document.getElementById("club-member-dialog").close());
  document.getElementById("club-member-cancel")?.addEventListener("click", () => document.getElementById("club-member-dialog").close());
  document.getElementById("club-cashback-cancel-close")?.addEventListener("click", () => document.getElementById("club-cashback-cancel-dialog").close());
  document.getElementById("club-cashback-cancel-dismiss")?.addEventListener("click", () => document.getElementById("club-cashback-cancel-dialog").close());
  document.getElementById("club-cashback-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-club-cashback-cancel]");
    const cashback = clubCashbacks.find((item) => String(item.id) === button?.dataset.clubCashbackCancel);
    if (cashback) openCashbackCancelDialog(cashback);
  });
  document.getElementById("club-risk-dialog-close")?.addEventListener("click", closeClubRiskDialog);
  document.getElementById("club-risk-dialog-done")?.addEventListener("click", closeClubRiskDialog);
  document.getElementById("club-risk-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-club-risk-alert]");
    const alert = clubRiskAlerts[Number(button?.dataset.clubRiskAlert)];
    if (alert) openClubRiskDialog(alert);
  });
  document.getElementById("club-risk-dialog-member-action")?.addEventListener("click", () => {
    const member = clubMembers.find((item) => Number(item.id) === Number(selectedClubRiskAlert?.memberId));
    if (!member) return;
    closeClubRiskDialog();
    openClubMemberDialog(member);
  });
  document.getElementById("club-member-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-club-member-action]");
    const member = clubMembers.find((item) => String(item.id) === button?.dataset.clubMemberAction);
    if (member) openClubMemberDialog(member);
  });
  document.getElementById("club-member-search")?.addEventListener("input", renderClubMembers);
  document.getElementById("club-copy-link")?.addEventListener("click", (event) => {
    copyClubText(clubShare.url, event.currentTarget, "Link copiado");
  });
  document.getElementById("club-copy-invite")?.addEventListener("click", (event) => {
    copyClubText(clubShare.invitation, event.currentTarget, "Convite copiado");
  });
  document.getElementById("club-coupon-cancel")?.addEventListener("click", resetClubCouponForm);
  document.getElementById("club-coupon-list")?.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-club-coupon-edit]");
    const toggleButton = event.target.closest("[data-club-coupon-toggle]");
    const id = editButton?.dataset.clubCouponEdit || toggleButton?.dataset.clubCouponToggle;
    const coupon = clubCoupons.find((item) => String(item.id) === id);
    if (!coupon) return;
    if (editButton) editClubCoupon(coupon);
    if (toggleButton) {
      toggleButton.disabled = true;
      try {
        await toggleClubCoupon(coupon);
      } catch (_error) {
        document.getElementById("club-error").hidden = false;
        toggleButton.disabled = false;
      }
    }
  });
  document.querySelectorAll("[data-history-period]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-history-period]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      setHistoryPeriod(button.dataset.historyPeriod);
      loadSalesHistory();
    });
  });
  document.getElementById("history-filter")?.addEventListener("submit", (event) => {
    event.preventDefault();
    document.querySelectorAll("[data-history-period]").forEach((item) => item.classList.remove("active"));
    loadSalesHistory();
  });
  document.querySelectorAll("[data-delivery-period]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-delivery-period]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      loadDeliveryPeriod(button.dataset.deliveryPeriod);
    });
  });
  document.querySelectorAll("[data-credit-period]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-credit-period]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      loadCreditPeriod(button.dataset.creditPeriod);
    });
  });
  document.querySelectorAll("[data-suspicious-period]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-suspicious-period]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      loadSuspiciousActions(button.dataset.suspiciousPeriod);
    });
  });
  document.getElementById("inventory-search")?.addEventListener("input", renderInventory);
  document.getElementById("product-search")?.addEventListener("input", () => {
    window.clearTimeout(productSearchTimer);
    productSearchTimer = window.setTimeout(async () => {
      await loadProducts();
      const list = document.getElementById("product-list");
      if (list) list.scrollTop = 0;
    }, 250);
  });
  document.getElementById("product-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-edit]");
    const product = managedProducts.find((item) => String(item.id) === button?.dataset.productEdit);
    if (product) openProductDialog(product);
  });
  document.getElementById("product-edit-form")?.addEventListener("submit", saveProduct);
  for (const field of Object.keys(productDialogFields)) {
    dialogInput(field)?.addEventListener("input", () => {
      setFieldError(dialogInput(field), "");
      updateProductPromoPreview();
    });
  }
  document.getElementById("product-edit-promo-clear")?.addEventListener("click", () => {
    for (const field of ["promoPrice", "promoQty", "promoPackagePrice"]) {
      dialogInput(field).value = "";
      setFieldError(dialogInput(field), "");
    }
    updateProductPromoPreview();
  });
  document.querySelectorAll("[data-product-filter]").forEach((button) => {
    button.addEventListener("click", async () => {
      productFilter = button.dataset.productFilter;
      document.querySelectorAll("[data-product-filter]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      await loadProducts();
      const list = document.getElementById("product-list");
      if (list) list.scrollTop = 0;
    });
  });
  document.getElementById("product-edit-close")?.addEventListener("click", closeProductDialog);
  document.getElementById("product-edit-cancel")?.addEventListener("click", closeProductDialog);
  document.querySelectorAll("[data-inventory-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-inventory-filter]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      inventoryFilter = button.dataset.inventoryFilter;
      renderInventory();
    });
  });
  setHistoryPeriod("previous-month");
  loadDashboard();
  loadSalesHistory();
  loadCampaigns();
  loadClub();
  loadInventory();
  loadProducts();
  loadCash();
  loadDeliveryPeriod();
  loadCreditPeriod();
  loadSuspiciousActions();
  loadSyncHealth();
  window.setInterval(loadSyncHealth, 60000);
  window.setInterval(loadProducts, 10000);
}

window.addEventListener("DOMContentLoaded", () => {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  initializeLogin();
  initializeFirstAccess();
  initializePasswordRecovery();
  initializeDashboard();
});