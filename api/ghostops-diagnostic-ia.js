// /api/ghostops-diagnostic-ia.js
// Version : Diagnostic IA "premium" avec support d’itérations (5) + historique optionnel.
// Compatible avec votre front actuel (message seul) ET prêt pour envoyer un historique (body.history).

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

// --- Helpers historique (optionnel) ---
function clampText(s, maxChars) {
  const t = cleanStr(s);
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}

function normalizeHistory(rawHistory) {
  // Attend: [{role:'user'|'assistant', content:'...'}] (simple) — ou formats proches
  if (!Array.isArray(rawHistory)) return [];

  const out = [];
  for (const item of rawHistory) {
    const role = cleanStr(item?.role);
    const content =
      typeof item?.content === "string"
        ? item.content
        : typeof item?.text === "string"
          ? item.text
          : "";

    if ((role === "user" || role === "assistant" || role === "system") && cleanStr(content)) {
      out.push({ role, content: clampText(content, 3000) });
    }
  }

  // Limiter la taille globale (anti-timeout / anti-contexte énorme)
  // On garde la fin (plus récent)
  const MAX_TOTAL_CHARS = 12000;
  let total = 0;
  const trimmed = [];
  for (let i = out.length - 1; i >= 0; i--) {
    const msg = out[i];
    const len = msg.content.length + 20;
    if (total + len > MAX_TOTAL_CHARS) break;
    trimmed.push(msg);
    total += len;
  }
  return trimmed.reverse();
}

function hasAssistantInHistory(history) {
  return history.some((m) => m.role === "assistant");
}

