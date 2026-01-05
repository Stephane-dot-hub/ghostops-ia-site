// /api/ghostops-pre-brief-board.js
// Niveau 3 : Pré-Brief Board
// cs_id -> vérification Stripe -> token signé (TTL + itérations) -> décrément serveur.
// + "continue" gratuit : suite d'une réponse tronquée sans consommer d’itération.

const Stripe = require("stripe");
const crypto = require("crypto");

// -------------------- Helpers --------------------
function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Token signé : base64url(payload).base64url(sig)
function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signToken(payloadObj, secret) {
  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = base64url(payloadJson);
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = base64url(sig);
  return `${payloadB64}.${sigB64}`;
}

function verifyToken(token, secret) {
  const t = cleanStr(token);
  const parts = t.split(".");
  if (parts.length !== 2) return { ok: false, reason: "format" };

  const [payloadB64, sigB64] = parts;
  const expected = base64url(crypto.createHmac("sha256", secret).update(payloadB64).digest());

  // comparaison timing-safe
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "sig" };

  const payloadJson = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const payload = safeJsonParse(payloadJson);
  if (!payload) return { ok: false, reason: "payload" };

  return { ok: true, payload };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isContinueRequest(message) {
  const m = cleanStr(message).toLowerCase();
  return m === "continue" || m === "suite" || m === "continuer";
}

