// /api/ghostops-diagnostic-ia.js

async function readRaw(req) {
  return await new Promise((resolve, reject) => {
    try {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY non configurée sur le serveur (Vercel > Variables d’environnement).",
    });
  }

  const contentType = req.headers["content-type"] || "";

  // 1) Tentative body déjà parsé
  let body = (req.body && typeof req.body === "object") ? req.body : null;

  // 2) Si req.body est une string JSON (ça arrive selon runtime)
  if (!body && typeof req.body === "string" && req.body.trim()) {
    try { body = JSON.parse(req.body); } catch { body = null; }
  }

  // 3) Sinon, lecture brute
  let raw = "";
  if (!body) {
    raw = await readRaw(req);
    if (raw && raw.trim()) {
      try { body = JSON.parse(raw); } catch { body = null; }
    }
  }

  body = body || {};

  const effectiveDescription = cleanStr(body.description) || cleanStr(body.message);
  const safeContexte = cleanStr(body.contexte);
  const safeEnjeu = cleanStr(body.enjeu);

  console.log("[ghostops-diagnostic-ia] content-type:", contentType);
  console.log("[ghostops-diagnostic-ia] keys:", Object.keys(body || {}));
  console.log("[ghostops-diagnostic-ia] rawLen:", raw ? raw.length : 0);
  console.log("[ghostops-diagnostic-ia] descLen:", effectiveDescription.length);

  if (!effectiveDescription) {
    return res.status(400).json({
      error: 'Le champ "description" est obligatoire pour le diagnostic.',
      debug: {
        contentType,
        receivedKeys: Object.keys(body || {}),
        rawLen: raw ? raw.length : 0,
        rawSample: raw ? raw.slice(0, 300) : "",
      },
    });
  }

  const systemPrompt = `
Tu es "GhostOps IA – Diagnostic", IA utilisée en back-office dans le produit payant
"GhostOps Diagnostic IA – 90 minutes".

Règles :
- Réponds en français, ton formel, professionnel, sobre.
- Pas de conseil juridique formel, pas de stratégie procédurale détaillée, pas de qualification pénale.
- Aucune manœuvre illégale, représailles ou contournement de règles.
- Niveau "lecture tactique" : clarification, cartographie, options de lecture, questions structurantes.
- Style assumable devant un board.
- Termine par : "Ce pré-diagnostic ne remplace ni un avis juridique, ni un conseil RH individualisé, ni une mission GhostOps complète."
`.trim();

  const userPrompt = `
- Description principale :
"""${effectiveDescription}"""

- Contexte complémentaire (si présent) :
"""${safeContexte}"""

- Enjeux / risques perçus (si présent) :
"""${safeEnjeu}"""

Structure obligatoire (titres exacts) :
1) Synthèse de la situation telle que je la comprends
2) Points de tension majeurs
3) Questions à clarifier en priorité lors du Diagnostic IA (90 min)
4) Première cartographie des risques (hors droit pur)
   4.1. Risques Humains / RH
   4.2. Risques de Gouvernance / Pouvoir
   4.3. Risques Narratifs / Réputation
5) Niveau de tension estimé (indication qualitative)
6) Conclusion et intérêt d’une séance GhostOps Diagnostic IA – 90 minutes
`.trim();

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_output_tokens: 1100,
      }),
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error("[ghostops-diagnostic-ia] OpenAI error:", data);
      return res.status(openaiResponse.status).json({
        error: data?.error?.message || `Erreur OpenAI (HTTP ${openaiResponse.status})`,
      });
    }

    const out0 = data?.output?.[0];
    const reply =
      out0?.content?.find?.((c) => c?.type === "output_text")?.text ||
      out0?.content?.[0]?.text ||
      "Je n’ai pas pu générer de pré-diagnostic utile.";

    return res.status(200).json({ reply: String(reply).trim() });
  } catch (err) {
    console.error("[ghostops-diagnostic-ia] fatal:", err);
    return res.status(500).json({
      error: "Une erreur interne est survenue lors de l’appel au moteur GhostOps Diagnostic IA.",
    });
  }
}
