const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PORTAL_VERSION } = require("./version");

// A versão vem do conteúdo do arquivo: ao mudar o arquivo, a URL muda sozinha
// e nenhum navegador continua usando a cópia antiga em cache.
function assetVersion(file) {
  try {
    const content = fs.readFileSync(path.join(__dirname, "..", "public", file));
    return crypto.createHash("sha1").update(content).digest("hex").slice(0, 10);
  } catch (_error) {
    return String(Date.now());
  }
}

const ASSET_VERSION = {
  styles: assetVersion("styles.css"),
  icons: assetVersion("icons.js"),
  app: assetVersion("app.js"),
  notes: assetVersion("notes.js"),
  deliveries: assetVersion("deliveries.js"),
  mark: assetVersion("logo-mark.png"),
  favicon: assetVersion("favicon.png"),
  touch: assetVersion("apple-touch-icon.png"),
  icon192: assetVersion("icon-192.png"),
  icon512: assetVersion("icon-512.png"),
};

// Manifesto do app: é o que faz o atalho do celular usar o logo do FarmaSync (em vez da letra "P").
function webManifest() {
  return {
    name: "FarmaSync Portal Gestor",
    short_name: "FarmaSync",
    description: "Acompanhe sua farmácia com os dados do FarmaSync.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#102f55",
    icons: [
      { src: `/assets/icon-192.png?v=${ASSET_VERSION.icon192}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/assets/icon-512.png?v=${ASSET_VERSION.icon512}`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

function documentShell({ title, body, page }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#102f55">
  <meta name="robots" content="noindex, nofollow">
  <title>${title}</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png?v=${ASSET_VERSION.favicon}">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png?v=${ASSET_VERSION.touch}">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="FarmaSync">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/styles.css?v=${ASSET_VERSION.styles}">
</head>
<body data-page="${page}">
${body}
  <script src="/assets/icons.js?v=${ASSET_VERSION.icons}"></script>
  <script src="/assets/app.js?v=${ASSET_VERSION.app}" defer></script>
${page === "dashboard" ? `  <script src="/assets/notes.js?v=${ASSET_VERSION.notes}" defer></script>\n  <script src="/assets/deliveries.js?v=${ASSET_VERSION.deliveries}" defer></script>\n` : ""}</body>
</html>`;
}

function brand() {
  return `<a class="brand" href="/" aria-label="FarmaSync Portal Gestor">
    <img src="/assets/logo-mark.png?v=${ASSET_VERSION.mark}" alt="" width="52" height="52">
    <span><strong>FarmaSync</strong><small>Portal Gestor</small></span>
  </a>`;
}

function loginPage() {
  return documentShell({
    title: "Acessar | FarmaSync Portal Gestor",
    page: "login",
    body: `<main class="login-layout">
      <section class="login-brand-panel">
        <div class="login-brand-top">${brand()}<span class="environment-badge"><i data-lucide="shield-check"></i> Acesso protegido</span></div>
        <div class="login-message">
          <p class="eyebrow">Gestão fora do balcão</p>
          <h1><span class="desktop-title">Sua farmácia continua perto, mesmo quando você não está&nbsp;lá.</span><span class="mobile-title">Sua farmácia, sempre por perto.</span></h1>
          <p>Acompanhe a operação com dados enviados pelo FarmaSync.</p>
        </div>
        <div class="login-brand-footer">
          <div class="signal-strip" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
          <span>Informação clara para decisões rápidas</span>
        </div>
      </section>
      <section class="login-form-panel">
        <form id="login-form" class="login-form" novalidate>
          <div class="login-form-heading">
            <p class="eyebrow">Acesso do gestor</p>
            <h2>Entrar no portal</h2>
            <p class="muted">Use o e-mail cadastrado para sua farmácia.</p>
          </div>
          <label>E-mail
            <span class="input-wrap"><i data-lucide="mail"></i><input id="login-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="254" aria-describedby="login-email-error"></span>
            <span id="login-email-error" class="field-error" role="alert" hidden></span>
          </label>
          <label>Senha
            <span class="input-wrap"><i data-lucide="lock-keyhole"></i><input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="128" aria-describedby="login-password-error"><button id="toggle-password" class="password-toggle" type="button" title="Mostrar senha" aria-label="Mostrar senha"><i data-lucide="eye"></i></button></span>
            <span id="login-password-error" class="field-error" role="alert" hidden></span>
          </label>
          <p id="login-error" class="form-error" role="alert" hidden></p>
          <p id="login-reauth-notice" class="form-message" role="status" hidden>Por segurança, confirme sua senha para alterar dados.</p>
          <label class="remember-option"><input id="login-remember" name="remember" type="checkbox"><span>Manter conectado por 30 dias neste aparelho</span></label>
          <button class="primary-button" type="submit"><span>Acessar painel</span><i data-lucide="arrow-right"></i></button>
          <a class="form-link" href="/esqueci-minha-senha">Esqueci minha senha</a>
          <div class="login-assurance"><i data-lucide="lock"></i><span>Sessão protegida e acesso exclusivo por farmácia</span></div>
        </form>
      </section>
    </main>`,
  });
}

function forgotPasswordPage() {
  return documentShell({
    title: "Recuperar senha | FarmaSync Portal Gestor",
    page: "forgot-password",
    body: `<main class="first-access-layout">
      <header class="first-access-header">${brand()}<span class="environment-badge"><i data-lucide="mail-check"></i> Recuperação segura</span></header>
      <section class="first-access-content">
        <div class="first-access-message">
          <span class="first-access-icon"><i data-lucide="key-round"></i></span>
          <p class="eyebrow">Recupere seu acesso</p>
          <h1>Esqueceu sua senha?</h1>
          <p>Informe seu e-mail. Se ele estiver cadastrado, enviaremos um link válido por 15 minutos.</p>
        </div>
        <form id="forgot-password-form" class="first-access-form" novalidate>
          <div><p class="eyebrow">E-mail de acesso</p><h2>Receber link</h2></div>
          <label>E-mail
            <span class="input-wrap"><i data-lucide="mail"></i><input id="forgot-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" aria-describedby="forgot-email-error"></span>
            <span id="forgot-email-error" class="field-error" role="alert" hidden></span>
          </label>
          <p id="forgot-password-message" class="form-message" role="status" hidden></p>
          <button class="primary-button" type="submit"><span>Enviar link</span><i data-lucide="send"></i></button>
          <a class="form-link" href="/">Voltar para o login</a>
        </form>
      </section>
    </main>`,
  });
}

function resetPasswordPage() {
  return documentShell({
    title: "Redefinir senha | FarmaSync Portal Gestor",
    page: "reset-password",
    body: `<main class="first-access-layout">
      <header class="first-access-header">${brand()}<span class="environment-badge"><i data-lucide="shield-check"></i> Link protegido</span></header>
      <section class="first-access-content">
        <div class="first-access-message">
          <span class="first-access-icon"><i data-lucide="lock-keyhole"></i></span>
          <p class="eyebrow">Novo acesso</p>
          <h1>Crie uma nova senha</h1>
          <p>Use pelo menos 10 caracteres. Ao concluir, os acessos anteriores serão encerrados.</p>
        </div>
        <form id="reset-password-form" class="first-access-form">
          <div><p class="eyebrow">Senha permanente</p><h2>Redefinir senha</h2></div>
          <label>Nova senha
            <span class="input-wrap"><i data-lucide="lock-keyhole"></i><input name="password" type="password" autocomplete="new-password" minlength="10" required></span>
          </label>
          <label>Confirmar nova senha
            <span class="input-wrap"><i data-lucide="shield-check"></i><input name="confirmation" type="password" autocomplete="new-password" minlength="10" required></span>
          </label>
          <p id="reset-password-error" class="form-error" role="alert" hidden></p>
          <button class="primary-button" type="submit"><span>Salvar nova senha</span><i data-lucide="arrow-right"></i></button>
        </form>
      </section>
    </main>`,
  });
}

function firstAccessPage() {
  return documentShell({
    title: "Criar nova senha | FarmaSync Portal Gestor",
    page: "first-access",
    body: `<main class="first-access-layout">
      <header class="first-access-header">${brand()}<span class="environment-badge"><i data-lucide="shield-check"></i> Primeiro acesso</span></header>
      <section class="first-access-content">
        <div class="first-access-message">
          <span class="first-access-icon"><i data-lucide="key-round"></i></span>
          <p class="eyebrow">Proteja seu acesso</p>
          <h1>Defina sua nova senha</h1>
          <p>O código recebido foi temporário. Cadastre uma senha pessoal antes de continuar para o painel.</p>
          <ul>
            <li><i data-lucide="check"></i> Use pelo menos 10 caracteres</li>
            <li><i data-lucide="check"></i> Não reutilize o código temporário</li>
            <li><i data-lucide="check"></i> Não compartilhe sua senha</li>
          </ul>
        </div>
        <form id="first-access-form" class="first-access-form">
          <div>
            <p class="eyebrow">Senha permanente</p>
            <h2>Concluir primeiro acesso</h2>
          </div>
          <label>Nova senha
            <span class="input-wrap"><i data-lucide="lock-keyhole"></i><input name="password" type="password" autocomplete="new-password" minlength="10" required></span>
          </label>
          <label>Confirmar nova senha
            <span class="input-wrap"><i data-lucide="shield-check"></i><input name="confirmation" type="password" autocomplete="new-password" minlength="10" required></span>
          </label>
          <p id="first-access-error" class="form-error" role="alert" hidden></p>
          <button class="primary-button" type="submit"><span>Salvar e acessar painel</span><i data-lucide="arrow-right"></i></button>
        </form>
      </section>
    </main>`,
  });
}

function metricCard({ id, label, icon, tone }) {
  return `<article class="metric-card ${tone}">
    <div class="metric-heading"><span class="metric-icon"><i data-lucide="${icon}"></i></span><span>${label}</span></div>
    <strong id="${id}-value" class="metric-value">--</strong>
    <span id="${id}-detail" class="metric-detail">Carregando dados</span>
  </article>`;
}

function dashboardPage() {
  return documentShell({
    title: "Painel | FarmaSync Portal Gestor",
    page: "dashboard",
    body: `<div class="app-shell">
      <aside class="sidebar">
        ${brand()}
        <nav aria-label="Navegação principal">
          <a class="nav-item active" href="/painel" aria-current="page"><i data-lucide="layout-dashboard"></i><span>Visão geral</span></a>
          <a class="nav-item" href="#historico-vendas"><i data-lucide="chart-no-axes-combined"></i><span>Vendas</span></a>
          <a class="nav-item" href="#campanhas"><i data-lucide="gift"></i><span>Campanhas</span></a>
          <a class="nav-item" href="#clube-digital"><i data-lucide="badge-percent"></i><span>Clube Digital</span></a>
          <a class="nav-item" href="#estoque"><i data-lucide="package-search"></i><span>Produtos</span></a>
          <a class="nav-item" href="#notas-entrada"><i data-lucide="file-input"></i><span>Entrada de notas</span></a>
          <a class="nav-item" href="#caixa"><i data-lucide="wallet-cards"></i><span>Caixa</span></a>
          <a class="nav-item" href="#entregas-fiado"><i data-lucide="bike"></i><span>Entregas e fiado</span></a>
          <a class="nav-item" href="#baixa-entregas"><i data-lucide="package-check"></i><span>Baixar entregas</span></a>
          <a class="nav-item" href="#acoes-suspeitas"><i data-lucide="shield-alert"></i><span>Ações suspeitas</span></a>
          <a class="nav-item" href="#saude-sincronismo"><i data-lucide="activity"></i><span>Sincronismo</span></a>
        </nav>
        <div class="sidebar-footer">
          <span>Conexão protegida<small class="portal-version">Portal ${PORTAL_VERSION}</small></span>
          <button id="logout-button" class="icon-button" type="button" title="Sair"><i data-lucide="log-out"></i></button>
        </div>
      </aside>
      <main class="dashboard-main">
        <header class="mobile-header">
          <button id="mobile-menu-button" class="icon-button" type="button" title="Ir para uma seção" aria-label="Ir para uma seção" aria-expanded="false" aria-controls="mobile-navigation"><i data-lucide="book-open"></i></button>
          ${brand()}
          <button id="mobile-logout-button" class="icon-button" type="button" title="Sair" aria-label="Sair"><i data-lucide="log-out"></i></button>
        </header>
        <nav id="mobile-navigation" class="mobile-navigation" aria-label="Ir para uma seção" hidden>
          <a class="nav-item active" href="/painel" aria-current="page"><i data-lucide="layout-dashboard"></i><span>Visão geral</span></a>
          <a class="nav-item" href="#historico-vendas"><i data-lucide="chart-no-axes-combined"></i><span>Vendas</span></a>
          <a class="nav-item" href="#campanhas"><i data-lucide="gift"></i><span>Campanhas</span></a>
          <a class="nav-item" href="#clube-digital"><i data-lucide="badge-percent"></i><span>Clube Digital</span></a>
          <a class="nav-item" href="#estoque"><i data-lucide="package-search"></i><span>Produtos</span></a>
          <a class="nav-item" href="#notas-entrada"><i data-lucide="file-input"></i><span>Entrada de notas</span></a>
          <a class="nav-item" href="#caixa"><i data-lucide="wallet-cards"></i><span>Caixa</span></a>
          <a class="nav-item" href="#entregas-fiado"><i data-lucide="bike"></i><span>Entregas e fiado</span></a>
          <a class="nav-item" href="#baixa-entregas"><i data-lucide="package-check"></i><span>Baixar entregas</span></a>
          <a class="nav-item" href="#acoes-suspeitas"><i data-lucide="shield-alert"></i><span>Ações suspeitas</span></a>
          <a class="nav-item" href="#saude-sincronismo"><i data-lucide="activity"></i><span>Sincronismo</span></a>
        </nav>
        <section class="dashboard-header">
          <div>
            <p class="eyebrow">Visão geral</p>
            <h1 id="pharmacy-name">Carregando farmácia</h1>
            <p class="muted">Resumo operacional de hoje · <span class="portal-version-inline">Portal ${PORTAL_VERSION}</span></p>
          </div>
          <div id="sync-status" class="sync-status loading"><span></span><strong>Sincronizando</strong></div>
        </section>
        <section id="dashboard-error" class="dashboard-error" hidden>
          <i data-lucide="cloud-off"></i><div><strong>Não foi possível carregar os dados.</strong><p>Tente novamente em alguns instantes.</p></div>
          <button id="retry-button" class="secondary-button" type="button">Tentar novamente</button>
        </section>
        <section class="metrics-grid" aria-label="Indicadores de hoje">
          ${metricCard({ id: "sales", label: "Vendas", icon: "shopping-bag", tone: "green" })}
          ${metricCard({ id: "ticket", label: "Ticket médio", icon: "receipt-text", tone: "blue" })}
          ${metricCard({ id: "exchanges", label: "Trocas", icon: "refresh-cw", tone: "orange" })}
          ${metricCard({ id: "returns", label: "Devoluções", icon: "undo-2", tone: "red" })}
        </section>
        <section id="historico-vendas" class="history-section" aria-labelledby="history-title">
          <div class="history-heading">
            <div><p class="eyebrow">Desempenho</p><h2 id="history-title">Resumo de vendas por período</h2></div>
            <form id="history-filter" class="history-filter">
              <div class="period-presets" role="group" aria-label="Períodos rápidos">
                <button type="button" data-history-period="today">Hoje</button>
                <button type="button" data-history-period="current-month">Mês atual</button>
                <button class="active" type="button" data-history-period="previous-month">Mês anterior</button>
              </div>
              <label>De<input id="history-start" name="start" type="date" required></label>
              <label>Até<input id="history-end" name="end" type="date" required></label>
              <button class="secondary-button history-submit" type="submit"><i data-lucide="filter"></i><span>Aplicar</span></button>
            </form>
          </div>
          <div id="history-error" class="history-message error" role="alert" hidden>Não foi possível carregar esse período.</div>
          <div id="history-loading" class="history-message">Carregando histórico...</div>
          <div id="history-content" hidden>
            <div class="history-totals">
              <article><span>Faturamento</span><strong id="period-sales-value">--</strong><small id="period-sales-detail">--</small></article>
              <article><span>Ticket médio</span><strong id="period-ticket-value">--</strong><small>no período selecionado</small></article>
              <article><span>Movimentações</span><strong id="period-movements-value">--</strong><small id="period-movements-detail">--</small></article>
            </div>
            <div class="history-list-heading"><strong>Evolução diária</strong><span>Faturamento e vendas concluídas</span></div>
            <div id="history-list" class="history-list" role="table" aria-label="Vendas por dia"></div>
          </div>
        </section>
        <section id="campanhas" class="campaigns-section" aria-labelledby="campaigns-title">
          <div class="section-heading"><p class="eyebrow">Relacionamento</p><h2 id="campaigns-title">Campanhas e sorteios</h2><p class="muted">Participações e prêmios registrados pelo FarmaSync</p></div>
          <div id="campaigns-error" class="history-message error" role="alert" hidden>Não foi possível carregar as campanhas.</div>
          <div id="campaigns-loading" class="history-message">Carregando campanhas...</div>
          <div id="campaigns-content" hidden>
            <div class="campaign-totals">
              <div><span>Ativas</span><strong id="campaign-active-value">--</strong></div>
              <div><span>Participações</span><strong id="campaign-participations-value">--</strong></div>
              <div><span>Ganhadores</span><strong id="campaign-winners-value">--</strong></div>
              <div class="pending"><span>Prêmios pendentes</span><strong id="campaign-pending-value">--</strong></div>
            </div>
            <div class="campaign-layout">
              <div>
                <div class="history-list-heading"><strong>Campanhas cadastradas</strong><span>Configuração e desempenho</span></div>
                <div id="campaign-list" class="campaign-list scroll-area" tabindex="0" role="region" aria-label="Campanhas"></div>
              </div>
              <div>
                <div class="history-list-heading"><strong>Ganhadores recentes</strong><span>Código exibido parcialmente</span></div>
                <div id="winner-list" class="winner-list scroll-area" tabindex="0" role="region" aria-label="Ganhadores"></div>
              </div>
            </div>
          </div>
        </section>
        <section id="clube-digital" class="club-section" aria-labelledby="club-title">
          <div class="club-heading">
            <div><p class="eyebrow">Fidelidade</p><h2 id="club-title">Clube Digital</h2><p class="muted">Membros, pontos e benefícios da sua farmácia</p></div>
            <a id="club-public-link" class="secondary-button" href="#" target="_blank" rel="noopener"><i data-lucide="external-link"></i><span>Abrir clube</span></a>
          </div>
          <div id="club-error" class="history-message error" role="alert" hidden>Não foi possível carregar o Clube Digital.</div>
          <div id="club-loading" class="history-message">Carregando Clube Digital...</div>
          <div id="club-content" hidden>
            <div class="club-metrics">
              <div><span>Membros ativos</span><strong id="club-members-value">--</strong><small id="club-marketing-value">--</small></div>
              <div><span>Pontos em circulação</span><strong id="club-points-value">--</strong><small id="club-expiring-value">saldo dos membros ativos</small></div>
              <div><span>Cupons ativos</span><strong id="club-coupons-value">--</strong><small id="club-activations-value">--</small></div>
              <div><span>Resgates concluídos</span><strong id="club-redemptions-value">--</strong><small>benefícios utilizados</small></div>
              <div><span>Níveis de fidelidade</span><strong id="club-tier-gold-value">--</strong><small id="club-tier-detail-value">Ouro entre os membros ativos</small></div>
              <div><span>Indicações</span><strong id="club-referrals-value">--</strong><small>membros que entraram indicados</small></div>
              <div><span>Cashback</span><strong id="club-cashback-value">--</strong><small id="club-cashback-detail-value">gerado no total</small></div>
            </div>
            <section class="club-referrals-panel" aria-labelledby="club-referrals-title">
              <div class="club-risk-heading">
                <div><p class="eyebrow">Indique e ganhe</p><h3 id="club-referrals-title">Histórico de indicações</h3></div>
                <span id="club-referrals-count">-- indicações</span>
              </div>
              <div class="club-referrals-labels" aria-hidden="true"><span>Quem indicou</span><span>Quem foi indicado</span><span>Resultado</span></div>
              <div id="club-referrals-list" class="club-referrals-list"></div>
              <p id="club-referrals-empty" class="history-message" hidden>Nenhuma indicação registrada.</p>
            </section>
            <section class="club-cashback-panel" aria-labelledby="club-cashback-title">
              <div class="club-risk-heading">
                <div><p class="eyebrow">Controle financeiro</p><h3 id="club-cashback-title">Monitoramento de cashback</h3></div>
                <span id="club-cashback-count">-- recentes</span>
              </div>
              <div class="club-cashback-summary">
                <div><span>Gerados</span><strong id="club-cashback-issued">--</strong></div>
                <div><span>Em aberto</span><strong id="club-cashback-open">--</strong></div>
                <div><span>Usados</span><strong id="club-cashback-redeemed">--</strong></div>
                <div><span>Cancelados</span><strong id="club-cashback-canceled">--</strong></div>
              </div>
              <div id="club-cashback-list" class="club-cashback-list"></div>
              <p id="club-cashback-empty" class="history-message" hidden>Nenhum cashback registrado.</p>
            </section>
            <section class="club-risk-panel" aria-labelledby="club-risk-title">
              <div class="club-risk-heading">
                <div><p class="eyebrow">Auditoria preventiva</p><h3 id="club-risk-title">Monitoramento de pontos</h3></div>
                <span id="club-risk-period">Últimos 30 dias</span>
              </div>
              <div class="club-risk-summary">
                <div><span>Vendas monitoradas</span><strong id="club-risk-sales">0</strong></div>
                <div><span>Alertas para revisão</span><strong id="club-risk-alerts">0</strong></div>
                <div><span>Estornos confirmados</span><strong id="club-risk-reversals">0</strong></div>
              </div>
              <div id="club-risk-list" class="club-risk-list"></div>
              <p id="club-risk-empty" class="history-message" hidden>Nenhum padrão suspeito encontrado no período.</p>
            </section>
            <dialog id="club-risk-dialog" class="club-risk-dialog">
              <div class="club-risk-dialog-heading">
                <div><p class="eyebrow">Investigação do alerta</p><h3 id="club-risk-dialog-title">Detalhes do monitoramento</h3><span id="club-risk-dialog-detail"></span></div>
                <button id="club-risk-dialog-close" class="icon-button" type="button" title="Fechar" aria-label="Fechar"><i data-lucide="x"></i></button>
              </div>
              <div class="club-risk-dialog-summary">
                <div><span>Membro</span><strong id="club-risk-dialog-member">--</strong></div>
                <div><span>Operador</span><strong id="club-risk-dialog-operator">--</strong></div>
                <div><span>Última ocorrência</span><strong id="club-risk-dialog-date">--</strong></div>
              </div>
              <div class="history-list-heading"><strong>Vendas relacionadas</strong><span id="club-risk-dialog-count">--</span></div>
              <div id="club-risk-dialog-sales" class="club-risk-dialog-sales"></div>
              <div class="club-risk-dialog-actions">
                <button id="club-risk-dialog-member-action" class="secondary-button" type="button"><i data-lucide="settings-2"></i><span>Administrar membro</span></button>
                <button id="club-risk-dialog-done" class="primary-button" type="button">Fechar</button>
              </div>
            </dialog>
            <form id="club-validity-form" class="club-validity-panel">
              <div><strong>Validade dos novos pontos</strong><span>Aplica-se somente aos próximos créditos. Pontos já existentes permanecem sem validade.</span></div>
              <label>Prazo
                <select id="club-validity-months" required>
                  <option value="6">6 meses</option><option value="12">12 meses</option>
                  <option value="18">18 meses</option><option value="24">24 meses</option>
                  <option value="none">Sem validade</option>
                </select>
              </label>
              <button class="secondary-button" type="submit"><i data-lucide="save"></i><span>Salvar regra</span></button>
              <span id="club-validity-status" class="club-validity-status" aria-live="polite"></span>
            </form>
            <form id="club-tiers-form" class="club-validity-panel">
              <div><strong>Níveis de fidelidade</strong><span>Gasto acumulado nos últimos 12 meses para promover o membro de nível.</span></div>
              <div class="club-tiers-inputs">
                <label>Prata a partir de<input id="club-tier-silver" type="number" min="0" step="0.01" required></label>
                <label>Ouro a partir de<input id="club-tier-gold" type="number" min="0" step="0.01" required></label>
              </div>
              <button class="secondary-button" type="submit"><i data-lucide="save"></i><span>Salvar níveis</span></button>
              <span id="club-tiers-status" class="club-validity-status" aria-live="polite"></span>
            </form>
            <form id="club-referral-form" class="club-validity-panel">
              <div><strong>Indicação (indique e ganhe)</strong><span>Pontos que o indicador e o novo membro ganham quando o indicado faz a primeira compra.</span></div>
              <label>Bônus por indicação
                <input id="club-referral-points" type="number" min="0" step="1" required>
              </label>
              <button class="secondary-button" type="submit"><i data-lucide="save"></i><span>Salvar bônus</span></button>
              <span id="club-referral-status" class="club-validity-status" aria-live="polite"></span>
            </form>
            <form id="club-cashback-form" class="club-validity-panel">
              <div><strong>Cashback</strong><span>Quantos pontos equivalem a R$ 1,00 de desconto que o membro pode gerar e usar no caixa.</span></div>
              <label>Pontos por R$ 1,00
                <input id="club-cashback-rate" type="number" min="1" step="1" required>
              </label>
              <button class="secondary-button" type="submit"><i data-lucide="save"></i><span>Salvar taxa</span></button>
              <span id="club-cashback-status" class="club-validity-status" aria-live="polite"></span>
            </form>
            <form id="club-birthday-form" class="club-validity-panel">
              <div><strong>Presente de aniversário</strong><span>Crédito anual automático. A antecedência evita cadastros feitos apenas para receber pontos no mesmo dia.</span></div>
              <div class="club-tiers-inputs">
                <label class="club-toggle-label"><input id="club-birthday-enabled" type="checkbox"> Campanha ativa</label>
                <label>Pontos de presente<input id="club-birthday-points" type="number" min="1" max="100000" step="1" required></label>
                <label>Antecedência mínima<input id="club-birthday-lead-days" type="number" min="0" max="365" step="1" required></label>
              </div>
              <button class="secondary-button" type="submit"><i data-lucide="save"></i><span>Salvar campanha</span></button>
              <span id="club-birthday-status" class="club-validity-status" aria-live="polite"></span>
            </form>
            <section class="club-share-panel" aria-labelledby="club-share-title">
              <span class="club-share-icon"><i data-lucide="send"></i></span>
              <div class="club-share-content">
                <div><strong id="club-share-title">Divulgar o clube</strong><span>Envie o convite aos clientes da farmácia</span></div>
                <input id="club-share-url" type="text" readonly aria-label="Endereço público do Clube Digital">
              </div>
              <div class="club-share-actions">
                <button id="club-copy-link" class="secondary-button" type="button"><i data-lucide="link"></i><span>Copiar link</span></button>
                <button id="club-copy-invite" class="secondary-button" type="button"><i data-lucide="copy"></i><span>Copiar convite</span></button>
                <a id="club-whatsapp-share" class="primary-button" href="#" target="_blank" rel="noopener"><i data-lucide="message-circle"></i><span>WhatsApp</span></a>
              </div>
            </section>
            <div class="club-layout">
              <div class="club-coupons-panel">
                <div class="history-list-heading"><strong>Cupons e benefícios</strong><span id="club-coupon-count">Carregando cupons</span></div>
                <form id="club-coupon-form" class="club-coupon-form">
                  <input id="club-coupon-id" type="hidden">
                  <label>Título<input id="club-coupon-title" maxlength="120" required placeholder="R$ 10 de desconto"></label>
                  <label>Código<input id="club-coupon-code" maxlength="30" pattern="[A-Za-z0-9_-]{3,30}" required placeholder="DESCONTO10"></label>
                  <label>Pontos<input id="club-coupon-points" type="number" min="0" max="1000000" step="1" required value="0"></label>
                  <label>Validade<input id="club-coupon-expiry" type="datetime-local" required></label>
                  <label class="club-description">Descrição<textarea id="club-coupon-description" maxlength="240" required placeholder="Condições do benefício"></textarea></label>
                  <div id="club-coupon-error" class="form-error" role="alert" hidden></div>
                  <div class="club-form-actions">
                    <button id="club-coupon-cancel" class="secondary-button" type="button" hidden>Cancelar</button>
                    <button class="primary-button" type="submit"><i data-lucide="plus"></i><span>Adicionar cupom</span></button>
                  </div>
                </form>
                <div id="club-coupon-list" class="club-coupon-list"></div>
                <p id="club-coupon-empty" class="history-message" hidden>Nenhum cupom cadastrado.</p>
              </div>
              <aside class="club-members-panel">
                <div class="history-list-heading"><strong>Todos os membros</strong><span id="club-member-count">Carregando membros</span></div>
                <label class="club-member-search"><i data-lucide="search"></i><input id="club-member-search" type="search" placeholder="Buscar nome ou final do telefone" autocomplete="off" aria-label="Buscar membro por nome ou final do telefone"></label>
                <div id="club-member-list" class="club-member-list"></div>
                <p id="club-member-empty" class="history-message" hidden>Nenhum membro cadastrado.</p>
              </aside>
            </div>
            <dialog id="club-member-dialog" class="club-member-dialog">
              <form id="club-member-form" method="dialog">
                <div class="club-member-dialog-heading">
                  <div><p class="eyebrow">Gestão do Clube</p><h3 id="club-member-dialog-title">Administrar membro</h3><span id="club-member-dialog-detail"></span></div>
                  <button id="club-member-dialog-close" class="icon-button" type="button" title="Fechar" aria-label="Fechar"><i data-lucide="x"></i></button>
                </div>
                <input id="club-member-id" type="hidden">
                <label>Ação<select id="club-member-action" required></select></label>
                <label id="club-member-phone-field">Novo telefone<input id="club-member-phone" type="tel" inputmode="numeric" autocomplete="off" placeholder="(21) 99999-9999"></label>
                <label id="club-member-points-field" hidden>Pontos<input id="club-member-points" type="number" min="-1000000" max="1000000" step="1" placeholder="Ex.: 20 ou -10"></label>
                <label id="club-member-cashback-field" hidden>Valor do cashback (R$)<input id="club-member-cashback" type="number" min="0.01" max="100000" step="0.01" placeholder="Ex.: 10,00"></label>
                <label id="club-member-birth-date-field" hidden>Data de nascimento<input id="club-member-birth-date" type="date"></label>
                <label>Motivo<textarea id="club-member-reason" minlength="3" maxlength="240" required placeholder="Informe por que esta alteração é necessária"></textarea></label>
                <label id="club-member-merge-field" class="club-member-merge" hidden><input id="club-member-merge" type="checkbox"> Mesclar com a conta que já usa este telefone</label>
                <div id="club-member-form-error" class="form-error" role="alert" hidden></div>
                <div class="club-member-dialog-actions">
                  <button id="club-member-cancel" class="secondary-button" type="button">Cancelar</button>
                  <button class="primary-button" type="submit"><i data-lucide="check"></i><span>Confirmar</span></button>
                </div>
              </form>
            </dialog>
            <dialog id="club-cashback-cancel-dialog" class="club-member-dialog">
              <form id="club-cashback-cancel-form" method="dialog">
                <div class="club-member-dialog-heading">
                  <div><p class="eyebrow">Controle financeiro</p><h3>Cancelar cashback</h3><span id="club-cashback-cancel-detail"></span></div>
                  <button id="club-cashback-cancel-close" class="icon-button" type="button" title="Fechar" aria-label="Fechar"><i data-lucide="x"></i></button>
                </div>
                <input id="club-cashback-cancel-id" type="hidden"><input id="club-cashback-cancel-member-id" type="hidden">
                <label>Motivo<textarea id="club-cashback-cancel-reason" minlength="3" maxlength="240" required placeholder="Informe por que este cashback deve ser cancelado"></textarea></label>
                <div id="club-cashback-cancel-error" class="form-error" role="alert" hidden></div>
                <div class="club-member-dialog-actions"><button id="club-cashback-cancel-dismiss" class="secondary-button" type="button">Voltar</button><button class="primary-button" type="submit"><i data-lucide="ban"></i><span>Cancelar cashback</span></button></div>
              </form>
            </dialog>
          </div>
        </section>
        <section id="estoque" class="inventory-section" aria-labelledby="inventory-title">
          <div class="inventory-heading">
            <div><p class="eyebrow">Operação</p><h2 id="inventory-title">Produtos e estoque</h2><p class="muted">Consulte e atualize o cadastro usado no balcão</p></div>
            <div class="inventory-tools">
              <span class="inventory-search"><i data-lucide="search"></i><input id="inventory-search" type="search" placeholder="Buscar produto ou código" aria-label="Buscar produto ou código"></span>
              <div class="inventory-filters" role="group" aria-label="Filtrar alertas de estoque">
                <button type="button" data-inventory-filter="all">Todos</button>
                <button class="active" type="button" data-inventory-filter="expiry">Validade</button>
                <button type="button" data-inventory-filter="stock">Estoque</button>
              </div>
            </div>
          </div>
          <div id="inventory-error" class="history-message error" role="alert" hidden>Não foi possível carregar o estoque.</div>
          <div id="inventory-loading" class="history-message">Carregando estoque...</div>
          <div id="inventory-content" hidden>
            <div class="inventory-totals">
              <div><span>Produtos ativos</span><strong id="inventory-products-value">--</strong></div>
              <div><span>Unidades</span><strong id="inventory-units-value">--</strong></div>
              <div class="featured"><span>Estoque a custo</span><strong id="inventory-cost-value">--</strong></div>
              <div class="danger"><span>Sem estoque</span><strong id="inventory-out-value">--</strong></div>
              <div class="warning"><span>Estoque baixo</span><strong id="inventory-low-value">--</strong></div>
              <div class="danger"><span>Vencidos</span><strong id="inventory-expired-value">--</strong></div>
              <div class="warning"><span>Vencem em 60 dias</span><strong id="inventory-expiring-value">--</strong></div>
            </div>
            <section class="product-manager" aria-labelledby="product-manager-title">
              <div class="product-manager-heading">
                <div><p class="eyebrow">Cadastro remoto</p><h3 id="product-manager-title">Catálogo do balcão</h3><p class="muted">Consulte preços, promoções e estoque e altere aqui: o FarmaSync aplica no balcão em poucos segundos.</p></div>
                <span class="product-search"><i data-lucide="search"></i><input id="product-search" type="search" placeholder="Buscar nome ou código" aria-label="Buscar produtos do balcão" maxlength="100" autocomplete="off"></span>
              </div>
              <div class="product-filters" role="group" aria-label="Filtrar produtos do catálogo">
                <button type="button" class="active" data-product-filter="all" aria-pressed="true">Todos <b id="product-filter-all">0</b></button>
                <button type="button" data-product-filter="promo" aria-pressed="false"><i data-lucide="badge-percent"></i>Em promoção <b id="product-filter-promo">0</b></button>
                <button type="button" data-product-filter="lowstock" aria-pressed="false">Estoque baixo <b id="product-filter-lowstock">0</b></button>
                <button type="button" data-product-filter="nostock" aria-pressed="false">Sem estoque <b id="product-filter-nostock">0</b></button>
                <button type="button" data-product-filter="expiry" aria-pressed="false">Vencendo <b id="product-filter-expiry">0</b></button>
              </div>
              <div id="product-manager-error" class="history-message error" role="alert" hidden>Não foi possível carregar os produtos.</div>
              <div id="product-manager-loading" class="history-message">Carregando catálogo...</div>
              <p id="product-count" class="window-count" aria-live="polite" hidden></p>
              <div id="product-list" class="product-list scroll-window" tabindex="0" role="region" aria-label="Lista de produtos do balcão" hidden></div>
              <p id="product-manager-empty" class="history-message" hidden>Nenhum produto encontrado.</p>
            </section>
            <div class="inventory-list-heading"><strong>Produtos em atenção</strong><span id="inventory-missing-expiry">-- sem validade cadastrada</span></div>
            <div id="inventory-list" class="inventory-list scroll-window" tabindex="0" role="region" aria-label="Produtos em atenção"></div>
            <p id="inventory-empty" class="history-message" hidden>Nenhum produto encontrado neste filtro.</p>
          </div>
          <dialog id="product-edit-dialog" class="product-edit-dialog">
            <form id="product-edit-form" method="dialog" novalidate>
              <div class="product-edit-heading">
                <div><p class="eyebrow">Atualização remota</p><h3>Editar produto</h3><span id="product-edit-code"></span></div>
                <button id="product-edit-close" class="icon-button" type="button" title="Fechar" aria-label="Fechar"><i data-lucide="x"></i></button>
              </div>
              <input id="product-edit-id" type="hidden">
              <div id="product-edit-info" class="product-edit-info" hidden></div>
              <label>Nome do produto<input id="product-edit-name" maxlength="255" autocomplete="off"><span id="product-edit-name-error" class="field-error" role="alert" hidden></span></label>
              <div class="product-edit-grid">
                <label>Preço de venda (R$)<input id="product-edit-price" type="number" min="0.01" max="999999999.99" step="0.01" inputmode="decimal"><span id="product-edit-price-error" class="field-error" role="alert" hidden></span></label>
                <label>Estoque<input id="product-edit-stock" type="number" min="-1000000" max="1000000" step="1" inputmode="numeric"><span id="product-edit-stock-error" class="field-error" role="alert" hidden></span></label>
              </div>
              <fieldset class="product-promo-fields" id="product-edit-promo">
                <legend><i data-lucide="badge-percent"></i>Promoção</legend>
                <p class="product-promo-help">Deixe os campos vazios para o produto ficar sem promoção. O balcão usa o preço promocional no lugar do preço de venda.</p>
                <label>Preço promocional (R$)<input id="product-edit-promo-price" type="number" min="0.01" max="999999999.99" step="0.01" inputmode="decimal" placeholder="Ex.: 7,99"><span id="product-edit-promo-price-error" class="field-error" role="alert" hidden></span></label>
                <div class="product-promo-pack">
                  <label>Leve (unidades)<input id="product-edit-promo-qty" type="number" min="2" max="999" step="1" inputmode="numeric" placeholder="Ex.: 3"><span id="product-edit-promo-qty-error" class="field-error" role="alert" hidden></span></label>
                  <label>por (R$)<input id="product-edit-promo-package" type="number" min="0.01" max="999999999.99" step="0.01" inputmode="decimal" placeholder="Ex.: 15,00"><span id="product-edit-promo-package-error" class="field-error" role="alert" hidden></span></label>
                </div>
                <p id="product-edit-promo-preview" class="product-promo-preview" aria-live="polite"></p>
                <button id="product-edit-promo-clear" class="secondary-button compact" type="button"><i data-lucide="x"></i><span>Encerrar promoção</span></button>
              </fieldset>
              <div id="product-edit-notice" class="product-edit-notice"><i data-lucide="refresh-cw"></i><span>Após salvar, o balcão confirma a alteração automaticamente. O portal mostrará o andamento.</span></div>
              <div id="product-edit-error" class="form-error" role="alert" hidden></div>
              <div class="product-edit-actions">
                <button id="product-edit-cancel" class="secondary-button" type="button">Cancelar</button>
                <button class="primary-button" type="submit"><i data-lucide="cloud-upload"></i><span>Salvar no balcão</span></button>
              </div>
            </form>
          </dialog>
        </section>
        <section id="notas-entrada" class="notes-section" aria-labelledby="notes-title">
          <div class="notes-heading">
            <div><p class="eyebrow">Compras</p><h2 id="notes-title">Entrada de notas</h2><p class="muted">Dê entrada nas notas de compra de qualquer lugar: o FarmaSync lança no balcão em poucos segundos.</p></div>
            <div class="notes-actions">
              <button id="note-start-xml" class="primary-button" type="button"><i data-lucide="file-up"></i><span>Importar XML</span></button>
              <button id="note-start-manual" class="secondary-button" type="button"><i data-lucide="keyboard"></i><span>Digitar nota de papel</span></button>
            </div>
          </div>
          <div id="notes-error" class="history-message error" role="alert" hidden>Não foi possível carregar as notas.</div>
          <div id="notes-loading" class="history-message">Carregando notas...</div>
          <div id="notes-list" class="notes-list scroll-area scroll-area-cards" tabindex="0" role="region" aria-label="Notas de compra enviadas" hidden></div>
          <p id="notes-empty" class="history-message" hidden>Nenhuma nota lançada pelo portal ainda. Use "Importar XML" ou "Digitar nota de papel".</p>
          <dialog id="note-dialog" class="note-dialog" aria-labelledby="note-dialog-title">
            <div class="note-dialog-shell">
              <header class="note-dialog-header">
                <div><p id="note-dialog-eyebrow" class="eyebrow">Entrada de nota</p><h3 id="note-dialog-title">Nova nota</h3></div>
                <button id="note-dialog-close" class="icon-button" type="button" title="Fechar" aria-label="Fechar"><i data-lucide="x"></i></button>
              </header>
              <div id="note-dialog-body" class="note-dialog-body"></div>
              <footer id="note-dialog-footer" class="note-dialog-footer"></footer>
            </div>
          </dialog>
        </section>
        <section id="caixa" class="cash-section" aria-labelledby="cash-title">
          <div class="cash-heading">
            <div><p class="eyebrow">Financeiro</p><h2 id="cash-title">Caixa e pagamentos</h2><p class="muted">Posição consolidada da operação de hoje</p></div>
            <span id="cash-session-status" class="cash-session-status loading"><i data-lucide="loader-circle"></i><strong>Carregando</strong></span>
          </div>
          <div id="cash-error" class="history-message error" role="alert" hidden>Não foi possível carregar o caixa.</div>
          <div id="cash-loading" class="history-message">Carregando caixa...</div>
          <div id="cash-content" hidden>
            <div class="cash-totals">
              <article><span>Pagamentos hoje</span><strong id="cash-payments-value">--</strong><small>total líquido recebido</small></article>
              <article class="featured"><span>Saldo esperado aberto</span><strong id="cash-expected-value">--</strong><small id="cash-opening-detail">--</small></article>
              <article class="outflow"><span>Retiradas</span><strong id="cash-withdrawals-value">--</strong><small>nos caixas abertos</small></article>
              <article class="inflow"><span>Suprimentos</span><strong id="cash-supplies-value">--</strong><small>nos caixas abertos</small></article>
            </div>
            <div class="cash-layout">
              <div>
                <div class="history-list-heading"><strong>Formas de pagamento</strong><span>Participação no total de hoje</span></div>
                <div id="cash-payment-list" class="cash-payment-list"></div>
                <p id="cash-payment-empty" class="history-message" hidden>Nenhum pagamento registrado hoje.</p>
                <div class="history-list-heading cash-sessions-heading"><strong>Aberturas e fechamentos</strong><span>Caixas movimentados hoje</span></div>
                <div id="cash-session-list" class="cash-session-list scroll-area" tabindex="0" role="region" aria-label="Aberturas e fechamentos de caixa"></div>
                <p id="cash-session-empty" class="history-message" hidden>Nenhuma sessão de caixa hoje.</p>
              </div>
              <aside class="cash-session-panel" aria-label="Situação dos caixas">
                <span class="cash-panel-icon"><i data-lucide="landmark"></i></span>
                <p>Sessões de caixa</p>
                <strong id="cash-open-sessions">--</strong>
                <span id="cash-closed-sessions">--</span>
                <small>O saldo esperado considera apenas caixas ainda abertos.</small>
              </aside>
            </div>
          </div>
        </section>
        <section id="entregas-fiado" class="delivery-credit-section" aria-labelledby="delivery-credit-title">
          <div class="delivery-credit-heading">
            <div><p class="eyebrow">Pendências</p><h2 id="delivery-credit-title">Entregas e fiado</h2><p class="muted">Acompanhamento consolidado da operação</p></div>
            <span class="privacy-note"><i data-lucide="shield-check"></i> Sem dados pessoais</span>
          </div>
          <div id="delivery-credit-error" class="history-message error" role="alert" hidden>Não foi possível carregar entregas e fiado.</div>
          <div id="delivery-credit-loading" class="history-message">Carregando entregas e fiado...</div>
          <div id="delivery-credit-content" class="delivery-credit-layout" hidden>
            <article class="delivery-panel">
              <div class="delivery-panel-heading"><span><i data-lucide="bike"></i></span><div><strong>Entregas</strong><small>Prestação de contas</small></div></div>
              <div class="panel-period-filter">
                <span id="delivery-reference">Hoje</span>
                <div class="period-presets" role="group" aria-label="Período das entregas">
                  <button class="active" type="button" data-delivery-period="today">Hoje</button>
                  <button type="button" data-delivery-period="current-month">Mês atual</button>
                  <button type="button" data-delivery-period="previous-month">Mês anterior</button>
                </div>
              </div>
              <div class="delivery-primary"><strong id="delivery-pending-value">--</strong><span>pendentes</span><small id="delivery-pending-amount">--</small></div>
              <div class="delivery-stats">
                <div class="urgent"><span>Urgentes</span><strong id="delivery-urgent-value">--</strong><small>há 45 min ou mais</small></div>
                <div><span>Maior espera</span><strong id="delivery-wait-value">--</strong><small>entre as pendentes</small></div>
                <div><span>Baixadas no período</span><strong id="delivery-completed-value">--</strong><small id="delivery-completed-amount">--</small></div>
                <div><span>Tempo médio</span><strong id="delivery-average-value">--</strong><small>das baixadas no período</small></div>
              </div>
            </article>
            <article class="credit-panel">
              <div class="delivery-panel-heading"><span><i data-lucide="hand-coins"></i></span><div><strong>Fiado</strong><small>Crédito da loja</small></div></div>
              <div class="panel-period-filter">
                <span id="credit-reference">Hoje</span>
                <div class="period-presets" role="group" aria-label="Período do fiado">
                  <button class="active" type="button" data-credit-period="today">Hoje</button>
                  <button type="button" data-credit-period="current-month">Mês atual</button>
                  <button type="button" data-credit-period="previous-month">Mês anterior</button>
                </div>
              </div>
              <div class="credit-primary"><span>Pendente no período</span><strong id="credit-pending-amount">--</strong><small id="credit-pending-count">--</small></div>
              <div class="credit-settled">
                <div><span>Recebido no período</span><strong id="credit-paid-amount">--</strong><small id="credit-paid-count">--</small></div>
                <div><span>Registro mais antigo</span><strong id="credit-oldest-value">--</strong><small>Não representa vencimento</small></div>
              </div>
            </article>
          </div>
        </section>
        <section id="baixa-entregas" class="delivery-settle-section" aria-labelledby="delivery-settle-title">
          <div class="notes-heading">
            <div><p class="eyebrow">Operação</p><h2 id="delivery-settle-title">Baixar entregas</h2><p class="muted">Dê baixa nas entregas de qualquer lugar. O balcão baixa em segundos e o aplicativo, o controle de entregas e o painel da farmácia ficam em dia.</p></div>
            <div class="notes-actions">
              <button id="delivery-refresh" class="secondary-button" type="button"><i data-lucide="refresh-cw"></i><span>Atualizar</span></button>
              <button id="delivery-settle-selected" class="primary-button" type="button" disabled><i data-lucide="package-check"></i><span>Baixar selecionadas</span></button>
            </div>
          </div>
          <div id="delivery-sync-note" class="delivery-sync-note" role="status" hidden></div>
          <div id="delivery-flash-holder"></div>
          <div id="delivery-settle-error" class="history-message error" role="alert" hidden>Não foi possível carregar as entregas pendentes.</div>
          <div id="delivery-settle-loading" class="history-message">Carregando entregas pendentes...</div>
          <div id="delivery-settle-toolbar" class="delivery-toolbar" hidden>
            <label class="note-check"><input id="delivery-select-all" type="checkbox"><span>Selecionar todas</span></label>
            <span id="delivery-settle-count" class="muted"></span>
          </div>
          <div id="delivery-settle-list" class="delivery-settle-list scroll-area scroll-area-cards" tabindex="0" role="region" aria-label="Entregas pendentes" hidden></div>
          <p id="delivery-settle-empty" class="history-message" hidden>Nenhuma entrega pendente. Tudo em dia!</p>
          <dialog id="delivery-dialog" class="note-dialog delivery-dialog" aria-labelledby="delivery-dialog-title">
            <div class="note-dialog-shell">
              <header class="note-dialog-header">
                <div><p class="eyebrow">Baixa de entregas</p><h3 id="delivery-dialog-title">Confirmar baixa</h3></div>
                <button id="delivery-dialog-close" class="icon-button" type="button" title="Fechar" aria-label="Fechar"><i data-lucide="x"></i></button>
              </header>
              <div id="delivery-dialog-body" class="note-dialog-body"></div>
              <footer id="delivery-dialog-footer" class="note-dialog-footer"></footer>
            </div>
          </dialog>
        </section>
        <section id="acoes-suspeitas" class="suspicious-actions-section" aria-labelledby="suspicious-actions-title">
          <div class="suspicious-actions-heading">
            <div><p class="eyebrow">Auditoria preventiva</p><h2 id="suspicious-actions-title">Ações suspeitas</h2><p id="suspicious-actions-reference" class="muted">Sinais operacionais que merecem revisão</p></div>
            <div class="period-presets" role="group" aria-label="Período de ações suspeitas">
              <button class="active" type="button" data-suspicious-period="today">Hoje</button>
              <button type="button" data-suspicious-period="current-month">Mês atual</button>
              <button type="button" data-suspicious-period="previous-month">Mês anterior</button>
            </div>
          </div>
          <div id="suspicious-actions-error" class="history-message error" role="alert" hidden>Não foi possível carregar as ações suspeitas.</div>
          <div id="suspicious-actions-loading" class="history-message">Carregando ações suspeitas...</div>
          <div id="suspicious-actions-content" class="suspicious-actions-layout" hidden>
            <aside class="suspicious-summary" aria-label="Resumo de ações suspeitas">
              <span class="suspicious-summary-icon"><i data-lucide="shield-alert"></i></span>
              <div><span>Eventos no período</span><strong id="suspicious-actions-total">--</strong><small id="suspicious-actions-last">--</small></div>
              <p>São sinais para conferência administrativa, não uma conclusão de irregularidade.</p>
            </aside>
            <div>
              <div class="history-list-heading"><strong>Ocorrências por categoria</strong><span>Somente contagens, sem operador ou detalhes da venda</span></div>
              <div id="suspicious-actions-list" class="suspicious-actions-list"></div>
              <p id="suspicious-actions-empty" class="history-message" hidden>Nenhuma ocorrência neste período.</p>
              <div class="suspicious-occurrences-heading"><strong>Ocorrências recentes</strong><span>Abra uma ocorrência para conferir o contexto operacional</span></div>
              <div id="suspicious-occurrences-list" class="suspicious-occurrences-list scroll-area" tabindex="0" role="region" aria-label="Ocorrências recentes"></div>
              <p id="suspicious-occurrences-empty" class="history-message" hidden>Nenhum detalhe disponível neste período.</p>
            </div>
          </div>
        </section>
        <section id="saude-sincronismo" class="sync-health-section" aria-labelledby="sync-health-title">
          <div class="sync-health-heading">
            <div><p class="eyebrow">Conectividade</p><h2 id="sync-health-title">Saúde do sincronismo</h2><p class="muted">Último pacote operacional recebido pelo portal</p></div>
            <button id="sync-health-refresh" class="icon-button" type="button" title="Atualizar agora" aria-label="Atualizar saúde do sincronismo"><i data-lucide="refresh-cw"></i></button>
          </div>
          <div id="sync-health-error" class="history-message error" role="alert" hidden>Não foi possível consultar o sincronismo.</div>
          <div id="sync-health-loading" class="history-message">Verificando sincronismo...</div>
          <div id="sync-health-content" hidden>
            <div id="sync-health-overview" class="sync-health-overview">
              <span class="sync-health-icon"><i data-lucide="activity"></i></span>
              <div><strong id="sync-health-status">--</strong><span id="sync-health-detail">--</span></div>
              <div class="sync-health-time"><span>Último envio concluído</span><strong id="sync-health-last">--</strong><small id="sync-health-age">--</small></div>
            </div>
            <div class="history-list-heading"><strong>Módulos monitorados</strong><span>Atualização em um único pacote protegido</span></div>
            <div id="sync-health-modules" class="sync-health-modules"></div>
          </div>
        </section>
        <section class="operations-section">
          <div class="section-heading"><div><p class="eyebrow">Atenção operacional</p><h2>Movimentações que merecem acompanhamento</h2></div></div>
          <div class="operation-row">
            <span class="operation-icon"><i data-lucide="circle-x"></i></span>
            <div><strong>Cancelamentos</strong><span id="cancellations-detail">--</span></div>
            <strong id="cancellations-value">--</strong>
          </div>
        </section>
      </main>
    </div>`,
  });
}

module.exports = {
  dashboardPage,
  firstAccessPage,
  forgotPasswordPage,
  loginPage,
  resetPasswordPage,
  webManifest,
};