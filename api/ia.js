// Recepcionista segura da IA
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Método não permitido" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Chave da IA não configurada no servidor." } });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const dados = await resposta.json();
    return res.status(resposta.status).json(dados);
  } catch (e) {
    return res.status(500).json({ error: { message: "Erro ao falar com a IA: " + (e && e.message ? e.message : "desconhecido") } });
  }
}
