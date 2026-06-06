// ── Recepcionista segura da Geração de Imagem (DALL·E / OpenAI) ──────────────
// Roda no servidor da Vercel. Usa a chave OPENAI_API_KEY (a mesma da transcrição)
// para gerar imagens de marketing. A chave NUNCA aparece no navegador.
//
// Recebe JSON: { prompt }
// Retorna: { b64: "<imagem em base64>" }  ou  { error: { message } }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Método não permitido" } });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Chave (OPENAI_API_KEY) não configurada no servidor." } });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const prompt = body && body.prompt ? String(body.prompt).slice(0, 900) : "";
    if (!prompt) {
      return res.status(400).json({ error: { message: "Descreva a imagem que deseja gerar." } });
    }

    const resposta = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "high",
      }),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      const msg = (dados && dados.error && dados.error.message) ? dados.error.message : ("Erro " + resposta.status);
      return res.status(resposta.status).json({ error: { message: msg } });
    }
    const item = dados && dados.data && dados.data[0] ? dados.data[0] : {};
    // Alguns modelos devolvem b64_json; outros devolvem uma URL temporária.
    if (item.b64_json) {
      return res.status(200).json({ b64: item.b64_json });
    }
    if (item.url) {
      return res.status(200).json({ url: item.url });
    }
    return res.status(500).json({ error: { message: "A imagem não foi retornada pela IA." } });
  } catch (e) {
    return res.status(500).json({ error: { message: "Erro ao gerar imagem: " + (e && e.message ? e.message : "desconhecido") } });
  }
}
