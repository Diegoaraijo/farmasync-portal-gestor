const nodemailer = require("nodemailer");

function createPasswordResetMailer(config) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  return {
    async sendPasswordReset({ to, name, resetUrl }) {
      const greeting = name ? `Olá, ${name}.` : "Olá.";
      await transporter.sendMail({
        from: config.from,
        to,
        subject: "Redefina sua senha do Portal Gestor",
        text: `${greeting}\n\nUse o link abaixo para criar uma nova senha. Ele expira em 15 minutos e só pode ser usado uma vez.\n\n${resetUrl}\n\nSe você não solicitou a alteração, ignore esta mensagem.`,
        html: `<p>${escapeHtml(greeting)}</p><p>Use o botão abaixo para criar uma nova senha. O link expira em 15 minutos e só pode ser usado uma vez.</p><p><a href="${escapeHtml(resetUrl)}">Criar nova senha</a></p><p>Se você não solicitou a alteração, ignore esta mensagem.</p>`,
      });
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

module.exports = { createPasswordResetMailer };