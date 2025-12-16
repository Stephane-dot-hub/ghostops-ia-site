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

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractReplyFromResponsesApi(data) {
  const out0 = data?.output?.[0];
  if (!out0?.content) return "";

  const hit =
    out0.content.find?.((c) => c?.type === "output_text" && typeof c?.text === "string") ||
    out0.content[0];

  if (typeof hit?.text === "string") return hit.text.trim();
  return "";
}

function safePreview(value, maxLen = 300) {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  } catch {
    return "";
  }
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

  // ✅ Modèle (par défaut), surcharge possible via env
  const model = cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL) || "gpt-5-mini";
  const contentType = req.headers["content-type"] || "";

  // --- Lecture body robuste ---
  let body = req.body && typeof req.body === "object" ? req.body : null;

  if (!body && typeof req.body === "string" && req.body.trim()) {
    body = safeJsonParse(req.body) || null;
  }

  let raw = "";
  if (!body) {
    raw = await readRaw(req);
    if (raw && raw.trim()) {
      body = safeJsonParse(raw) || null;
    }
  }

  body = body || {};

  const effectiveDescription = cleanStr(body.description) || cleanStr(body.message);
  const safeContexte = cleanStr(body.contexte);
  const safeEnjeu = cleanStr(body.enjeu);

  console.log("[ghostops-diagnostic-ia] model:", model);
  console.log("[ghostops-diagnostic-ia] content-type:", contentType);
  console.log("[ghostops-diagnostic-ia] keys:", Object.keys(body || {}));
  console.log("[ghostops-diagnostic-ia] rawLen:", raw ? raw.length : 0);
  console.log("[ghostops-diagnostic-ia] descLen:", effectiveDescription.length);

  if (!effectiveDescription) {
    return res.status(400).json({
      error: 'Le champ "description" est obligatoire pour le diagnostic.',
      debug: {
        model,
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
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_output_tokens: 1100,
      }),
    });

    let data = {};
    try {
      data = await openaiResponse.json();
    } catch (e) {
      // Réponse non-JSON (rare), on remonte un message exploitable
      return res.status(502).json({
        error: "Réponse non-JSON reçue depuis OpenAI.",
        debug: {
          model,
          openaiStatus: openaiResponse.status,
          openaiStatusText: openaiResponse.statusText,
        },
      });
    }

    if (!openaiResponse.ok) {
      // ✅ on renvoie un debug utile (sans exposer la clé)
      const errMsg =
        data?.error?.message ||
        data?.message ||
        `Erreur OpenAI (HTTP ${openaiResponse.status})`;

      return res.status(openaiResponse.status).json({
        error: errMsg,
        debug: {
          model,
          openaiStatus: openaiResponse.status,
          openaiType: data?.error?.type || data?.type || "",
          openaiCode: data?.error?.code || data?.code || "",
          // petit extrait pour compréhension (évite d’inonder)
          openaiPreview: safePreview(data, 400),
        },
      });
    }

    const reply =
      extractReplyFromResponsesApi(data) || "Je n’ai pas pu générer de pré-diagnostic utile.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("[ghostops-diagnostic-ia] fatal:", err);
    return res.status(500).json({
      error: "Une erreur interne est survenue lors de l’appel au moteur GhostOps Diagnostic IA.",
      debug: {
        model,
        contentType,
        message: err?.message || String(err),
      },
    });
  }
}
