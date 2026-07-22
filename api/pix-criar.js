// api/pix-criar.js — cria cobrança Pix dinâmica no Asaas e devolve QR + copia-cola
// Front espera: { ok:true, id, qrBase64, copiaCola }. Sem chave/erro → { ok:false } (fallback estático).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, erro: "Método não permitido" });

  const TOKEN = process.env.ASAAS_API_KEY;
  if (!TOKEN) return res.status(200).json({ ok: false, erro: "ASAAS_API_KEY não configurado" });

  const BASE = process.env.ASAAS_ENV === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";

  // fetch com timeout — nunca deixar a função pendurada
  const call = async (url, opts = {}, ms = 20000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        ...opts,
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "FisioPiedeOS",
          access_token: TOKEN,
          ...(opts.headers || {}),
        },
      });
      clearTimeout(t);
      const j = await r.json().catch(() => null);
      return { status: r.status, ok: r.ok, j };
    } catch (e) {
      clearTimeout(t);
      return { status: 0, ok: false, j: null, erro: String((e && e.name) || e) };
    }
  };

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const v = Math.round(Number(b.valor) * 100) / 100;
    if (!v || !isFinite(v) || v <= 0 || v > 500000)
      return res.status(200).json({ ok: false, erro: "Valor inválido" });

    const clinica = String(b.clinica || "").slice(0, 120).trim() || "Clínica FisioPiede";
    const clinicaRef = String(b.clinicaRef || "").slice(0, 60).trim();
    const descricao = String(b.descricao || "FisioPiede").slice(0, 250);
    const referencia = String(b.referencia || "").slice(0, 60);

    // 1) achar/criar o cliente pelo externalReference = clinicaRef
    let customerId = null;
    if (clinicaRef) {
      const busca = await call(`${BASE}/customers?externalReference=${encodeURIComponent(clinicaRef)}&limit=1`);
      if (busca.ok && busca.j && Array.isArray(busca.j.data) && busca.j.data[0]) customerId = busca.j.data[0].id;
    }
    if (!customerId) {
      const novo = await call(`${BASE}/customers`, {
        method: "POST",
        body: JSON.stringify({ name: clinica, externalReference: clinicaRef || undefined }),
      });
      if (novo.ok && novo.j && novo.j.id) customerId = novo.j.id;
    }
    if (!customerId)
      return res.status(200).json({ ok: false, erro: "Não consegui criar/achar o cliente no Asaas" });

    // 2) criar a cobrança Pix (vencimento hoje)
    const hoje = new Date().toISOString().slice(0, 10);
    const pg = await call(`${BASE}/payments`, {
      method: "POST",
      headers: { "X-Idempotency-Key": `fp-${clinicaRef || "x"}-${referencia || "x"}-${Date.now()}` },
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: v,
        dueDate: hoje,
        description: descricao,
        externalReference: referencia || clinicaRef || undefined,
      }),
    });
    if (!pg.ok || !pg.j || !pg.j.id) {
      const det = pg.j && pg.j.errors && pg.j.errors[0] && pg.j.errors[0].description;
      return res.status(200).json({ ok: false, erro: det || "Falha ao criar a cobrança no Asaas" });
    }

    // 3) buscar o QR dinâmico (com 1 re-tentativa — às vezes leva 1s pra ficar pronto)
    let qr = await call(`${BASE}/payments/${pg.j.id}/pixQrCode`);
    if (!qr.ok || !qr.j || !qr.j.payload) {
      await new Promise((r) => setTimeout(r, 1200));
      qr = await call(`${BASE}/payments/${pg.j.id}/pixQrCode`);
    }
    if (!qr.ok || !qr.j || !qr.j.payload)
      return res.status(200).json({ ok: false, erro: "Cobrança criada, mas o QR não veio — tente de novo" });

    return res.status(200).json({
      ok: true,
      id: pg.j.id,
      qrBase64: qr.j.encodedImage || "",
      copiaCola: qr.j.payload,
      valor: v,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: "Erro inesperado no pix-criar" });
  }
}
