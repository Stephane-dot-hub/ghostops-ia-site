// /api/ghostops-diagnostic-ia.js
// Version sécurisée : Stripe cs_id -> token signé (TTL + itérations) -> décrément serveur.
// Compatible avec votre front actuel (message seul) + prêt pour history (body.history).
//
// Attendus côté front (recommandé) :
// - 1er appel après paiement : envoyer cs_id (depuis l’URL) + message
// - appels suivants : envoyer sessionToken + message (+ history si vous l’ajoutez)
// Le serveur renvoie toujours { reply, sessionToken, itersLeft, expiresAt, meta }

const Stripe = require("stripe");

// -------------------------
// Utils lecture body
// -------------------------
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

// -------------------------
// Historique optionnel
// -------------------------
function clampText(s, maxChars) {
  const t = cleanStr(s);
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}

function normalizeHistory(rawHistory) {
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

    if ((role === "user" || role === "assistant") && cleanStr(content)) {
      out.push({ role, content: clampText(content, 3000) });
    }
  }

  // garde la fin (plus récent) – limite taille globale
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
  const input = [{ role: "system", content: systemPrompt }];
  for (const m of history) input.push({ role: m.role, content: m.content });
  input.push({ role: "user", content: userPrompt });
  return input;
}

// -------------------------
// Token signé (HMAC)
// -------------------------
const crypto = require("crypto");

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecodeToString(s) {
  const pad = 4 - (s.length % 4 || 4);
  const base64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function hmacSha256(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

function signToken(payloadObj, secret) {
  const payloadJson = JSON.stringify(payloadObj);
  const payload = b64urlEncode(payloadJson);
  const sig = b64urlEncode(hmacSha256(secret, payload));
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "bad_format" };

  const [payload, sig] = parts;
  const expected = b64urlEncode(hmacSha256(secret, payload));
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: "bad_signature" };
  }

  let obj = null;
  try {
    obj = JSON.parse(b64urlDecodeToString(payload));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  return { ok: true, payload: obj };
}

// -------------------------
// Stripe verification
// -------------------------
async function verifyStripeCheckoutSession({ stripe, csId }) {
  const id = cleanStr(csId);
  if (!id) return { ok: false, reason: "missing_cs_id" };

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(id);
  } catch (e) {
    return { ok: false, reason: "stripe_retrieve_failed", message: e?.message || String(e) };
  }

  // Conditions minimales
  const paid = session?.payment_status === "paid";
  const complete = session?.status === "complete" || session?.status === "complete";
  // Stripe renvoie souvent status='complete' pour checkout session finalisée.
  // On accepte "paid" comme signal principal.
  if (!paid) {
    return { ok: false, reason: "not_paid", status: session?.status, payment_status: session?.payment_status };
  }

  return {
    ok: true,
    session: {
      id: session.id,
      payment_status: session.payment_status,
      status: session.status,
      created: session.created,
      expires_at: session.expires_at || null,
      metadata: session.metadata || {},
      customer_email: session.customer_details?.email || null,
    },
  };
}

