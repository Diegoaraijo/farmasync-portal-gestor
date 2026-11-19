const fs = require("node:fs");
const path = require("node:path");

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    return match ? [[match[1], match[2].replace(/^"|"$/g, "")]] : [];
  }));
}

function dotenvValue(value) {
  return JSON.stringify(String(value ?? ""));
}

function main() {
  const workspaceRoot = path.resolve(__dirname, "..", "..");
  const configPath = path.join(workspaceRoot, "servidor_config.json");
  const adminEnvPath = path.join(workspaceRoot, "variaveis_hostinger", "portal_gestor.env");
  const outputPath = path.join(workspaceRoot, "env_portal_gestor", "hostinger.env");
  const configText = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(configText);
  const adminEnv = parseEnv(fs.readFileSync(adminEnvPath, "utf8"));

  for (const key of ["host", "port", "user", "password", "database"]) {
    if (config[key] === undefined || config[key] === null || String(config[key]).trim() === "") {
      throw new Error(`Campo obrigatório ausente em servidor_config.json: ${key}`);
    }
  }

  const variables = {
    NODE_ENV: "production",
    TRUST_PROXY: "1",
    DB_HOST: config.host,
    DB_PORT: config.port,
    DB_USER: config.user,
    DB_PASSWORD: config.password,
    DB_NAME: config.database,
    DB_SSL: "true",
    CLUB_API_URL: adminEnv.CLUB_API_URL,
    CLUB_ADMIN_API_TOKEN: adminEnv.CLUB_ADMIN_API_TOKEN,
  };
  if (!variables.CLUB_API_URL || !variables.CLUB_ADMIN_API_TOKEN) {
    throw new Error("Variáveis administrativas do Clube não configuradas.");
  }
  const contents = Object.entries(variables)
    .map(([key, value]) => `${key}=${dotenvValue(value)}`)
    .join("\n");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${contents}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Arquivo criado: ${outputPath}`);
  console.log(`Variáveis prontas: ${Object.keys(variables).join(", ")}`);
}

main();