// -------------------- Main --------------------
module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ ok: false, error: "Méthode non autorisée. Utilisez POST." });
    }

    // Env vars
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const tokenSecret = cleanStr(process.env.GHOSTOPS_PREBRIEF_TOKEN_SECRET || process.env.GHOSTOPS_TOKEN_SECRET);

    if (!stripeSecretKey) {
      return res.status(500).json({ ok: false, error: "STRIPE_SECRET_KEY non configurée." });
    }
    if (!tokenSecret) {
      return res.status(500).json({ ok: false, error: "GHOSTOPS_PREBRIEF_TOKEN_SECRET non configurée." });
    }

    const body = req.body || {};
    const cs_id = cleanStr(body.cs_id);
    const sessionTokenIn = cleanStr(body.sessionToken);
    const message = cleanStr(body.message);
    const history = Array.isArray(body.history) ? body.history.slice(-12) : []; // limite raisonnable

    // Paramètres token
    const TTL_SECONDS = Number(process.env.GHOSTOPS_PREBRIEF_TTL_SECONDS || 60 * 60 * 24 * 3); // 3 jours par défaut
    const MAX_ITERS = Number(process.env.GHOSTOPS_PREBRIEF_MAX_ITERS || 12); // à ajuster
    const PRICE_ID_EXPECTED = cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    // -------------------- 1) Déterminer la session applicative --------------------
    let tokenPayload = null;
    let tokenVerified = false;

    if (sessionTokenIn) {
      const v = verifyToken(sessionTokenIn, tokenSecret);
      if (v.ok) {
        tokenPayload = v.payload;
        tokenVerified = true;
      } else {
        // token invalide => on retombe sur cs_id si fourni
        tokenPayload = null;
        tokenVerified = false;
      }
    }

    // Si pas de token valide, on passe par cs_id (init ou fallback)
    if (!tokenVerified) {
      if (!cs_id || !cs_id.startsWith("cs_")) {
        return res.status(401).json({
          ok: false,
          error: "Accès non délivré par le module Pré-brief Board.",
          debug: "Token absent/invalide et cs_id manquant/invalide."
        });
      }

      // -------------------- 2) Vérification Stripe (source de vérité) --------------------
      const session = await stripe.checkout.sessions.retrieve(cs_id, {
        expand: ["line_items.data.price"],
      });

      const status = session?.status;
      const payment_status = session?.payment_status;
      const isPaid = status === "complete" && payment_status === "paid";

      if (!isPaid) {
        return res.status(401).json({
          ok: false,
          error: "Paiement non vérifié (Stripe).",
          debug: `status=${status}, payment_status=${payment_status}`
        });
      }

      // Optionnel : verrouillage Price ID
      if (PRICE_ID_EXPECTED) {
        const lineItems = session?.line_items?.data || [];
        const hasExpected = lineItems.some((li) => li?.price?.id === PRICE_ID_EXPECTED);
        if (!hasExpected) {
          return res.status(401).json({
            ok: false,
            error: "Paiement valide, mais produit inattendu.",
            debug: "Price ID ne correspond pas à GHOSTOPS_BOARD_STRIPE_PRICE_ID."
          });
        }
      }

      // -------------------- 3) Émission d’un token signé --------------------
      tokenPayload = {
        v: 1,
        product: "ghostops_pre_brief_board",
        cs_id,
        exp: nowSec() + TTL_SECONDS,
        iters_left: MAX_ITERS
      };

      const newToken = signToken(tokenPayload, tokenSecret);

      // Cas "initialisation" : on renvoie tout de suite un token + un reply court
      if (!message || message.toLowerCase().includes("initialisation") || message.toLowerCase().includes("validation")) {
        return res.status(200).json({
          ok: true,
          sessionToken: newToken,
          reply:
            "Accès confirmé. Vous pouvez décrire votre situation (périmètre, faits, acteurs, risques, échéances). " +
            "Je produirai une première lecture structurée pour préparer la note board-ready."
        });
      }

      // Sinon on continue et on traitera le message utilisateur ci-dessous avec ce token
      // (on va aussi renvoyer sessionToken en fin de réponse).
      tokenVerified = true;
    }

    // -------------------- 4) Contrôles TTL / itérations --------------------
    if (!tokenPayload || tokenPayload.product !== "ghostops_pre_brief_board") {
      return res.status(401).json({ ok: false, error: "Accès non délivré par le module Pré-brief Board." });
    }

    if (nowSec() > Number(tokenPayload.exp || 0)) {
      return res.status(401).json({ ok: false, error: "Session expirée. Veuillez relancer depuis le lien Stripe (cs_id)." });
    }

    const continueFree = isContinueRequest(message);
    const itersLeft = Number(tokenPayload.iters_left ?? 0);

    if (!continueFree && itersLeft <= 0) {
      return res.status(402).json({ ok: false, error: "Quota d’itérations atteint. Veuillez contacter GhostOps." });
    }

    // Décrément (sauf continue)
    if (!continueFree) {
      tokenPayload.iters_left = itersLeft - 1;
    }

    // Rotation token (prolonge l’usage dans la même TTL)
    const rotatedToken = signToken(tokenPayload, tokenSecret);

    // -------------------- 5) Production de la réponse IA --------------------
    // IMPORTANT : ici vous branchez votre moteur IA existant.
    // Je mets un placeholder propre : remplacez `generatePrebriefReply(...)` par votre fonction actuelle.
    async function generatePrebriefReply(userMessage, hist) {
      // TODO: brancher votre logique existante (Responses API / OpenAI, etc.)
      // Gardez le format final : string.
      return (
        "Lecture préliminaire (Pré-brief Board) –\n\n" +
        "1) Reformulation synthétique\n" +
        "2) Enjeux / points de rupture\n" +
        "3) Risques gouvernance / humains / narratifs\n" +
        "4) Hypothèses & zones d’ombre à clarifier\n" +
        "5) Pistes de cadrage (préparation note board-ready)\n\n" +
        "Décrivez maintenant : votre horizon de décision (date, format, instances), et ce que vous cherchez à éviter."
      );
    }

    if (!message) {
      return res.status(400).json({ ok: false, error: "Le champ message est obligatoire." });
    }

    const reply = await generatePrebriefReply(message, history);

    return res.status(200).json({
      ok: true,
      reply,
      sessionToken: rotatedToken
    });
  } catch (err) {
    console.error("[ghostops-pre-brief-board] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Erreur serveur Pré-brief Board.",
      debug: err?.message || String(err)
    });
  }
};
