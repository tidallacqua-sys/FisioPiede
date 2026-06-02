// ── Ouvinte de pagamentos da Stripe (webhook) ────────────────────────────────
// Quando um pagamento é confirmado, a Stripe envia um aviso para este endereço.
// Aqui nós:
//   1. Confirmamos que o aviso veio mesmo da Stripe (assinatura secreta).
//   2. Descobrimos qual clínica pagou (pelo clinicaId que mandamos no metadata).
//   3. Atualizamos o plano dela no banco (Supabase): plano, ativação e vencimento.
//
// Variáveis de ambiente necessárias na Vercel:
//   STRIPE_SECRET_KEY          -> a mesma chave secreta usada no checkout
//   STRIPE_WEBHOOK_SECRET      -> o "Signing secret" do webhook (whsec_...)
//   SUPABASE_URL               -> URL do Supabase
//   SUPABASE_KEY               -> chave do Supabase (a publishable já usada no app)

import crypto from "crypto";

// IMPORTANTE: o webhook precisa do corpo "cru" (sem o Vercel transformar em JSON),
// senão a verificação da assinatura falha. Esta config desliga o parser automático.
export const config = { api: { bodyParser: false } };

// Lê o corpo cru da requisição.
function lerCorpoCru(req) {
  return new Promise((resolve, reject) => {
    let dados = "";
    req.on("data", (chunk) => (dados += chunk));
    req.on("end", () => resolve(dados));
    req.on("error", reject);
  });
}

// Confere a assinatura que a Stripe envia no cabeçalho "stripe-signature".
// Retorna true se for legítima.
function assinaturaValida(corpoCru, cabecalhoSig, segredo) {
  try {
    if (!cabecalhoSig || !segredo) return false;
    const partes = {};
    cabecalhoSig.split(",").forEach((p) => {
      const [k, v] = p.split("=");
      partes[k] = v;
    });
    const t = partes["t"];
    const v1 = partes["v1"];
    if (!t || !v1) return false;
    const assinado = t + "." + corpoCru;
    const esperado = crypto.createHmac("sha256", segredo).update(assinado, "utf8").digest("hex");
    // Comparação segura (tempo constante)
    const a = Buffer.from(esperado);
    const b = Buffer.from(v1);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// ─── Acesso ao banco (mesma tabela key-value app_data do app) ─────────────────
const SUPA_URL = process.env.SUPABASE_URL || "https://shlzwumixwpjxnrrnmwh.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_TpOZa39-UJWpFL3Uyjrrxg_NexIUp28";

function supaHeaders() {
  return {
    apikey: SUPA_KEY,
    Authorization: "Bearer " + SUPA_KEY,
    "Content-Type": "application/json",
  };
}

async function dbGet(chave) {
  const r = await fetch(`${SUPA_URL}/rest/v1/app_data?chave=eq.${encodeURIComponent(chave)}&select=valor`, { headers: supaHeaders() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0].valor : null;
}

async function dbSet(chave, valor) {
  await fetch(`${SUPA_URL}/rest/v1/app_data`, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ chave, valor }),
  });
}

// Calcula o vencimento: Premium soma 1 mês, Enterprise soma 12 meses.
function calcularVencimento(plano, dataBaseISO) {
  const d = new Date(dataBaseISO || Date.now());
  const meses = plano === "Enterprise" ? 12 : 1;
  d.setMonth(d.getMonth() + meses);
  return d.toISOString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const segredo = process.env.STRIPE_WEBHOOK_SECRET;
  const corpoCru = await lerCorpoCru(req);
  const sig = req.headers["stripe-signature"];

  // 1) Validação de segurança: o aviso veio mesmo da Stripe?
  if (!assinaturaValida(corpoCru, sig, segredo)) {
    return res.status(400).json({ error: "Assinatura inválida" });
  }

  let evento;
  try {
    evento = JSON.parse(corpoCru);
  } catch (e) {
    return res.status(400).json({ error: "Corpo inválido" });
  }

  // 2) Só agimos quando o pagamento da assinatura foi concluído.
  try {
    const tipo = evento.type;
    if (tipo === "checkout.session.completed") {
      const sessao = evento.data && evento.data.object ? evento.data.object : {};
      const meta = sessao.metadata || {};
      const clinicaId = meta.clinicaId;
      const plano = meta.plano;

      if (clinicaId && plano) {
        // 3) Atualiza a clínica no banco.
        const clinicas = (await dbGet("fp:clinicas")) || [];
        const agora = new Date().toISOString();
        const novaLista = clinicas.map((c) => {
          if (String(c.id) === String(clinicaId)) {
            return {
              ...c,
              plano: plano,
              dataAtivacao: agora,
              dataVencimento: calcularVencimento(plano, agora),
              statusManual: "", // remove qualquer suspensão/bloqueio manual
              stripeAtivo: true,
            };
          }
          return c;
        });
        await dbSet("fp:clinicas", novaLista);
      }
    }
    // Sempre respondemos 200 para a Stripe saber que recebemos.
    return res.status(200).json({ recebido: true });
  } catch (e) {
    // Mesmo em erro interno, evitamos reenvios infinitos da Stripe.
    return res.status(200).json({ recebido: true, aviso: "erro interno tratado" });
  }
}
