// api/pix-status.js — consulta a cobrança no Asaas; pago = RECEIVED | CONFIRMED | RECEIVED_IN_CASH
// Front espera: { pago: true } quando o dinheiro cair. Qualquer erro → { pago:false } (polling continua).
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, pago: false });

  const TOKEN = process.env.ASAAS_API_KEY;
  if (!TOKEN) return res.status(200).json({ ok: false, pago: false, erro: "ASAAS_API_KEY não configurado" });

  const BASE = process.env.ASAAS_ENV === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";

  const id = String((req.query && req.query.id) || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 60);
  if (!id) return res.status(200).json({ ok: false, pago: false, erro: "id ausente" });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${BASE}/payments/${id}`, {
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "User-Agent": "FisioPiedeOS", access_token: TOKEN },
    });
    clearTimeout(t);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.status) return res.status(200).json({ ok: false, pago: false });

    const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(j.status);
    return res.status(200).json({ ok: true, pago, status: j.status });
  } catch (e) {
    return res.status(200).json({ ok: false, pago: false });
  }
}
