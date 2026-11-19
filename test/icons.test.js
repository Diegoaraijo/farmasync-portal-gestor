"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildIconsSource } = require("../tools/build-icons");

const root = path.join(__dirname, "..");

test("public/icons.js está atualizado com os ícones usados pelo portal", async () => {
  const current = fs.readFileSync(path.join(root, "public", "icons.js"), "utf8");
  assert.equal(current, await buildIconsSource(), "rode: node tools/build-icons.js");
});

test("todo ícone pedido por nome fixo existe em icons.js", () => {
  const generated = fs.readFileSync(path.join(root, "public", "icons.js"), "utf8");
  for (const file of ["src/pages.js", "src/dashboard.js", "public/app.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/data-lucide="([a-z0-9-]+)"|dataset\.lucide\s*=\s*"([a-z0-9-]+)"|\bicon:\s*"([a-z0-9-]+)"/g)) {
      const name = match[1] || match[2] || match[3];
      assert.ok(generated.includes(`"${name}":[`), `ícone "${name}" (${file}) não está em public/icons.js`);
    }
  }
});

test("as páginas carregam o arquivo pequeno de ícones e não o pacote completo", () => {
  const pages = fs.readFileSync(path.join(root, "src", "pages.js"), "utf8");
  assert.match(pages, /\/assets\/icons\.js/);
  assert.doesNotMatch(pages, /\/vendor\/lucide\.js/);
});
