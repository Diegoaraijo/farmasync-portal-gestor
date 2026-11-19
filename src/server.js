const { createApp } = require("./app");
const { createPool, initializeDatabase } = require("./db");
const { createRepository } = require("./repository");
const { createClubAdminClient } = require("./club-admin-client");
const { createPasswordResetMailer } = require("./mailer");

const port = Number(process.env.PORT || 3000);

function initializeDatabaseEventually(pool, attempt = 1) {
  initializeDatabase(pool)
    .then(() => console.log("Banco do Portal Gestor inicializado."))
    .catch((error) => {
      const delayMs = Math.min(30_000 * attempt, 5 * 60_000);
      console.error(
        `Banco indisponível na tentativa ${attempt}: ${error.message}. `
        + `Nova tentativa em ${Math.round(delayMs / 1000)}s.`,
      );
      const retryTimer = setTimeout(
        () => initializeDatabaseEventually(pool, attempt + 1),
        delayMs,
      );
      retryTimer.unref();
    });
}

function start() {
  const pool = createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "true",
  });
  const repository = createRepository(pool);
  createApp({
    repository,
    clubAdmin: createClubAdminClient({
      baseUrl: required("CLUB_API_URL"),
      token: required("CLUB_ADMIN_API_TOKEN"),
    }),
    passwordResetMailer: createPasswordResetMailer({
      host: required("SMTP_HOST"),
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE !== "false",
      user: required("SMTP_USER"),
      password: required("SMTP_PASSWORD"),
      from: required("SMTP_FROM"),
    }),
    publicBaseUrl: required("PUBLIC_BASE_URL"),
    trustProxy: process.env.TRUST_PROXY === "1",
    secureCookies: process.env.NODE_ENV === "production",
  }).listen(port, () => {
    console.log(`Portal Gestor disponível na porta ${port}.`);
  });
  initializeDatabaseEventually(pool);
}

start();

function required(name) {
  const value = process.env[name];
  if (!value || (name.endsWith("TOKEN") && value.length < 24)) throw new Error(`${name} não configurado.`);
  return value;
}