// ── Recepcionista segura do pagamento (Stripe) ───────────────────────────────
// Roda no servidor da Vercel. Guarda a chave secreta (STRIPE_SECRET_KEY) escondida
// e cria uma "sessão de pagamento" (Stripe Checkout) com a marca FisioPiede.
// A chave secreta NUNCA aparece no navegador nem no GitHub.
//
// Dois modelos de cobrança:
//   • Premium    -> ASSINATURA mensal (cobra R$ 89,90 todo mês, automático).
//   • Enterprise -> PAGAMENTO anual único de R$ 2.998, que o cliente pode
//                   PARCELAR em até 12x no cartão (installments do Stripe Brasil).
//
// IMPORTANTE: o parcelamento (installments) só aparece para o cliente se a sua
// conta Stripe brasileira estiver HABILITADA para parcelamento. Isso é uma
// configuração/solicitação feita por você no painel da Stripe — não dá para
// ativar por código.

const PLANOS = {
  "Premium":    { valorCentavos: 8990,   nome: "FisioPiede Premium",    modo: "subscription" },
  "Enterprise": { valorCentavos: 299800, nome: "FisioPiede Enterprise (anual)", modo: "payment", parcelas: 12 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Método não permitido" } });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Chave da Stripe não configurada no servidor." } });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const plano = body.plano;
    const clinicaId = body.clinicaId || "";
    const clinicaNome = body.clinicaNome || "";
    const email = body.email || "";
    const base = body.origem || "https://fisio-piede.vercel.app";

    // ── Pagamento avulso: fechamento de pedidos da clínica (cartão, com 5% já incluso) ──
    if (body.valorCentavos && Number(body.valorCentavos) > 0) {
      const valor = Math.round(Number(body.valorCentavos));
      const p = new URLSearchParams();
      p.append("mode", "payment");
      p.append("success_url", base + "/?pagamento=ok");
      p.append("cancel_url", base + "/?pagamento=cancelado");
      if (email) p.append("customer_email", email);
      p.append("line_items[0][quantity]", "1");
      p.append("line_items[0][price_data][currency]", "brl");
      p.append("line_items[0][price_data][product_data][name]", body.descricao || "Fechamento FisioPiede");
      p.append("line_items[0][price_data][unit_amount]", String(valor));
      p.append("payment_method_types[0]", "card");
      p.append("payment_method_options[card][installments][enabled]", "true");
      p.append("metadata[clinicaId]", clinicaId);
      p.append("metadata[tipo]", "fechamento");
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/x-www-form-urlencoded" },
        body: p.toString(),
      });
      const d = await r.json();
      if (!r.ok) {
        const msg = d && d.error && d.error.message ? d.error.message : "Erro ao criar pagamento.";
        return res.status(r.status).json({ error: { message: msg } });
      }
      return res.status(200).json({ url: d.url });
    }

    const info = PLANOS[plano];
    if (!info) {
      return res.status(400).json({ error: { message: "Plano inválido para pagamento." } });
    }

    const params = new URLSearchParams();
    params.append("mode", info.modo); // "subscription" (Premium) ou "payment" (Enterprise)
    params.append("success_url", base + "/?pagamento=ok");
    params.append("cancel_url", base + "/?pagamento=cancelado");
    if (email) params.append("customer_email", email);

    // Item cobrado: criamos o preço "na hora" (price_data), sem cadastrar produtos.
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "brl");
    params.append("line_items[0][price_data][product_data][name]", info.nome);
    params.append("line_items[0][price_data][unit_amount]", String(info.valorCentavos));

    if (info.modo === "subscription") {
      // Assinatura recorrente mensal (Premium).
      params.append("line_items[0][price_data][recurring][interval]", "month");
      params.append("subscription_data[metadata][clinicaId]", clinicaId);
      params.append("subscription_data[metadata][plano]", plano);
    } else {
      // Pagamento único (Enterprise) com PARCELAMENTO no cartão.
      params.append("payment_method_types[0]", "card");
      params.append("payment_method_options[card][installments][enabled]", "true");
      params.append("payment_intent_data[metadata][clinicaId]", clinicaId);
      params.append("payment_intent_data[metadata][plano]", plano);
    }

    // Identifica quem está pagando (para o retorno/webhook).
    params.append("metadata[clinicaId]", clinicaId);
    params.append("metadata[clinicaNome]", clinicaNome);
    params.append("metadata[plano]", plano);

    const resposta = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      const msg = dados && dados.error && dados.error.message ? dados.error.message : "Erro ao criar pagamento.";
      return res.status(resposta.status).json({ error: { message: msg } });
    }

    return res.status(200).json({ url: dados.url });
  } catch (e) {
    return res.status(500).json({ error: { message: "Erro ao falar com a Stripe: " + (e && e.message ? e.message : "desconhecido") } });
  }
}
