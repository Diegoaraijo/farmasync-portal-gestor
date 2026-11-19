const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { ipKeyGenerator, rateLimit } = require("express-rate-limit");

const {
  buildCampaignOverview,
  buildCashOverview,
  buildDashboardSummary,
  buildDeliveryCreditOverview,
  buildInventoryOverview,
  buildSalesHistory,
  buildSyncHealth,
  buildSuspiciousActionsOverview,
} = require("./dashboard");
const {
  dashboardPage,
  firstAccessPage,
  forgotPasswordPage,
  loginPage,
  resetPasswordPage,
  webManifest,
} = require("./pages");
const { hashPassword, verifyPassword } = require("./security");
const { PRODUCT_FILTER_KEYS, parseProductUpdate, serializeProduct } = require("./products");
const { buildPendingDeliveries, parseSettleRequest } = require("./deliveries");
const {
  CATEGORIES,
  CONTINUOUS_USE,
  CONTROLLED_TYPES,
  buildPurchaseNote,
  parseNfeXml,
  previewNote,
  serializePurchaseNote,
} = require("./purchase-notes");

const SESSION_COOKIE = "farmasync_portal_session";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SHORT_SESSION_MS = 12 * HOUR_MS;
// "Manter conectado": 30 dias de inatividade, renovados a cada uso. O teto de
// 90 dias desde o login é aplicado pelo repositório.
const REMEMBER_SESSION_MS = 30 * DAY_MS;
// Sessão longa só lê dados; alterações pedem uma senha digitada nas últimas 12 horas.
const FRESH_LOGIN_SECONDS = 12 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Hash descartável: faz o login de e-mail inexistente gastar o mesmo tempo de um
// e-mail real, para não revelar quais contas existem pelo tempo de resposta.
const DECOY_CREDENTIALS = hashPassword("senha-descartavel-sem-uso");

function parseCredentials(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return { error: "invalid_email" };
  if (!password || password.length > 128) return { error: "invalid_password" };
  return { email, password };
}

function sameOriginGuard(publicBaseUrl) {
  let publicOrigin = "";
  try { publicOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin.toLowerCase() : ""; } catch (_error) { publicOrigin = ""; }
  return (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    const fetchSite = request.get("sec-fetch-site");
    if (fetchSite === "same-origin" || fetchSite === "none") return next();
    if (fetchSite === "cross-site" || fetchSite === "same-site") {
      return response.status(403).json({ error: "forbidden_origin" });
    }
    const origin = request.get("origin");
    if (!origin) return next();
    const allowed = new Set([`${request.protocol}://${request.get("host")}`.toLowerCase()]);
    if (publicOrigin) allowed.add(publicOrigin);
    if (allowed.has(origin.toLowerCase())) return next();
    return response.status(403).json({ error: "forbidden_origin" });
  };
}

function apiErrorHandler(error, _request, response, next) {
  if (response.headersSent) return next(error);
  const status = Number(error?.status || error?.statusCode || 500);
  if (error?.type === "entity.parse.failed") return response.status(400).json({ error: "invalid_json" });
  if (error?.type === "entity.too.large") return response.status(413).json({ error: "payload_too_large" });
  if (status >= 400 && status < 500) {
    return response.status(status).json({ error: status === 404 ? "not_found" : "bad_request" });
  }
  console.error(`Erro não tratado: ${error?.code || ""} ${error?.message || error}`);
  return response.status(500).json({ error: "internal_error" });
}

function cookieValue(request, name) {
  const cookies = String(request.get("cookie") || "").split(";");
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function parseHistoryPeriod(query, now = new Date()) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const defaultEnd = now.toISOString().slice(0, 10);
  const defaultStartDate = new Date(`${defaultEnd}T00:00:00.000Z`);
  defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() - 29);
  const startDate = String(query.start || defaultStartDate.toISOString().slice(0, 10));
  const endDate = String(query.end || defaultEnd);
  if (!isoDate.test(startDate) || !isoDate.test(endDate)) return null;

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.toISOString().slice(0, 10) !== startDate) return null;
  if (end.toISOString().slice(0, 10) !== endDate) return null;
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days < 1 || days > 366) return null;
  return { startDate, endDate };
}

