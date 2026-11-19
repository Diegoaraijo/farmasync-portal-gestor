const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createApp } = require("../src/app");
const { loginPage } = require("../src/pages");

const publicDir = path.join(__dirname, "..", "public");
const hashOf = (file) => crypto
  .createHash("sha1").update(fs.readFileSync(path.join(publicDir, file))).digest("hex").slice(0, 10);

test("a versão dos arquivos na página acompanha o conteúdo real deles", () => {
  const html = loginPage();
  assert.ok(html.includes(`/assets/styles.css?v=${hashOf("styles.css")}`));
  assert.ok(html.includes(`/assets/app.js?v=${hashOf("app.js")}`));
  assert.ok(html.includes(`/assets/icons.js?v=${hashOf("icons.js")}`));
  assert.ok(html.includes(`/assets/logo-mark.png?v=${hashOf("logo-mark.png")}`));
  assert.ok(html.includes(`/assets/favicon.png?v=${hashOf("favicon.png")}`));
  assert.ok(html.includes("noindex"), "o portal não deve aparecer em buscadores");
});

test("o atalho do celular usa o logo do FarmaSync: manifesto, ícones e apple-touch-icon", async (context) => {
  const html = loginPage();
  assert.ok(html.includes('rel="manifest" href="/manifest.webmanifest"'));
  assert.ok(html.includes(`/assets/apple-touch-icon.png?v=${hashOf("apple-touch-icon.png")}`));

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.short_name, "FarmaSync");
  assert.equal(manifest.start_url, "/");
  const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
  assert.deepEqual(sizes, ["192x192:any", "512x512:any"]);
  for (const icon of manifest.icons) {
    const file = await fetch(`${base}${icon.src}`);
    assert.equal(file.status, 200, icon.src);
    assert.equal(file.headers.get("content-type"), "image/png", icon.src);
  }
  for (const route of ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"]) {
    const touch = await fetch(`${base}${route}`);
    assert.equal(touch.status, 200, route);
    assert.equal(touch.headers.get("content-type"), "image/png", route);
  }
});

test("JS e CSS são revalidados a cada visita; imagens continuam em cache", async (context) => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const file of ["styles.css", "app.js", "icons.js"]) {
    const response = await fetch(`${base}/assets/${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get("cache-control"), "no-cache", file);
    assert.ok(response.headers.get("etag"), `${file} precisa de ETag para responder 304`);
  }
  const logo = await fetch(`${base}/assets/logo.png`);
  assert.match(logo.headers.get("cache-control"), /max-age=86400/);
});
