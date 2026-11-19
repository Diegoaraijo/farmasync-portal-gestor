const { createPool, initializeDatabase } = require("../src/db");
const { hashTemporaryPassword } = require("../src/security");

async function main() {
  const [licenseKey, email, name] = process.argv.slice(2).map((value) => String(value || "").trim());
  const temporaryPassword = process.env.PORTAL_TEMPORARY_PASSWORD || "";
  if (!licenseKey || !email || !name || !temporaryPassword) {
    throw new Error("Informe licença, e-mail e nome. Defina PORTAL_TEMPORARY_PASSWORD com 6 números.");
  }

  const pool = createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "true",
  });
  try {
    await initializeDatabase(pool);
    const [clients] = await pool.execute(
      "SELECT id FROM clientes_sistema WHERE chave_licenca = ? AND status = 'Ativo' LIMIT 1",
      [licenseKey],
    );
    if (!clients[0]) throw new Error("Licença ativa não encontrada.");

    const credentials = hashTemporaryPassword(temporaryPassword);
    await pool.execute(
      `INSERT INTO portal_gestor_users (
         cliente_id, name, email, password_salt, password_hash, password_change_required
       ) VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE cliente_id = VALUES(cliente_id), name = VALUES(name),
         password_salt = VALUES(password_salt), password_hash = VALUES(password_hash),
         password_change_required = 1, active = 1`,
      [clients[0].id, name, email.toLowerCase(), credentials.salt, credentials.hash],
    );
    await pool.execute(
      `DELETE s FROM portal_gestor_sessions s
        JOIN portal_gestor_users u ON u.id = s.user_id
       WHERE u.email = ?`,
      [email.toLowerCase()],
    );
    console.log(`Gestor ${email.toLowerCase()} criado com senha temporária.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});