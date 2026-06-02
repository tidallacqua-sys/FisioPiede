// ── Recepcionista segura do pagamento (Stripe) ───────────────────────────────
// Esta função roda no servidor da Vercel. Ela guarda a chave secreta da Stripe
// escondida (na variável de ambiente STRIPE_SECRET_KEY) e cria uma "sessão de
// pagamento" (Stripe Checkout) para a clínica assinar um plano com cartão.
// A chave secreta NUNCA aparece no navegador nem no GitHub.
//
// Como funciona o fluxo:
//   1. O sistema chama esta função dizendo qual plano a clínica quer.
//   2. Aqui criamos uma assinatura recorrente (mensal) na Stripe.
//   3. A Stripe devolve um link de pagamento (com a marca FisioPiede).
//   4. O sistema manda a clínica para esse link.
//   5. Depois de pagar, a clínica volta para o sistema.

// Preços dos planos (em centavos, porque a Stripe trabalha em centavos).
// Premium  = R$ 89,90  -> 8990 centavos
// Enterprise = R$ 149,90 -> 14990 centavos
const PLANOS = {
  "Premium":    { valorCentavos: 8990,  nome: "FisioPiede Premium" },
  "Enterprise": { valorCentavos: 14990, nome: "FisioPiede Enterprise" },
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
    // Endereço base do site para onde o cliente volta após pagar.
    const base = body.origem || "https://fisio-piede.vercel.app";

    const info = PLANOS[plano];
    if (!info) {
      return res.status(400).json({ error: { message: "Plano inválido para pagamento." } });
    }

    // Monta os campos da sessão de Checkout (formato que a Stripe espera:
    // application/x-www-form-urlencoded, com chaves "aninhadas").
    const params = new URLSearchParams();
    params.append("mode", "subscription"); // assinatura recorrente
    params.append("success_url", base + "/?pagamento=ok");
    params.append("cancel_url", base + "/?pagamento=cancelado");
    if (email) params.append("customer_email", email);

    // Item da assinatura: criamos o preço "na hora" (price_data), sem precisar
    // cadastrar produtos no painel da Stripe.
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "brl");
    params.append("line_items[0][price_data][product_data][name]", info.nome);
    params.append("line_items[0][price_data][unit_amount]", String(info.valorCentavos));
    params.append("line_items[0][price_data][recurring][interval]", "month");

    // Guardamos quem está assinando, para identificar no retorno/webhook.
    params.append("metadata[clinicaId]", clinicaId);
    params.append("metadata[clinicaNome]", clinicaNome);
    params.append("metadata[plano]", plano);
    params.append("subscription_data[metadata][clinicaId]", clinicaId);
    params.append("subscription_data[metadata][plano]", plano);

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

    // Devolve o link para onde o cliente deve ir pagar.
    return res.status(200).json({ url: dados.url });
  } catch (e) {
    return res.status(500).json({ error: { message: "Erro ao falar com a Stripe: " + (e && e.message ? e.message : "desconhecido") } });
  }
}
