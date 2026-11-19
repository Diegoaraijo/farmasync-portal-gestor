"use strict";

// Gera public/icons.js: só os ícones Lucide que o portal usa, no lugar do pacote completo (600 KB).
// Rode `node tools/build-icons.js` depois de usar um ícone novo; o teste test/icons.test.js avisa se esquecer.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const lucideEsm = path.join(root, "node_modules", "lucide", "dist", "esm");
const sourceFiles = [
  path.join(root, "src", "pages.js"),
  path.join(root, "src", "dashboard.js"),
  path.join(root, "src", "app.js"),
  path.join(root, "public", "app.js"),
  path.join(root, "public", "notes.js"),
  path.join(root, "public", "deliveries.js"),
];

// "arrow-right" -> "ArrowRight" (mesma regra do Lucide; apelidos como "filter" também existem nesse índice)
const toPascalCase = (name) => name.replace(/(^|-)([a-z0-9])/g, (_match, _dash, letter) => letter.toUpperCase());

async function loadAllIcons() {
  return import(pathToFileURL(path.join(lucideEsm, "iconsAndAliases.mjs")).href);
}

async function usedIconNames(all) {
  const names = new Set();
  for (const file of sourceFiles) {
    if (!fs.existsSync(file)) continue;
    for (const match of fs.readFileSync(file, "utf8").matchAll(/["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g)) {
      if (all[toPascalCase(match[1])]) names.add(match[1]);
    }
  }
  return [...names].sort();
}

async function buildIconsSource() {
  const all = await loadAllIcons();
  const icons = {};
  for (const name of await usedIconNames(all)) icons[name] = all[toPascalCase(name)];
  return `/* Ícones do portal: gerado por tools/build-icons.js a partir do Lucide (licença ISC). Não edite à mão. */
(function () {
  var ICONS = ${JSON.stringify(icons)};
  var NS = "http://www.w3.org/2000/svg";
  var DEFAULTS = { xmlns: NS, width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };

  function node(spec) {
    var element = document.createElementNS(NS, spec[0]);
    Object.keys(spec[1]).forEach(function (key) { element.setAttribute(key, String(spec[1][key])); });
    (spec[2] || []).forEach(function (child) { element.appendChild(node(child)); });
    return element;
  }

  function replace(element, extra) {
    var name = element.getAttribute("data-lucide");
    if (!name) return;
    var shape = ICONS[name];
    if (!shape) { console.warn("Ícone desconhecido: " + name); return; }
    var own = {};
    Array.prototype.forEach.call(element.attributes, function (attribute) { own[attribute.name] = attribute.value; });
    var labelled = Object.keys(own).some(function (key) { return key.indexOf("aria-") === 0 || key === "role" || key === "title"; });
    var attrs = Object.assign({}, DEFAULTS, { "data-lucide": name }, labelled ? {} : { "aria-hidden": "true" }, extra, own);
    var classes = ["lucide", "lucide-" + name].concat((own["class"] || "").split(" "), (extra["class"] || "").split(" "));
    attrs["class"] = classes.filter(function (item, index) { return item && classes.indexOf(item) === index; }).join(" ");
    if (element.parentNode) element.parentNode.replaceChild(node(["svg", attrs, shape]), element);
  }

  window.lucide = {
    createIcons: function (options) {
      var extra = (options && options.attrs) || {};
      Array.prototype.forEach.call(document.querySelectorAll("[data-lucide]"), function (element) { replace(element, extra); });
    },
  };
})();
`;
}

module.exports = { buildIconsSource };

if (require.main === module) {
  buildIconsSource().then((source) => {
    fs.writeFileSync(path.join(root, "public", "icons.js"), source);
    console.log(`public/icons.js gerado: ${Object.keys(JSON.parse(source.match(/var ICONS = (.*);\n/)[1])).length} ícones, ${Buffer.byteLength(source)} bytes`);
  });
}
