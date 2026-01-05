// /api/ghostops-pre-brief-board.js
// Niveau 3 : Pré-Brief Board
// Réplique du moteur Studio Scénarios : Stripe cs_id -> token signé (TTL + itérations) -> décrément serveur.
// + Support "continue" : suite d'une réponse tronquée SANS consommer d’itération.
//
// Compatible front :
// - 1er appel : { cs_id, message }   (ou { cs_id, description })
// - appels suivants : { sessionToken, message, history }
// - suite : { sessionToken, continue:true, last_assistant:"...", history }
//
// Le serveur renvoie : { reply, sessionToken, itersLeft, expiresAt, meta }

const Stripe = require("stripe");
const crypto = require("crypto");

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

function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof h !== "string") return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? cleanStr(m[1]) : "";
}

// -------------------------
// Troncature : marqueur + heuristique (back-end)
// -------------------------
const TRUNC_MARKER = "— FIN TRONQUÉE (demander la suite)";

function looksTruncated(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/[.!?…)]\s*$/.test(t)) return false;
  if (t.length < 200) return false;
  return true;
}

function ensureTruncMarker(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  if (t.includes(TRUNC_MARKER)) return t;
  return `${t}\n\n${TRUNC_MARKER}`;
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
function b64urlEncode(bufOrStr) {
  return Buffer.from(bufOrStr)
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

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
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
// Stripe verification (avec option de vérification du Price ID)
// -------------------------
async function verifyStripeCheckoutSession({ stripe, csId, expectedPriceId }) {
  const id = cleanStr(csId);
  if (!id) return { ok: false, reason: "missing_cs_id" };

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(id, {
      expand: ["line_items.data.price"],
    });
  } catch (e) {
    return { ok: false, reason: "stripe_retrieve_failed", message: e?.message || String(e) };
  }

  const paid = session?.payment_status === "paid";
  if (!paid) {
    return {
      ok: false,
      reason: "not_paid",
      status: session?.status,
      payment_status: session?.payment_status,
    };
  }

  const priceId = cleanStr(expectedPriceId);
  if (priceId) {
    const items = session?.line_items?.data || [];
    const found = items.some((li) => cleanStr(li?.price?.id) === priceId);
    if (!found) {
      return {
        ok: false,
        reason: "wrong_product",
        message: "Checkout Session payée, mais ne correspond pas au produit attendu (Price ID).",
      };
    }
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
// OpenAI call (avec retry + timeout par tentative)
// -------------------------
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function callOpenAIWithTimeout({ apiKey, model, input, maxOut, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
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

    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, data: { error: { message: "AbortError" } }, aborted: true };
    }
    return {
      ok: false,
      status: 502,
      data: { error: { message: err?.message || String(err) } },
      networkError: true,
    };
  } finally {
    clearTimeout(t);
  }
}

// -------------------------
// Handler
// -------------------------
module.exports = async function handler(req, res) {
  const startedAtMs = Date.now();

  // no-cache
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Méthode non autorisée. Utilisez POST." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "OPENAI_API_KEY non configurée sur le serveur (Vercel > Variables d’environnement).",
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({
      ok: false,
      error: "STRIPE_SECRET_KEY non configurée (Vercel > Variables d’environnement).",
    });
  }

  // ✅ Niveau 3 : secret dédié (vous l’avez déjà)
  const tokenSecret = cleanStr(process.env.GHOSTOPS_PREBRIEF_TOKEN_SECRET);
  if (!tokenSecret) {
    return res.status(500).json({
      ok: false,
      error: "GHOSTOPS_PREBRIEF_TOKEN_SECRET manquant. Ajoutez une clé longue et aléatoire dans Vercel.",
    });
  }

  // ✅ Niveau 3 : Price ID dédié (optionnel mais recommandé)
  const expectedPriceId = cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID);

  const stripe = new Stripe(stripeSecretKey);

  // Paramètres session (défauts “Pré-brief”)
  const MAX_ITERS = Number(process.env.GHOSTOPS_PREBRIEF_MAX_ITERS || "12") || 12;
  const TTL_SECONDS = Number(process.env.GHOSTOPS_PREBRIEF_SESSION_TTL_SECONDS || "21600") || 21600; // 6h

  // Modèles (mettez ici le même que Studio si vous voulez strictement identique)
  const modelInitial =
    cleanStr(process.env.GHOSTOPS_PREBRIEF_MODEL_INITIAL) ||
    cleanStr(process.env.GHOSTOPS_PREBRIEF_MODEL) ||
    cleanStr(process.env.GHOSTOPS_STUDIO_MODEL_INITIAL) ||
    cleanStr(process.env.GHOSTOPS_STUDIO_MODEL) ||
    "gpt-4.1-mini";

  const modelFollowup =
    cleanStr(process.env.GHOSTOPS_PREBRIEF_MODEL_FOLLOWUP) ||
    cleanStr(process.env.GHOSTOPS_PREBRIEF_MODEL) ||
    cleanStr(process.env.GHOSTOPS_STUDIO_MODEL_FOLLOWUP) ||
    cleanStr(process.env.GHOSTOPS_STUDIO_MODEL) ||
    "gpt-4.1-mini";

  // Longueur de réponse
  const maxOutDefault = Number(process.env.GHOSTOPS_PREBRIEF_MAX_OUTPUT_TOKENS || "1600") || 1600;
  const maxOutContinue = Number(process.env.GHOSTOPS_PREBRIEF_MAX_OUTPUT_TOKENS_CONTINUE || "1400") || 1400;

  // Timeout OpenAI
  const OPENAI_TIMEOUT_MS = Number(process.env.GHOSTOPS_OPENAI_TIMEOUT_MS || "40000") || 40000;

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

  const isContinue = Boolean(body.continue === true || body.continue === "true");

  // message/description (compat)
  const effectiveDescription = cleanStr(body.description) || cleanStr(body.message);

  const history = normalizeHistory(body.history || body.conversation || body.messages);
  const isFollowupFromHistory = hasAssistantInHistory(history);

  const csId = cleanStr(body.cs_id || body.csId);
  const incomingToken = cleanStr(body.sessionToken || body.token) || cleanStr(getBearerToken(req));

  const lastAssistant = clampText(cleanStr(body.last_assistant || body.lastAssistant), 8000);

  console.log("[ghostops-pre-brief-board] content-type:", contentType);
  console.log("[ghostops-pre-brief-board] keys:", Object.keys(body || {}));
  console.log("[ghostops-pre-brief-board] rawLen:", raw ? raw.length : 0);
  console.log("[ghostops-pre-brief-board] descLen:", effectiveDescription.length);
  console.log("[ghostops-pre-brief-board] historyLen:", history.length);
  console.log("[ghostops-pre-brief-board] hasToken:", Boolean(incomingToken));
  console.log("[ghostops-pre-brief-board] hasCsId:", Boolean(csId));
  console.log("[ghostops-pre-brief-board] continue:", isContinue);
  console.log("[ghostops-pre-brief-board] lastAssistantLen:", lastAssistant.length);

  // Validations
  if (!effectiveDescription && !isContinue) {
    return res.status(400).json({ ok: false, error: 'Le champ "message" (ou "description") est obligatoire.' });
  }
  if (isContinue && !incomingToken) {
    return res.status(401).json({
      ok: false,
      error: "Accès non autorisé. La demande de suite nécessite un token de session (sessionToken).",
    });
  }
  if (isContinue && !lastAssistant && history.length < 2) {
    return res.status(400).json({
      ok: false,
      error: "Impossible de produire la suite : contexte insuffisant (last_assistant ou historique manquant).",
    });
  }

  // 1) Vérifier / initialiser session (token)
  const now = Math.floor(Date.now() / 1000);

  let sessionCtx = null; // { cs_id, itersLeft, exp }
  let isFollowup = false;
  let createdNewSession = false;

  if (incomingToken) {
    const v = verifyToken(incomingToken, tokenSecret);
    if (!v.ok) {
      return res.status(401).json({
        ok: false,
        error: "Session invalide ou altérée. Veuillez relancer depuis le lien de confirmation de paiement.",
        debug: { reason: v.reason },
      });
    }

    const p = v.payload || {};
    const exp = Number(p.exp || 0);

    if (!exp || now > exp) {
      return res.status(401).json({
        ok: false,
        error: "Session expirée. Veuillez relancer depuis le lien de confirmation de paiement ou contacter GhostOps.",
        debug: { reason: "expired", exp },
      });
    }

    const itersLeft = Number(p.itersLeft);
    if (!Number.isFinite(itersLeft) || itersLeft < 0) {
      return res.status(401).json({
        ok: false,
        error: "Session invalide. Veuillez relancer depuis le lien de confirmation de paiement.",
        debug: { reason: "bad_iters" },
      });
    }

    if (itersLeft <= 0) {
      return res.status(403).json({
        ok: false,
        error: "Limite atteinte : vos itérations ont été utilisées. Pour poursuivre, contactez GhostOps.",
        meta: { itersLeft: 0, expiresAt: exp, itersMax: MAX_ITERS, ttlSeconds: TTL_SECONDS },
      });
    }

    sessionCtx = { cs_id: cleanStr(p.cs_id), itersLeft, exp };
    isFollowup = true;
  } else {
    if (!csId) {
      return res.status(401).json({
        ok: false,
        error:
          "Accès non autorisé. Cette session nécessite un identifiant de paiement (cs_id) ou un token de session.",
      });
    }

    const check = await verifyStripeCheckoutSession({ stripe, csId, expectedPriceId });

    if (!check.ok) {
      return res.status(401).json({
        ok: false,
        error: "Paiement non vérifié. Veuillez utiliser le lien de fin de paiement (avec cs_id) ou contacter GhostOps.",
        debug: check,
      });
    }

    sessionCtx = {
      cs_id: check.session.id,
      itersLeft: MAX_ITERS,
      exp: now + TTL_SECONDS,
    };

    isFollowup = false;
    createdNewSession = true;
  }

  // 2) Prompts Pré-Brief Board
  const systemPrompt = `
Tu es "GhostOps IA – Pré-brief Board", IA utilisée dans le produit payant
"GhostOps Pré-brief Board – Niveau 3".

Règles :
- Réponds en français, ton formel, professionnel, sobre.
- Pas de conseil juridique formel, pas de stratégie procédurale détaillée, pas de qualification pénale.
- Aucune manœuvre illégale, représailles ou contournement de règles.
- Objectif : produire une lecture board-ready et des options de cadrage gouvernance, pas une exécution.
- Style assumable devant un board : clair, factuel, orienté arbitrage, sans jargon.

Mise en forme obligatoire (lisibilité) :
- Format Markdown lisible.
- Titres sur une ligne dédiée, en gras (ex: "**1) ...**").
- Listes exclusivement en puces avec "- ".
- Une ligne vide entre chaque section.
- Jamais plus de 5 lignes sans saut de ligne.

Clôture :
- Termine par : "Ce pré-brief ne remplace ni un avis juridique, ni un conseil RH individualisé, ni une mission GhostOps complète."
`.trim();

  const userPromptInitial = `
Tu vas produire un pré-brief board-ready à partir des éléments suivants.

- Situation / demande :
"""${effectiveDescription}"""

Tu dois suivre strictement la structure ci-dessous, avec les titres exacts :

1) Reformulation factuelle (en 8 à 12 lignes maximum)
2) Enjeux de gouvernance & points de rupture (3 à 7 puces)
3) Risques (humains / narratifs / gouvernance) : 3 sous-blocs
   - Humains
   - Narratifs
   - Gouvernance
4) Contraintes & lignes rouges (3 à 7 puces)
5) Options de cadrage (A / B / C)
   - Pour chaque option : intention / bénéfice / risque / condition de succès / signal d’alerte
6) Questions à trancher avant passage board (priorisées)
7) Questions de clarification (ce qui manque, en premier)

Exigences :
- Les options A/B/C doivent être réellement distinctes.
- Si des éléments manquent : explicite-les sans inventer.
- Si limite de longueur : terminer proprement puis ajouter "${TRUNC_MARKER}".

Format de sortie impératif :
- Chaque titre sur sa propre ligne, en gras : "**1) ...**".
- Sous chaque titre : uniquement des puces "- ".
- Une ligne vide entre sections.
`.trim();

  const userPromptFollowup = `
Nous sommes en itération d’approfondissement (Pré-brief Board).

Nouvelle question / précision :
"""${effectiveDescription}"""

Règles de réponse :
- Ne réécris pas tout le pré-brief.
- Réponds en 3 blocs maximum :
  A) Ce que cela change (gouvernance / acteurs / risques)
  B) Mise à jour des options A/B/C (ce qui bouge, ce qui ne bouge pas)
  C) Décisions & questions à trancher avant instance (3 à 7)

Contraintes :
- Pas d’avis juridique formel, pas de stratégie procédurale détaillée.
- Si limite : terminer proprement puis "${TRUNC_MARKER}".

Format :
- Titres en gras : "**A) ...**", "**B) ...**", "**C) ...**".
- Sous chaque bloc : uniquement des puces "- ".
- Une ligne vide entre A, B, C.
`.trim();

  const userPromptContinue = `
Nous sommes en "suite" d'une réponse tronquée.

Contexte :
- Extrait du dernier message assistant :
"""${lastAssistant || "(non fourni)"}"""

Instruction :
- Continue exactement là où la réponse s’est arrêtée.
- Ne répète pas les sections déjà données ; reprends au bon endroit.
- Conserve le même style et la même mise en forme aérée.
- Si tu atteins encore une limite : termine proprement puis ajoute "${TRUNC_MARKER}".
`.trim();

  const userPrompt = isContinue ? userPromptContinue : isFollowup ? userPromptFollowup : userPromptInitial;

  const model = (isContinue || isFollowup || isFollowupFromHistory) ? modelFollowup : modelInitial;
  const maxOut = isContinue ? maxOutContinue : maxOutDefault;

  // 3) Appel OpenAI (avec retry)
  try {
    const input = buildInputs({ systemPrompt, userPrompt, history });

    // Tentative 1
    let attempt = await callOpenAIWithTimeout({
      apiKey,
      model,
      input,
      maxOut,
      timeoutMs: OPENAI_TIMEOUT_MS,
    });

    // Tentative 2 (fallback) si retryable
    let retried = false;
    let fallbackMaxOut = null;

    if (!attempt.ok && isRetryableStatus(attempt.status)) {
      retried = true;
      fallbackMaxOut = Math.max(700, Math.floor(maxOut * 0.65));

      attempt = await callOpenAIWithTimeout({
        apiKey,
        model,
        input,
        maxOut: fallbackMaxOut,
        timeoutMs: OPENAI_TIMEOUT_MS,
      });
    }

    if (!attempt.ok) {
      if (attempt.aborted || attempt.status === 504) {
        return res.status(504).json({
          ok: false,
          error: "Temps de génération dépassé. Veuillez réessayer (ou réduire la longueur de votre message).",
          debug: {
            model,
            timeoutMs: OPENAI_TIMEOUT_MS,
            max_output_tokens: maxOut,
            retried,
            fallbackMaxOut,
          },
          meta: {
            truncMarker: TRUNC_MARKER,
            itersMax: MAX_ITERS,
            ttlSeconds: TTL_SECONDS,
            serverNow: now,
            latencyMs: Date.now() - startedAtMs,
          },
        });
      }

      const data = attempt.data || {};
      return res.status(attempt.status || 502).json({
        ok: false,
        error: data?.error?.message || data?.message || `Erreur OpenAI (HTTP ${attempt.status || 502})`,
        debug: {
          model,
          openaiStatus: attempt.status || 502,
          openaiType: data?.error?.type || "",
          openaiCode: data?.error?.code || "",
          retried,
          fallbackMaxOut,
        },
        meta: {
          truncMarker: TRUNC_MARKER,
          itersMax: MAX_ITERS,
          ttlSeconds: TTL_SECONDS,
          serverNow: now,
          latencyMs: Date.now() - startedAtMs,
        },
      });
    }

    const data = attempt.data || {};

    let reply = extractReplyFromResponsesApi(data);
    if (!reply) {
      return res.status(502).json({
        ok: false,
        error: "Réponse OpenAI reçue, mais texte introuvable.",
        debug: { model, retried, fallbackMaxOut },
        meta: {
          truncMarker: TRUNC_MARKER,
          itersMax: MAX_ITERS,
          ttlSeconds: TTL_SECONDS,
          serverNow: now,
          latencyMs: Date.now() - startedAtMs,
        },
      });
    }

    const apiSaysIncomplete = data?.status === "incomplete" || Boolean(data?.incomplete_details);
    if (apiSaysIncomplete || looksTruncated(reply)) {
      reply = ensureTruncMarker(reply);
    }

    // 4) Décrément itérations (continue => ne décrémente pas)
    const newItersLeft = isContinue
      ? Math.max(0, Number(sessionCtx.itersLeft))
      : Math.max(0, Number(sessionCtx.itersLeft) - 1);

    // 5) Nouveau token (rotation)
    const newToken = signToken(
      {
        cs_id: sessionCtx.cs_id,
        itersLeft: newItersLeft,
        exp: sessionCtx.exp,
        v: 1,
        product: "ghostops_pre_brief_board",
      },
      tokenSecret
    );

    return res.status(200).json({
      ok: true,
      reply,
      sessionToken: newToken,
      itersLeft: newItersLeft,
      expiresAt: sessionCtx.exp,
      meta: {
        truncMarker: TRUNC_MARKER,
        model,
        followup: Boolean(isContinue || isFollowup || isFollowupFromHistory),
        continue: Boolean(isContinue),
        historyUsed: history.length,
        max_output_tokens: maxOut,
        timeoutMs: OPENAI_TIMEOUT_MS,
        incomplete: Boolean(apiSaysIncomplete),
        productLock: Boolean(expectedPriceId),
        retried,
        fallbackMaxOut,
        session: {
          createdNewSession,
          ttlSeconds: TTL_SECONDS,
          maxIters: MAX_ITERS,
        },
        serverNow: now,
        latencyMs: Date.now() - startedAtMs,
      },
    });
  } catch (err) {
    console.error("[ghostops-pre-brief-board] fatal:", err);
    return res.status(500).json({
      ok: false,
      error: "Erreur interne lors de l’appel au moteur GhostOps Pré-brief Board.",
      debug: { model: modelInitial, message: err?.message || String(err) },
      meta: {
        truncMarker: TRUNC_MARKER,
        itersMax: MAX_ITERS,
        ttlSeconds: TTL_SECONDS,
        serverNow: now,
        latencyMs: Date.now() - startedAtMs,
      },
    });
  }
};
