// /api/ghostops-diagnostic-ia.js

export const config = {
  api: {
    bodyParser: true, // on reste simple : JSON / urlencoded gérés par Next/Vercel
  },
};

function toCleanString(v) {
  return typeof v === "string" ? v.trim() : "";
}

export default async function handler(req, res) {
  // Autoriser uniquement le POST
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

  // Payload (comme le chat) : on lit req.body, point.
  const body = req.body || {};

  // Alignement “chat” :
  // - la page Diagnostic peut envoyer { message: "..." }
  // - l’API accepte aussi { description: "..." }
  const effectiveDescription = toCleanString(body.description) || toCleanString(body.message);

  const safeContexte = toCleanString(body.contexte);
  const safeEnjeu = toCleanString(body.enjeu);

  // Logs minimalistes (utiles en prod sans bruit excessif)
  console.log("[ghostops-diagnostic-ia] keys:", Object.keys(body || {}));
  console.log("[ghostops-diagnostic-ia] description length:", effectiveDescription.length);

  if (!effectiveDescription) {
    return res.status(400).json({
      error: 'Le champ "description" est obligatoire pour le diagnostic.',
      debug: { receivedKeys: Object.keys(body || {}) },
    });
  }

  // Prompts
  const systemPrompt = `
Tu es "GhostOps IA – Diagnostic", IA utilisée en back-office dans le produit payant
"GhostOps Diagnostic IA – 90 minutes".

Ta mission :
- produire une lecture tactique structurée d'une situation complexe
  (crise RH, dirigeant exposé, jeux de pouvoir internes, blocages de gouvernance,
   enjeux d'influence interne/externe),
- sans résoudre totalement le cas,
- et sans te substituer à un conseil humain (juridique, RH, gouvernance).

Règles :
- Réponds en français, ton formel, professionnel, sobre.
- Pas de conseil juridique formel, pas de stratégie procédurale détaillée, pas de qualification pénale.
- Aucune manœuvre illégale, représailles ou contournement de règles.
- Niveau "lecture tactique" : clarification, cartographie, options de lecture, questions structurantes.
- Style assumable devant un board (clair, dense, sans jargon creux).
- Termine par : "Ce pré-diagnostic ne remplace ni un avis juridique, ni un conseil RH individualisé, ni une mission GhostOps complète."
`.trim();

  const userPrompt = `
Tu vas produire un pré-diagnostic structuré à partir des éléments suivants.

Données fournies par l’utilisateur :

- Description principale :
"""${effectiveDescription}"""

- Contexte complémentaire (si présent) :
"""${safeContexte}"""

- Enjeux / risques perçus (si présent) :
"""${safeEnjeu}"""

Ta réponse doit suivre strictement la structure ci-dessous, avec les titres exacts :

1) Synthèse de la situation telle que je la comprends
2) Points de tension majeurs
3) Questions à clarifier en priorité lors du Diagnostic IA (90 min)
4) Première cartographie des risques (hors droit pur)
   4.1. Risques Humains / RH
   4.2. Risques de Gouvernance / Pouvoir
   4.3. Risques Narratifs / Réputation
5) Niveau de tension estimé (indication qualitative)
6) Conclusion et intérêt d’une séance GhostOps Diagnostic IA – 90 minutes

Contraintes :
- Synthétique et sélectif.
- Pas de plan d’exécution détaillé.
- Ne modifie pas les titres.
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

    // Extraction texte (Responses API)
    let reply = "Je n’ai pas pu générer de pré-diagnostic utile.";

    const out0 = data?.output?.[0];
    const outText =
      out0?.content?.find?.((c) => c?.type === "output_text")?.text ||
      out0?.content?.[0]?.text;

    if (typeof outText === "string" && outText.trim()) {
      reply = outText.trim();
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("[ghostops-diagnostic-ia] fatal:", err);
    return res.status(500).json({
      error: "Une erreur interne est survenue lors de l’appel au moteur GhostOps Diagnostic IA.",
    });
  }
}
