"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Lista que cresce com o uso (notas, entregas, campanhas...) precisa rolar dentro do próprio quadro em vez de esticar a página.
const GROWING_LISTS = [
  "notes-list", "delivery-settle-list", "campaign-list", "winner-list", "cash-session-list", "suspicious-occurrences-list",
];

test("o portal define a área rolável global e a aplica nas listas que crescem", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.scroll-area\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/);
  const pages = read("src/pages.js");
  for (const id of GROWING_LISTS) {
    const tag = pages.match(new RegExp(`<div id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `lista ${id} não encontrada em pages.js`);
    assert.match(tag, /class="[^"]*\bscroll-area\b/, `${id} deve usar scroll-area`);
    assert.match(tag, /tabindex="0"[^>]*role="region"[^>]*aria-label=/, `${id} deve ser focável e ter nome (acessibilidade)`);
  }
});