function buildInputs({ systemPrompt, userPrompt, history }) {
  // On construit un input compatible Responses API :
  // system + historique (user/assistant) + prompt courant
  const input = [{ role: "system", content: systemPrompt }];

  for (const m of history) {
    // on évite d’injecter des "system" historiques
    if (m.role === "user" || m.role === "assistant") input.push({ role: m.role, content: m.content });
  }

  input.push({ role: "user", content: userPrompt });
  return input;
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

  // ✅ Modèles (meilleure qualité possible au 1er bloc)
  // - INITIAL : vous pouvez mettre "gpt-4.1" si vous voulez un rendu plus dense
  // - FOLLOWUP : "gpt-4.1-mini" pour les itérations (rapide)
  const modelInitial =
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL_INITIAL) ||
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL) ||
    "gpt-4.1-mini";

  const modelFollowup =
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL_FOLLOWUP) ||
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL) ||
    "gpt-4.1-mini";

  // ✅ Tokens de sortie
  const maxOut = Number(process.env.GHOSTOPS_DIAGNOSTIC_MAX_OUTPUT_TOKENS || "1110") || 1110;

  const contentType = req.headers["content-type"] || "";

  // --- Lecture body robuste ---
  let body = req.body && typeof req.body === "object" ? req.body : null;

  if (!body && typeof req.body === "string" && req.body.trim()) {
    body = safeJsonParse(req.body) || null;
  }

  let raw = "";
  if (!body) {
    raw = await readRaw(req);
    if (raw && raw.trim()) body = safeJsonParse(raw) || null;
  }

  body = body || {};

  // Champs compatibles "chat"
  const effectiveDescription = cleanStr(body.description) || cleanStr(body.message);
  const safeContexte = cleanStr(body.contexte);
  const safeEnjeu = cleanStr(body.enjeu);

  // Historique optionnel (pour itérations)
  const history = normalizeHistory(body.history || body.conversation || body.messages);
  const isFollowup = hasAssistantInHistory(history);

  const model = isFollowup ? modelFollowup : modelInitial;

  console.log("[ghostops-diagnostic-ia] model:", model);
  console.log("[ghostops-diagnostic-ia] max_output_tokens:", maxOut);
  console.log("[ghostops-diagnostic-ia] content-type:", contentType);
  console.log("[ghostops-diagnostic-ia] keys:", Object.keys(body || {}));
  console.log("[ghostops-diagnostic-ia] rawLen:", raw ? raw.length : 0);
  console.log("[ghostops-diagnostic-ia] descLen:", effectiveDescription.length);
  console.log("[ghostops-diagnostic-ia] historyLen:", history.length);
  console.log("[ghostops-diagnostic-ia] followup:", isFollowup);

  if (!effectiveDescription) {
    return res.status(400).json({
      error: 'Le champ "description" (ou "message") est obligatoire pour le diagnostic.',
      debug: {
        model,
        contentType,
        receivedKeys: Object.keys(body || {}),
        rawLen: raw ? raw.length : 0,
        rawSample: raw ? raw.slice(0, 200) : "",
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
- Niveau "lecture tactique" : clarification, cartographie, options, priorités, conditions de succès.
- Style assumable devant un board : dense, concret, sans jargon creux.
- Quand tu proposes des options, donne : intention / bénéfice / risque / condition de succès.
- Termine par : "Ce pré-diagnostic ne remplace ni un avis juridique, ni un conseil RH individualisé, ni une mission GhostOps complète."
`.trim();

  // --- Prompt initial vs itération ---
  const userPromptInitial = `
Tu vas produire un pré-diagnostic structuré à partir des éléments suivants.

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

Exigences de niveau (obligatoires) :
- Chaque section contient 3 à 7 puces concrètes.
- Inclure 2 à 3 options de lecture (A/B/C) avec bénéfices/risques/conditions.
- Inclure une mini-liste "Décisions / priorités à 10 jours" (3 à 5 points) dans la section 6.

Contraintes :
- Synthétique et sélectif, mais dense.
- Pas de plan d’exécution détaillé.
- Si limite de longueur : terminer proprement puis ajouter "— FIN TRONQUÉE (demander la suite)".
`.trim();

  const userPromptFollowup = `
Nous sommes en itération d’approfondissement (session Diagnostic IA).

Contexte (historique) : utilise l’historique fourni pour rester cohérent.
Nouvelle question / précision de l’utilisateur :
"""${effectiveDescription}"""

Règles de réponse (obligatoires) :
- Réponds en profondeur, orienté décision.
- Ne réécris pas toute la note : réponds à la question en 3 blocs maximum :
  A) Ce que cela change dans la lecture (impact sur risques / tensions / hypothèses)
  B) Options / arbitrages (2 à 3 options A/B/C avec conditions de succès)
  C) Questions de clarification (3 à 7 questions ciblées) + "prochaine meilleure question" à poser

Contraintes :
- Pas d’avis juridique formel, pas de qualification pénale.
- Si limite de longueur : terminer proprement puis ajouter "— FIN TRONQUÉE (demander la suite)".
`.trim();

  const userPrompt = isFollowup ? userPromptFollowup : userPromptInitial;

  // ✅ Timeout explicite
  const OPENAI_TIMEOUT_MS = Number(process.env.GHOSTOPS_OPENAI_TIMEOUT_MS || "35000") || 35000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const input = buildInputs({ systemPrompt, userPrompt, history });

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: maxOut,
      }),
    });

    let data = {};
    try {
      data = await openaiResponse.json();
    } catch {
      return res.status(502).json({
        error: "Réponse non-JSON reçue depuis OpenAI.",
        debug: { model, openaiStatus: openaiResponse.status },
      });
    }

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error:
          data?.error?.message ||
          data?.message ||
          `Erreur OpenAI (HTTP ${openaiResponse.status})`,
        debug: {
          model,
          openaiStatus: openaiResponse.status,
          openaiType: data?.error?.type || "",
          openaiCode: data?.error?.code || "",
        },
      });
    }

    const reply = extractReplyFromResponsesApi(data);
    if (!reply) {
      return res.status(502).json({
        error: "Réponse OpenAI reçue, mais texte introuvable.",
        debug: { model },
      });
    }

    return res.status(200).json({
      reply,
      meta: {
        followup: isFollowup,
        model,
        historyUsed: history.length,
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({
        error:
          "Temps de génération dépassé. Veuillez réessayer (ou réduire la longueur de votre description).",
        debug: { model, timeoutMs: OPENAI_TIMEOUT_MS, max_output_tokens: maxOut },
      });
    }

    console.error("[ghostops-diagnostic-ia] fatal:", err);
    return res.status(500).json({
      error: "Erreur interne lors de l’appel au moteur GhostOps Diagnostic IA.",
      debug: { model, message: err?.message || String(err) },
    });
  } finally {
    clearTimeout(t);
  }
}
