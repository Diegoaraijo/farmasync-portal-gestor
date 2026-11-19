const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createApp } = require("../src/app");
const { hashPassword } = require("../src/security");

const credentials = hashPassword("senha-segura-123");
const repository = {
  health: async () => {},
  userByEmail: async (email) => (email === "gestor@farmacia.test"
    ? { id: 7, cliente_id: 42, password_salt: credentials.salt, password_hash: credentials.hash, password_change_required: 0 }
    : null),
  createSession: async () => {},
  sessionByTokenHash: async () => ({ user_id: 7, cliente_id: 42, password_change_required: 0 }),
  enqueueProductUpdate: async () => ({ updateId: 1, productId: 1, status: "PENDENTE" }),
};

async function start(options = {}) {
  const server = createApp({ repository, ...options }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    port: server.address().port,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// fetch do Node não deixa controlar Origin/Sec-Fetch-Site; o http puro deixa.
function raw(port, { method = "GET", path: url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: url, headers }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

const login = (base, email, password) => fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});

test("após 5 erros o login é bloqueado, mesmo com a senha certa, e avisa quanto esperar", async (context) => {
  const server = await start();
  context.after(server.close);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await login(server.base, "gestor@farmacia.test", "senha-errada")).status, 401, `tentativa ${attempt}`);
  }
  const blocked = await login(server.base, "gestor@farmacia.test", "senha-errada");
  assert.equal(blocked.status, 429);
  const payload = await blocked.json();
  assert.equal(payload.error, "too_many_attempts");
  assert.ok(payload.retryAfterSeconds > 0 && payload.retryAfterSeconds <= 900);
  assert.ok(blocked.headers.get("retry-after"));

  assert.equal((await login(server.base, "gestor@farmacia.test", "senha-segura-123")).status, 429, "senha certa também espera");
  assert.equal((await login(server.base, "outra@farmacia.test", "qualquer-coisa")).status, 401, "outra conta não é afetada");
});

test("acertar a senha nunca conta como tentativa", async (context) => {
  const server = await start();
  context.after(server.close);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await login(server.base, "gestor@farmacia.test", "senha-segura-123")).status, 200);
  }
});

test("20 erros vindos do mesmo IP bloqueiam o IP, mesmo trocando de e-mail", async (context) => {
  const server = await start();
  context.after(server.close);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal((await login(server.base, `pessoa${attempt}@farmacia.test`, "senha-errada")).status, 401);
  }
  assert.equal((await login(server.base, "novo@farmacia.test", "senha-errada")).status, 429);
});

test("campo de e-mail aceita só e-mail e a senha tem tamanho máximo", async (context) => {
  const server = await start();
  context.after(server.close);
  for (const email of ["", "   ", "sem-arroba", "a@b", "dois@@farmacia.test", "com espaco@farmacia.test", `${"a".repeat(250)}@x.com`]) {
    const response = await login(server.base, email, "senha-segura-123");
    assert.equal(response.status, 400, JSON.stringify(email));
    assert.equal((await response.json()).error, "invalid_email");
  }
  const huge = await login(server.base, "gestor@farmacia.test", "x".repeat(129));
  assert.equal(huge.status, 400);
  assert.equal((await huge.json()).error, "invalid_password");
  const wrongType = await fetch(`${server.base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: { $ne: "" }, password: ["x"] }),
  });
  assert.equal(wrongType.status, 400);
});

test("e-mail inexistente e senha errada respondem exatamente igual", async (context) => {
  const server = await start();
  context.after(server.close);
  const wrongPassword = await login(server.base, "gestor@farmacia.test", "senha-errada");
  const unknownUser = await login(server.base, "fantasma@farmacia.test", "senha-errada");
  assert.equal(wrongPassword.status, unknownUser.status);
  assert.equal(await wrongPassword.text(), await unknownUser.text());
});

test("alterações vindas de outro site são recusadas; do próprio portal passam", async (context) => {
  const server = await start({ publicBaseUrl: "https://portal.exemplo.test" });
  context.after(server.close);
  const session = await login(server.base, "gestor@farmacia.test", "senha-segura-123");
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const body = JSON.stringify({ name: "Produto", salePrice: 10, stock: 1 });
  const base = { method: "PUT", path: "/api/products/1", body };
  const headers = { cookie, "content-type": "application/json", "content-length": Buffer.byteLength(body) };

  assert.equal((await raw(server.port, { ...base, headers: { ...headers, "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await raw(server.port, { ...base, headers: { ...headers, origin: "https://site-malicioso.test" } })).status, 403);
  assert.equal((await raw(server.port, { ...base, headers: { ...headers, "sec-fetch-site": "same-site" } })).status, 403);
  assert.equal((await raw(server.port, { ...base, headers: { ...headers, "sec-fetch-site": "same-origin" } })).status, 202);
  assert.equal((await raw(server.port, { ...base, headers: { ...headers, origin: "https://portal.exemplo.test" } })).status, 202);
  assert.equal((await raw(server.port, { ...base, headers: { ...headers, origin: server.base } })).status, 202);
});

test("cabeçalhos de segurança estão presentes e nada revela a tecnologia", async (context) => {
  const server = await start({ secureCookies: true });
  context.after(server.close);
  const response = await raw(server.port, { path: "/" });
  const csp = response.headers["content-security-policy"];
  for (const rule of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests"]) {
    assert.ok(csp.includes(rule), `CSP sem: ${rule}`);
  }
  assert.ok(!/unsafe-inline.*script|script-src[^;]*unsafe-inline/.test(csp), "scripts inline não são permitidos");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.headers["strict-transport-security"], /max-age=31536000/);
  assert.match(response.headers["permissions-policy"], /camera=\(\)/);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("erros da API são sempre JSON curto, sem rastro técnico", async (context) => {
  const server = await start();
  context.after(server.close);

  const unknown = await fetch(`${server.base}/api/nao-existe`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "not_found" });

  const broken = await fetch(`${server.base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{quebrado",
  });
  assert.equal(broken.status, 400);
  const text = await broken.text();
  assert.deepEqual(JSON.parse(text), { error: "invalid_json" });
  assert.ok(!/SyntaxError|node_modules|\bat \w/.test(text));

  const missingAsset = await fetch(`${server.base}/assets/nao-existe.js`);
  assert.equal(missingAsset.status, 404);
  assert.ok(!/ENOENT|node_modules|C:\\/.test(await missingAsset.text()));
});
