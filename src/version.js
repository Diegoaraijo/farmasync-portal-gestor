// A versão exibida no portal vem de um único lugar: o número maior do package.json.
const { version } = require("../package.json");

const PORTAL_VERSION = `v${String(version).split(".")[0]}`;

module.exports = { PORTAL_VERSION };