function parseClubCoupon(body) {
  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  const code = String(body?.code || "").trim().toUpperCase();
  const pointsCost = Number(body?.pointsCost);
  const expiresAt = String(body?.expiresAt || "").trim();
  const expiresDate = new Date(expiresAt);
  if (title.length < 3 || title.length > 120) return null;
  if (!description || description.length > 240) return null;
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return null;
  if (!Number.isInteger(pointsCost) || pointsCost < 0 || pointsCost > 1000000) return null;
  if (!expiresAt || Number.isNaN(expiresDate.getTime())) return null;
  return {
    title,
    description,
    code,
    pointsCost,
    expiresAt: expiresDate,
    active: body?.active === undefined ? true : Boolean(body.active),
  };
}

function createApp({ repository, clubAdmin, passwordResetMailer, publicBaseUrl = "", trustProxy = false, secureCookies = false } = {}) {
  const app = express();

  if (trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        ...(secureCookies ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
  app.use((_request, response, next) => {
    response.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    next();
  });
  // As rotas de notas de entrada recebem o XML (até 1,5 MB) e só aceitam esse tamanho depois de autenticadas.
  const smallJson = express.json({ limit: "32kb" });
  app.use((request, response, next) => (
    request.path.startsWith("/api/purchase-notes") ? next() : smallJson(request, response, next)
  ));
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", sameOriginGuard(publicBaseUrl));
  const generalApiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (request) => request.path.startsWith("/auth/"),
  });
  const writeApiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (request) => request.path.startsWith("/auth/") || ["GET", "HEAD"].includes(request.method),
  });
  app.use("/api", generalApiLimiter, writeApiLimiter);
  app.use("/assets", express.static(path.join(__dirname, "..", "public"), {
    fallthrough: false,
    maxAge: "1d",
    setHeaders(response, filePath) {
      if (/\.(js|css)$/i.test(filePath)) response.setHeader("Cache-Control", "no-cache");
    },
  }));
  app.get("/vendor/lucide.js", (_request, response) => {
    response.sendFile(require.resolve("lucide/dist/umd/lucide.js"));
  });
  // Atalho no celular: manifesto do app e o ícone que o iPhone procura na raiz do site.
  app.get("/manifest.webmanifest", (_request, response) => {
    response.type("application/manifest+json").set("Cache-Control", "no-cache").send(JSON.stringify(webManifest()));
  });
  app.get(["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"], (_request, response) => {
    response.set("Cache-Control", "public, max-age=86400")
      .sendFile(path.join(__dirname, "..", "public", "apple-touch-icon.png"));
  });

  app.get("/", (_request, response) => response.type("html").send(loginPage()));
  app.get("/primeiro-acesso", (_request, response) => response.type("html").send(firstAccessPage()));
  app.get("/esqueci-minha-senha", (_request, response) => response.type("html").send(forgotPasswordPage()));
  app.get("/redefinir-senha", (_request, response) => response.type("html").send(resetPasswordPage()));
  app.get("/painel", (_request, response) => response.type("html").send(dashboardPage()));

  app.get("/health", async (_request, response) => {
    try {
      if (repository) await repository.health();
      response.json({ status: "ok", service: "portal-gestor", database: "ok" });
    } catch (_error) {
      response.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  function finish() {
    app.use("/api", (_request, response) => response.status(404).json({ error: "not_found" }));
    app.use((_request, response) => response.status(404).type("text").send("Página não encontrada."));
    app.use(apiErrorHandler);
    return app;
  }

  if (!repository) return finish();

  // Só as tentativas que falham contam: acertar a senha nunca bloqueia ninguém.
  const tooManyAttempts = (request, response, _next, options) => {
    const resetTime = request.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(options.windowMs / 1000);
    response.status(429).json({ error: "too_many_attempts", retryAfterSeconds });
  };
  // 5 erros por pessoa (IP + e-mail) e 20 por IP: segura quem tenta adivinhar a
  // senha de uma conta sem travar a farmácia inteira atrás do mesmo roteador.
  const loginAccountLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (request) => {
      const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
      return `${ipKeyGenerator(request.ip)}|${crypto.createHash("sha256").update(email).digest("hex").slice(0, 24)}`;
    },
    handler: tooManyAttempts,
  });
  const loginIpLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (request) => ipKeyGenerator(request.ip),
    handler: tooManyAttempts,
  });
  const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post("/api/auth/forgot-password", passwordResetLimiter, async (request, response) => {
    const email = String(request.body?.email || "").trim().toLowerCase();
    const accepted = () => response.status(202).json({ ok: true });
    if (!email || !passwordResetMailer || !publicBaseUrl) return accepted();
    try {
      const user = await repository.userByEmail(email);
      if (!user) return accepted();
      const token = crypto.randomBytes(32).toString("base64url");
      await repository.createPasswordReset(
        user.id,
        sessionTokenHash(token),
        new Date(Date.now() + 15 * 60 * 1000),
      );
      await passwordResetMailer.sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl: `${publicBaseUrl.replace(/\/$/, "")}/redefinir-senha?token=${encodeURIComponent(token)}`,
      });
    } catch (error) {
      console.error(`Falha ao solicitar recuperação de senha: ${error.message}`);
    }
    return accepted();
  });

  app.post("/api/auth/reset-password", passwordResetLimiter, async (request, response) => {
    const token = String(request.body?.token || "");
    const password = String(request.body?.password || "");
    const confirmation = String(request.body?.confirmation || "");
    if (!token || password !== confirmation) {
      return response.status(400).json({ error: "invalid_reset_request" });
    }
    try {
      const credentials = hashPassword(password);
      const changed = await repository.resetPasswordByTokenHash(
        sessionTokenHash(token),
        credentials.salt,
        credentials.hash,
      );
      if (!changed) return response.status(400).json({ error: "invalid_or_expired_token" });
      response.clearCookie(SESSION_COOKIE, { path: "/" });
      return response.json({ ok: true });
    } catch (error) {
      if (String(error?.message || "").includes("10 caracteres")) {
        return response.status(400).json({ error: "weak_password" });
      }
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/api/auth/login", loginIpLimiter, loginAccountLimiter, async (request, response) => {
    const credentials = parseCredentials(request.body);
    if (credentials.error) return response.status(400).json({ error: credentials.error });
    const { email, password } = credentials;

    try {
      const user = await repository.userByEmail(email);
      const valid = user
        ? verifyPassword(password, user.password_salt, user.password_hash)
        : (verifyPassword(password, DECOY_CREDENTIALS.salt, DECOY_CREDENTIALS.hash), false);
      if (!user || !valid) {
        return response.status(401).json({ error: "invalid_credentials" });
      }

      const token = crypto.randomBytes(32).toString("base64url");
      const remember = request.body?.remember === true;
      const lifetimeMs = remember ? REMEMBER_SESSION_MS : SHORT_SESSION_MS;
      const expiresAt = new Date(Date.now() + lifetimeMs);
      await repository.createSession(user.id, sessionTokenHash(token), expiresAt, remember);
      response.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        maxAge: lifetimeMs,
        path: "/",
      });
      return response.json({
        ok: true,
        passwordChangeRequired: Boolean(Number(user.password_change_required || 0)),
      });
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  async function requireSession(request, response, next) {
    const token = cookieValue(request, SESSION_COOKIE);
    if (!token) return response.status(401).json({ error: "unauthorized" });

    try {
      const session = await repository.sessionByTokenHash(sessionTokenHash(token));
      if (!session) return response.status(401).json({ error: "unauthorized" });
      const remembered = Boolean(Number(session.remember || 0));
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(request.method)
        || request.path === "/api/purchase-notes/preview";
      if (remembered && !readOnly && request.path !== "/api/auth/logout"
        && Number(session.age_seconds || 0) > FRESH_LOGIN_SECONDS) {
        return response.status(403).json({ error: "reauth_required" });
      }
      request.portalSession = session;
      if (remembered && typeof repository.renewSession === "function"
        && Number(session.seconds_left || 0) < (REMEMBER_SESSION_MS - DAY_MS) / 1000) {
        const renewedUntil = new Date(Date.now() + REMEMBER_SESSION_MS);
        await repository.renewSession(sessionTokenHash(token), renewedUntil);
        response.cookie(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: secureCookies,
          maxAge: REMEMBER_SESSION_MS,
          path: "/",
        });
      }
      return next();
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  }

  function requireCompleteSession(request, response, next) {
    if (Boolean(Number(request.portalSession.password_change_required || 0))) {
      return response.status(403).json({ error: "password_change_required" });
    }
    return next();
  }

  app.get("/api/auth/session", requireSession, (request, response) => {
    response.json({
      authenticated: true,
      passwordChangeRequired: Boolean(Number(request.portalSession.password_change_required || 0)),
    });
  });

  app.post("/api/auth/change-password", requireSession, async (request, response) => {
    if (!Boolean(Number(request.portalSession.password_change_required || 0))) {
      return response.status(409).json({ error: "password_change_not_required" });
    }
    const password = String(request.body?.password || "");
    const confirmation = String(request.body?.confirmation || "");
    if (password !== confirmation) {
      return response.status(400).json({ error: "password_confirmation_mismatch" });
    }
    try {
      const credentials = hashPassword(password);
      await repository.updatePassword(
        request.portalSession.user_id,
        credentials.salt,
        credentials.hash,
      );
      return response.json({ ok: true });
    } catch (error) {
      if (String(error?.message || "").includes("10 caracteres")) {
        return response.status(400).json({ error: "weak_password" });
      }
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/dashboard", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const row = await repository.dashboardByClientId(request.portalSession.cliente_id);
      if (!row) return response.status(404).json({ error: "dashboard_not_found" });
      return response.json(buildDashboardSummary(row));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/sync-health", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const row = await repository.syncHealthByClientId(
        request.portalSession.cliente_id,
      );
      if (!row) return response.status(404).json({ error: "sync_health_not_found" });
      return response.json(buildSyncHealth(row));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/sales-history", requireSession, requireCompleteSession, async (request, response) => {
    const period = parseHistoryPeriod(request.query);
    if (!period) return response.status(400).json({ error: "invalid_period" });
    try {
      const rows = await repository.salesHistoryByClientId(
        request.portalSession.cliente_id,
        period.startDate,
        period.endDate,
      );
      return response.json(buildSalesHistory(rows, period.startDate, period.endDate));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/campaigns", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const clientId = request.portalSession.cliente_id;
      const [campaigns, winners] = await Promise.all([
        repository.campaignsByClientId(clientId),
        repository.campaignWinnersByClientId(clientId, 20),
      ]);
      return response.json(buildCampaignOverview(campaigns, winners));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/club", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const overview = await repository.clubOverviewByClientId(
        request.portalSession.cliente_id,
      );
      if (!overview) return response.status(404).json({ error: "club_not_found" });
      return response.json(overview);
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/club/points-validity", requireSession, requireCompleteSession, async (request, response) => {
    const months = request.body?.months === null ? null : Number(request.body?.months);
    if (months !== null && ![6, 12, 18, 24].includes(months)) {
      return response.status(400).json({ error: "invalid_points_validity" });
    }
    try {
      const updated = await repository.updateClubPointsValidity(
        request.portalSession.cliente_id,
        months,
      );
      if (!updated) return response.status(404).json({ error: "club_not_found" });
      return response.json({ pointsValidityMonths: months });
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/club/tiers", requireSession, requireCompleteSession, async (request, response) => {
    const silverAmount = Number(request.body?.silverAmount);
    const goldAmount = Number(request.body?.goldAmount);
    if (!Number.isFinite(silverAmount) || silverAmount < 0 || !Number.isFinite(goldAmount) || goldAmount <= silverAmount) {
      return response.status(400).json({ error: "invalid_tiers" });
    }
    try {
      const roundedSilver = Math.round(silverAmount * 100) / 100;
      const roundedGold = Math.round(goldAmount * 100) / 100;
      const updated = await repository.updateClubTiers(
        request.portalSession.cliente_id,
        roundedSilver,
        roundedGold,
      );
      if (!updated) return response.status(404).json({ error: "club_not_found" });
      return response.json({ silverAmount: roundedSilver, goldAmount: roundedGold });
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/club/referral-bonus", requireSession, requireCompleteSession, async (request, response) => {
    const points = Number(request.body?.points);
    if (!Number.isSafeInteger(points) || points < 0 || points > 100000) {
      return response.status(400).json({ error: "invalid_referral_bonus" });
    }
    try {
      const updated = await repository.updateClubReferralBonus(request.portalSession.cliente_id, points);
      if (!updated) return response.status(404).json({ error: "club_not_found" });
      return response.json({ points });
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/club/cashback-rate", requireSession, requireCompleteSession, async (request, response) => {
    const pointsPerReal = Number(request.body?.pointsPerReal);
    if (!Number.isSafeInteger(pointsPerReal) || pointsPerReal < 1 || pointsPerReal > 1000000) {
      return response.status(400).json({ error: "invalid_cashback_rate" });
    }
    try {
      const updated = await repository.updateClubCashbackRate(request.portalSession.cliente_id, pointsPerReal);
      if (!updated) return response.status(404).json({ error: "club_not_found" });
      return response.json({ pointsPerReal });
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/club/birthday-campaign", requireSession, requireCompleteSession, async (request, response) => {
    const enabled = request.body?.enabled;
    const points = Number(request.body?.points);
    const leadDays = Number(request.body?.leadDays);
    if (typeof enabled !== "boolean" || !Number.isSafeInteger(points) || points < 1 || points > 100000
      || !Number.isSafeInteger(leadDays) || leadDays < 0 || leadDays > 365) {
      return response.status(400).json({ error: "invalid_birthday_campaign" });
    }
    try {
      const updated = await repository.updateClubBirthdayCampaign(
        request.portalSession.cliente_id, enabled, points, leadDays,
      );
      if (!updated) return response.status(404).json({ error: "club_not_found" });
      return response.json({ enabled, points, leadDays });
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  function memberAdminPayload(request, values) {
    return {
      clientId: Number(request.portalSession.cliente_id),
      actorUserId: Number(request.portalSession.user_id),
      actorName: String(request.portalSession.name || request.portalSession.email || "Gestor"),
      reason: String(request.body?.reason || "").trim(),
      ...values,
    };
  }

  function memberId(request) {
    const value = Number(request.params.memberId);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function sendClubAdminError(response, error) {
    const status = [400, 404, 409].includes(error?.status) ? error.status : 503;
    return response.status(status).json(error?.payload || { error: error?.message || "service_unavailable" });
  }

  app.put("/api/club/members/:memberId/phone", requireSession, requireCompleteSession, async (request, response) => {
    const id = memberId(request);
    if (!id || !clubAdmin) return response.status(id ? 503 : 400).json({ error: id ? "service_unavailable" : "invalid_member" });
    try {
      const result = await clubAdmin.changePhone(id, memberAdminPayload(request, {
        phone: String(request.body?.phone || ""), merge: request.body?.merge === true,
      }));
      return response.json(result);
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.put("/api/club/members/:memberId/status", requireSession, requireCompleteSession, async (request, response) => {
    const id = memberId(request);
    if (!id || !clubAdmin || typeof request.body?.active !== "boolean") {
      return response.status(!clubAdmin && id ? 503 : 400).json({ error: "invalid_admin_request" });
    }
    try {
      return response.json(await clubAdmin.setActive(id, memberAdminPayload(request, { active: request.body.active })));
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.post("/api/club/members/:memberId/points", requireSession, requireCompleteSession, async (request, response) => {
    const id = memberId(request);
    const points = Number(request.body?.points);
    if (!id || !clubAdmin || !Number.isSafeInteger(points)) {
      return response.status(!clubAdmin && id ? 503 : 400).json({ error: "invalid_admin_request" });
    }
    try {
      return response.json(await clubAdmin.adjustPoints(id, memberAdminPayload(request, { points })));
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.put("/api/club/members/:memberId/cashback-block", requireSession, requireCompleteSession, async (request, response) => {
    const id = memberId(request);
    if (!id || !clubAdmin || typeof request.body?.blocked !== "boolean") {
      return response.status(!clubAdmin && id ? 503 : 400).json({ error: "invalid_admin_request" });
    }
    try {
      return response.json(await clubAdmin.setCashbackBlocked(id, memberAdminPayload(request, { blocked: request.body.blocked })));
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.post("/api/club/members/:memberId/cashback", requireSession, requireCompleteSession, async (request, response) => {
    const id = memberId(request);
    const amount = Math.round(Number(request.body?.amount) * 100) / 100;
    if (!id || !clubAdmin || !Number.isFinite(amount) || amount < 0.01 || amount > 100000) {
      return response.status(!clubAdmin && id ? 503 : 400).json({ error: "invalid_admin_request" });
    }
    try {
      return response.status(201).json(await clubAdmin.grantManualCashback(id, memberAdminPayload(request, { amount })));
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.post("/api/club/cashbacks/:cashbackId/cancel", requireSession, requireCompleteSession, async (request, response) => {
    const cashbackId = Number(request.params.cashbackId);
    const targetMemberId = Number(request.body?.memberId);
    if (!clubAdmin || !Number.isSafeInteger(cashbackId) || cashbackId < 1 || !Number.isSafeInteger(targetMemberId) || targetMemberId < 1) {
      return response.status(!clubAdmin ? 503 : 400).json({ error: "invalid_admin_request" });
    }
    try {
      return response.json(await clubAdmin.cancelCashback(cashbackId, memberAdminPayload(request, { memberId: targetMemberId })));
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.put("/api/club/members/:memberId/birth-date", requireSession, requireCompleteSession, async (request, response) => {
    const id = memberId(request);
    const birthDate = String(request.body?.birthDate || "");
    if (!id || !clubAdmin || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      return response.status(!clubAdmin && id ? 503 : 400).json({ error: "invalid_admin_request" });
    }
    try {
      return response.json(await clubAdmin.changeBirthDate(id, memberAdminPayload(request, { birthDate })));
    } catch (error) {
      return sendClubAdminError(response, error);
    }
  });

  app.post("/api/club/coupons", requireSession, requireCompleteSession, async (request, response) => {
    const coupon = parseClubCoupon(request.body);
    if (!coupon) return response.status(400).json({ error: "invalid_coupon" });
    try {
      const created = await repository.createClubCoupon(
        request.portalSession.cliente_id,
        coupon,
      );
      if (!created) return response.status(404).json({ error: "club_not_found" });
      return response.status(201).json({ ok: true, id: Number(created.id) });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return response.status(409).json({ error: "coupon_code_exists" });
      }
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/club/coupons/:couponId", requireSession, requireCompleteSession, async (request, response) => {
    const couponId = Number(request.params.couponId);
    const coupon = parseClubCoupon(request.body);
    if (!Number.isSafeInteger(couponId) || couponId < 1 || !coupon) {
      return response.status(400).json({ error: "invalid_coupon" });
    }
    try {
      const updated = await repository.updateClubCoupon(
        request.portalSession.cliente_id,
        couponId,
        coupon,
      );
      if (!updated) return response.status(404).json({ error: "coupon_not_found" });
      return response.json({ ok: true });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return response.status(409).json({ error: "coupon_code_exists" });
      }
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/inventory", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const clientId = request.portalSession.cliente_id;
      const [summary, alerts] = await Promise.all([
        repository.inventorySummaryByClientId(clientId),
        repository.inventoryAlertsByClientId(clientId, 200),
      ]);
      return response.json(buildInventoryOverview(summary, alerts));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/products", requireSession, requireCompleteSession, async (request, response) => {
    const filter = PRODUCT_FILTER_KEYS.has(String(request.query.filter)) ? String(request.query.filter) : "all";
    try {
      const result = await repository.productsByClientId(request.portalSession.cliente_id, {
        search: String(request.query.search || "").slice(0, 100),
        filter,
        limit: request.query.limit,
      });
      return response.json({
        products: result.products.map((product) => serializeProduct(product)),
        total: result.total,
        counts: result.counts,
        filter,
      });
    } catch (error) {
      console.error(`Falha em GET /api/products: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.put("/api/products/:productId", requireSession, requireCompleteSession, async (request, response) => {
    const productId = Number(request.params.productId);
    const parsed = parseProductUpdate(request.body);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return response.status(400).json({ error: "invalid_product_update" });
    }
    if (parsed.error) return response.status(400).json(parsed);
    try {
      const queued = await repository.enqueueProductUpdate(
        request.portalSession.cliente_id,
        request.portalSession.user_id,
        productId,
        parsed.value,
      );
      if (!queued) return response.status(404).json({ error: "product_not_found" });
      if (queued.conflict) return response.status(409).json({ error: queued.conflict });
      return response.status(202).json(queued);
    } catch (error) {
      console.error(`Falha em PUT /api/products/:id: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  const purchaseNoteBody = express.json({ limit: "2500kb" });
  const noteErrorStatus = { xml_too_large: 413 };
  const noteId = (request) => {
    const id = Number(request.params.noteId);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  app.get("/api/purchase-notes", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const rows = await repository.purchaseNotesByClientId(request.portalSession.cliente_id, request.query.limit);
      return response.json({
        notes: rows.map((row) => serializePurchaseNote(row)),
        options: { categories: CATEGORIES, continuousUse: CONTINUOUS_USE, controlledTypes: CONTROLLED_TYPES },
      });
    } catch (error) {
      console.error(`Falha em GET /api/purchase-notes: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  // Lê o XML e mostra o que seria lançado. Não grava nada.
  app.post("/api/purchase-notes/preview", requireSession, requireCompleteSession, purchaseNoteBody, async (request, response) => {
    const parsed = parseNfeXml(request.body?.xml);
    if (parsed.error) return response.status(noteErrorStatus[parsed.error] || 400).json(parsed);
    try {
      const clientId = request.portalSession.cliente_id;
      const matches = await repository.matchCatalogProducts(clientId, parsed.value.items);
      const existing = await repository.activePurchaseNote(clientId, parsed.value.accessKey);
      return response.json({
        note: previewNote(parsed.value, matches),
        duplicate: existing ? { id: Number(existing.id), status: String(existing.status) } : null,
        options: { categories: CATEGORIES, continuousUse: CONTINUOUS_USE, controlledTypes: CONTROLLED_TYPES },
      });
    } catch (error) {
      console.error(`Falha em POST /api/purchase-notes/preview: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/api/purchase-notes", requireSession, requireCompleteSession, purchaseNoteBody, async (request, response) => {
    const clientId = request.portalSession.cliente_id;
    try {
      const built = await buildPurchaseNote(
        request.body,
        (sources) => repository.matchCatalogProducts(clientId, sources),
      );
      if (built.error) return response.status(noteErrorStatus[built.error] || 400).json(built);
      const queued = await repository.enqueuePurchaseNote(clientId, request.portalSession.user_id, built.value);
      if (!queued) return response.status(409).json({ error: "license_not_found" });
      if (queued.duplicate) {
        return response.status(409).json({ error: "note_already_entered", existingId: queued.existingId, existingStatus: queued.existingStatus });
      }
      return response.status(202).json(queued);
    } catch (error) {
      console.error(`Falha em POST /api/purchase-notes: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/purchase-notes/:noteId", requireSession, requireCompleteSession, async (request, response) => {
    const id = noteId(request);
    if (!id) return response.status(404).json({ error: "not_found" });
    try {
      const row = await repository.purchaseNoteById(request.portalSession.cliente_id, id);
      if (!row) return response.status(404).json({ error: "not_found" });
      return response.json(serializePurchaseNote(row, { detail: true }));
    } catch (error) {
      console.error(`Falha em GET /api/purchase-notes/:id: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/api/purchase-notes/:noteId/cancel", requireSession, requireCompleteSession, async (request, response) => {
    const id = noteId(request);
    if (!id) return response.status(404).json({ error: "not_found" });
    try {
      const cancelled = await repository.cancelPurchaseNote(request.portalSession.cliente_id, id);
      if (!cancelled) return response.status(409).json({ error: "note_not_cancellable" });
      return response.json({ ok: true });
    } catch (error) {
      console.error(`Falha em POST /api/purchase-notes/:id/cancel: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/api/purchase-notes/:noteId/retry", requireSession, requireCompleteSession, async (request, response) => {
    const id = noteId(request);
    if (!id) return response.status(404).json({ error: "not_found" });
    try {
      const result = await repository.retryPurchaseNote(request.portalSession.cliente_id, id);
      if (result.duplicate) return response.status(409).json({ error: "note_already_entered" });
      if (!result.retried) return response.status(409).json({ error: "note_not_retryable" });
      return response.status(202).json({ ok: true, status: "PENDENTE" });
    } catch (error) {
      console.error(`Falha em POST /api/purchase-notes/:id/retry: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/cash", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const summary = await repository.cashSummaryByClientId(
        request.portalSession.cliente_id,
      );
      if (!summary) return response.status(404).json({ error: "cash_not_found" });
      return response.json(buildCashOverview(summary));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/deliveries-credit", requireSession, requireCompleteSession, async (request, response) => {
    const periodKey = String(request.query.period || "today");
    if (!["today", "current-month", "previous-month"].includes(periodKey)) {
      return response.status(400).json({ error: "invalid_period" });
    }
    try {
      const summary = await repository.deliveryCreditSummaryByClientId(
        request.portalSession.cliente_id,
        periodKey,
      );
      if (!summary) {
        return response.status(404).json({ error: "deliveries_credit_not_found" });
      }
      return response.json(buildDeliveryCreditOverview(summary));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/deliveries/pending", requireSession, requireCompleteSession, async (request, response) => {
    try {
      const data = await repository.pendingDeliveriesByClientId(request.portalSession.cliente_id);
      return response.json(buildPendingDeliveries(data));
    } catch (error) {
      console.error(`Falha em GET /api/deliveries/pending: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  // Pede ao balcão para baixar as entregas escolhidas (venda de balcão e pedido do aplicativo, igual ao Controle de Entregas).
  app.post("/api/deliveries/settle", requireSession, requireCompleteSession, async (request, response) => {
    const parsed = parseSettleRequest(request.body);
    if (parsed.error) return response.status(400).json(parsed);
    try {
      const results = await repository.enqueueDeliverySettlements(
        request.portalSession.cliente_id,
        request.portalSession.user_id,
        parsed.value.items,
      );
      if (!results) return response.status(409).json({ error: "license_not_found" });
      return response.status(202).json({ results });
    } catch (error) {
      console.error(`Falha em POST /api/deliveries/settle: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/api/deliveries/requests/:requestId/cancel", requireSession, requireCompleteSession, async (request, response) => {
    const id = Number(request.params.requestId);
    if (!Number.isSafeInteger(id) || id <= 0) return response.status(404).json({ error: "not_found" });
    try {
      const cancelled = await repository.cancelDeliverySettlement(request.portalSession.cliente_id, id);
      if (!cancelled) return response.status(409).json({ error: "request_not_cancellable" });
      return response.json({ ok: true });
    } catch (error) {
      console.error(`Falha em POST /api/deliveries/requests/:id/cancel: ${error?.code || ""} ${error?.message || error}`);
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.get("/api/suspicious-actions", requireSession, requireCompleteSession, async (request, response) => {
    const periodKey = String(request.query.period || "today");
    if (!["today", "current-month", "previous-month"].includes(periodKey)) {
      return response.status(400).json({ error: "invalid_period" });
    }
    try {
      const summary = await repository.suspiciousActionsByClientId(
        request.portalSession.cliente_id,
        periodKey,
      );
      if (!summary) {
        return response.status(404).json({ error: "suspicious_actions_not_found" });
      }
      return response.json(buildSuspiciousActionsOverview(summary));
    } catch (_error) {
      return response.status(503).json({ error: "service_unavailable" });
    }
  });

  app.post("/api/auth/logout", requireSession, async (request, response) => {
    const token = cookieValue(request, SESSION_COOKIE);
    await repository.deleteSession(sessionTokenHash(token));
    response.clearCookie(SESSION_COOKIE, { path: "/" });
    response.json({ ok: true });
  });

  return finish();
}

module.exports = { createApp, sessionTokenHash };