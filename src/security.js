const crypto = require("node:crypto");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (String(password || "").length < 10) {
    throw new Error("A senha deve ter pelo menos 10 caracteres.");
  }
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function hashTemporaryPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (!/^\d{6}$/.test(String(password || ""))) {
    throw new Error("A senha temporária deve conter exatamente 6 números.");
  }
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  try {
    const actual = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"));
    const expected = Buffer.from(String(expectedHash));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_error) {
    return false;
  }
}

module.exports = { hashPassword, hashTemporaryPassword, verifyPassword };