// -------------------------
// Handler
// -------------------------
module.exports = async function handler(req, res) {
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

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({
      error: "STRIPE_SECRET_KEY non configurée (Vercel > Variables d’environnement).",
    });
  }

  const tokenSecret = cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_TOKEN_SECRET);
  if (!tokenSecret) {
    return res.status(500).json({
      error:
        "GHOSTOPS_DIAGNOSTIC_TOKEN_SECRET manquant. Ajoutez une clé longue et aléatoire dans Vercel (Variables d’environnement).",
    });
  }

  const stripe = new Stripe(stripeSecretKey);

  // Paramètres session
  const MAX_ITERS = Number(process.env.GHOSTOPS_DIAGNOSTIC_MAX_ITERS || "5") || 5;
  const TTL_SECONDS =
    Number(process.env.GHOSTOPS_DIAGNOSTIC_SESSION_TTL_SECONDS || "7200") || 7200; // 2h par défaut

  // Modèles
  const modelInitial =
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL_INITIAL) ||
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL) ||
    "gpt-4.1-mini";

  const modelFollowup =
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL_FOLLOWUP) ||
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_MODEL) ||
    "gpt-4.1-mini";

  const maxOut = Number(process.env.GHOSTOPS_DIAGNOSTIC_MAX_OUTPUT_TOKENS || "1110") || 1110;

  // Timeout OpenAI
  const OPENAI_TIMEOUT_MS = Number(process.env.GHOSTOPS_OPENAI_TIMEOUT_MS || "35000") || 35000;

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

  // Champs message
  const effectiveDescription = cleanStr(body.description) || cleanStr(body.message);
  const safeContexte = cleanStr(body.contexte);
  const safeEnjeu = cleanStr(body.enjeu);

  // Historique optionnel
  const history = normalizeHistory(body.history || body.conversation || body.messages);
  const isFollowupFromHistory = hasAssistantInHistory(history);

  // Sécurité session
  const csId = cleanStr(body.cs_id || body.csId);
  const incomingToken = cleanStr(body.sessionToken || body.token);

  console.log("[ghostops-diagnostic-ia] content-type:", contentType);
  console.log("[ghostops-diagnostic-ia] keys:", Object.keys(body || {}));
  console.log("[ghostops-diagnostic-ia] rawLen:", raw ? raw.length : 0);
  console.log("[ghostops-diagnostic-ia] descLen:", effectiveDescription.length);
  console.log("[ghostops-diagnostic-ia] historyLen:", history.length);
  console.log("[ghostops-diagnostic-ia] hasToken:", Boolean(incomingToken));
  console.log("[ghostops-diagnostic-ia] hasCsId:", Boolean(csId));

  if (!effectiveDescription) {
    return res.status(400).json({
      error: 'Le champ "message" (ou "description") est obligatoire.',
    });
  }

  // 1) Vérifier / initialiser session (token)
  const now = Math.floor(Date.now() / 1000);

  let sessionCtx = null; // { cs_id, itersLeft, exp }
  let isFollowup = false;

  if (incomingToken) {
    const v = verifyToken(incomingToken, tokenSecret);
    if (!v.ok) {
      return res.status(401).json({
        error: "Session invalide ou altérée. Veuillez relancer depuis le lien de confirmation de paiement.",
        debug: { reason: v.reason },
      });
    }

    const p = v.payload || {};
    const exp = Number(p.exp || 0);

    if (!exp || now > exp) {
      return res.status(401).json({
        error: "Session expirée. Veuillez relancer une session Diagnostic IA ou contacter GhostOps.",
        debug: { reason: "expired", exp },
      });
    }

    const itersLeft = Number(p.itersLeft);
    if (!Number.isFinite(itersLeft) || itersLeft < 0) {
      return res.status(401).json({
        error: "Session invalide. Veuillez relancer depuis le lien de confirmation de paiement.",
        debug: { reason: "bad_iters" },
      });
    }

    if (itersLeft <= 0) {
      return res.status(403).json({
        error:
          "Limite atteinte : vos 5 itérations ont été utilisées. Pour poursuivre, contactez GhostOps ou basculez vers Studio Scénarios.",
        meta: { itersLeft: 0, expiresAt: exp },
      });
    }

    sessionCtx = {
      cs_id: cleanStr(p.cs_id),
      itersLeft,
      exp,
    };

    isFollowup = true; // dès qu’on a un token, on est en mode itération
  } else {
    // Pas de token : on exige cs_id et on vérifie Stripe
    if (!csId) {
      return res.status(401).json({
        error:
          "Accès non autorisé. Cette session nécessite un identifiant de paiement (cs_id) ou un token de session.",
      });
    }

    const check = await verifyStripeCheckoutSession({ stripe, csId });
    if (!check.ok) {
      return res.status(401).json({
        error:
          "Paiement non vérifié. Veuillez utiliser le lien de fin de paiement (avec cs_id) ou contacter GhostOps.",
        debug: check,
      });
    }

    // Session initialisée : iters = MAX_ITERS, exp = now+TTL
    sessionCtx = {
      cs_id: check.session.id,
      itersLeft: MAX_ITERS,
      exp: now + TTL_SECONDS,
    };

    // Ici, initial = note complète
    isFollowup = false;
  }

  // 2) Construire prompts (initial vs follow-up)
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

Exigences de niveau :
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

Contexte : utilise l’historique fourni pour rester cohérent si présent.
Nouvelle question / précision de l’utilisateur :
"""${effectiveDescription}"""

Règles de réponse :
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

  // Le modèle : initial vs follow-up (et history peut aussi déclencher follow-up)
  const model = (isFollowup || isFollowupFromHistory) ? modelFollowup : modelInitial;

  // 3) Appel OpenAI
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

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
        error: data?.error?.message || data?.message || `Erreur OpenAI (HTTP ${openaiResponse.status})`,
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

    // 4) Décrément itérations (uniquement si réponse OK)
    const newItersLeft = Math.max(0, Number(sessionCtx.itersLeft) - 1);

    // 5) Nouveau token (rotation à chaque réponse)
    const newToken = signToken(
      {
        cs_id: sessionCtx.cs_id,
        itersLeft: newItersLeft,
        exp: sessionCtx.exp,
        v: 1,
      },
      tokenSecret
    );

    return res.status(200).json({
      reply,
      sessionToken: newToken,
      itersLeft: newItersLeft,
      expiresAt: sessionCtx.exp,
      meta: {
        model,
        followup: isFollowup || isFollowupFromHistory,
        historyUsed: history.length,
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({
        error: "Temps de génération dépassé. Veuillez réessayer (ou réduire la longueur de votre message).",
        debug: { model, timeoutMs: OPENAI_TIMEOUT_MS, max_output_tokens: maxOut },
      });
    }

    console.error("[ghostops-diagnostic-ia] fatal:", err);
    return res.status(500).json({
      error: "Erreur interne lors de l’appel au moteur GhostOps Diagnostic IA.",
      debug: { model, message: err?.message || String(err) },
    });
  } finally {
    clearTimeout(timeout);
  }
};
