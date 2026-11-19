const { createPool, initializeDatabase } = require("../src/db");

async function main() {
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
    const [users] = await pool.execute(
      `SELECT u.name AS nome, u.email, c.nome AS farmacia,
              CASE WHEN u.active = 1 THEN 'Ativo' ELSE 'Bloqueado' END AS status,
              CASE WHEN u.password_change_required = 1
                   THEN 'Pendente' ELSE 'Concluído' END AS primeiro_acesso
         FROM portal_gestor_users u
         JOIN clientes_sistema c ON c.id = u.cliente_id
        ORDER BY c.nome, u.name, u.email`,
    );
    if (!users.length) {
      console.log("Nenhum gestor cadastrado.");
      return;
    }
    console.table(users);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});