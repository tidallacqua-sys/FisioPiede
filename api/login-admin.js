// api/login-admin.js — Verificação do Admin Master NO SERVIDOR (FisioPiede)
// A senha do administrador vive apenas nas variáveis de ambiente da Vercel
// (Settings → Environment Variables): ADMIN_EMAIL e ADMIN_PASS.
// Ela nunca é enviada ao navegador e não aparece no código do app.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, erro: "metodo_nao_permitido" });
  }

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASS = process.env.ADMIN_PASS;

  // Variáveis ainda não criadas na Vercel — avisa o app de forma controlada
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    return res.status(500).json({ ok: false, erro: "nao_configurado" });
  }

  // Corpo da requisição (a Vercel já entrega JSON interpretado, mas tratamos string por garantia)
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const email = (body && typeof body.email === "string") ? body.email : "";
  const senha = (body && typeof body.senha === "string") ? body.senha : "";

  // Freio contra tentativas em massa (adivinhação de senha)
  await new Promise((r) => setTimeout(r, 450));

  const okEmail = email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
  const okSenha = senha === ADMIN_PASS;

  if (okEmail && okSenha) {
    return res.status(200).json({ ok: true, nome: "Admin Master" });
  }

  // Resposta idêntica para e-mail errado ou senha errada (não dá pistas)
  return res.status(200).json({ ok: false });
}
