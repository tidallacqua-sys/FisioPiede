// ── Recepcionista segura da Transcrição (Whisper / OpenAI) ───────────────────
// Roda no servidor da Vercel. Guarda a chave da OpenAI escondida (variável de
// ambiente OPENAI_API_KEY) e repassa o áudio para o Whisper transcrever.
// A chave NUNCA aparece no navegador nem no GitHub.
//
// O navegador envia JSON: { audioBase64, mime, filename }
// Retorna: { text: "transcrição..." }  ou  { error: { message } }

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Método não permitido" } });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Chave de transcrição (OPENAI_API_KEY) não configurada no servidor." } });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const audioBase64 = body && body.audioBase64 ? body.audioBase64 : "";
    const mime = (body && body.mime) ? body.mime : "audio/webm";
    const filename = (body && body.filename) ? body.filename : "consulta.webm";
    if (!audioBase64) {
      return res.status(400).json({ error: { message: "Áudio não recebido." } });
    }

    // Reconstrói o arquivo de áudio a partir do base64
    const buffer = Buffer.from(audioBase64, "base64");
    const blob = new Blob([buffer], { type: mime });

    // Monta o formulário que o Whisper espera
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("model", "whisper-1");
    form.append("language", "pt");
    form.append("response_format", "json");

    const resposta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey },
      body: form,
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      const msg = (dados && dados.error && dados.error.message) ? dados.error.message : ("Erro " + resposta.status);
      return res.status(resposta.status).json({ error: { message: msg } });
    }
    return res.status(200).json({ text: dados.text || "" });
  } catch (e) {
    return res.status(500).json({ error: { message: "Erro ao transcrever: " + (e && e.message ? e.message : "desconhecido") } });
  }
}
