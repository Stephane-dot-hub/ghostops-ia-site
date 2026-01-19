// /api/create-checkout-session-pre-brief-board.js
// Crée une Stripe Checkout Session pour le Niveau 3 (Pré-brief Board)
// Correctif anti "vercel.app" : origin doit être PUBLIC_SITE_ORIGIN (prod) et jamais dérivé des headers.

const Stripe = require("stripe");
const crypto = require("crypto");

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeOrigin(origin) {
  const v = cleanStr(origin);
  if (!v) return "";

  // Interdit les origins preview Vercel => évite "Log in to Vercel"
  const host = v.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  if (host.endsWith("vercel.app")) return "";

  // Ajoute https:// si absent
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return withProto.replace(/\/+$/, "");
}

module.exports = async function handler(req, res) {
  // No cache
  res.setHeader("Cache-Control", "no-store, max-age=0");

  // POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Méthode non autorisée. Utilisez POST." });
  }

  const stripeSecretKey = cleanStr(process.env.STRIPE_SECRET_KEY);
  if (!stripeSecretKey) {
    return res.status(500).json({ ok: false, error: "STRIPE_SECRET_KEY non configurée." });
  }

  // Prix Niveau 3 (obligatoire)
  const priceId =
    cleanStr(process.env.STRIPE_PRICE_ID_PRE_BRIEF_BOARD) ||
    cleanStr(process.env.STRIPE_PRICE_ID_PRE_BRIEF) ||
    cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID);

  if (!priceId || !priceId.startsWith("price_")) {
    return res.status(500).json({
      ok: false,
      error:
        "ID de prix Stripe invalide. Configurez STRIPE_PRICE_ID_PRE_BRIEF_BOARD (recommandé).",
    });
  }

  // ✅ ORIGIN FIABLE : on force PUBLIC_SITE_ORIGIN (même standard que N2)
  // En prod, PUBLIC_SITE_ORIGIN doit être https://www.ghostops.tech
  const origin = normalizeOrigin(process.env.PUBLIC_SITE_ORIGIN) || "http://localhost:3000";

  const success_url = `${origin}/pre-brief-board-session.html?cs_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${origin}/paiement-pre-brief-board.html?canceled=1`;

  const stripe = new Stripe(stripeSecretKey);

  try {
    // Expiration checkout (optionnel, mais cohérent avec N2 si vous voulez)
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Number(process.env.STRIPE_CHECKOUT_EXPIRES_IN || "3600") || 3600;
    const expiresAt = now + expiresInSeconds;

    // Idempotency (anti double-clic)
    const idem =
      (req.headers["x-idempotency-key"] && String(req.headers["x-idempotency-key"]).slice(0, 128)) ||
      crypto.createHash("sha256").update(`${req.headers["user-agent"] || ""}|${now}|prebrief`).digest("hex");

    // Optionnel : si vous envoyez un body plus tard (locale, etc.)
    const locale = cleanStr(req.body?.locale);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],

        success_url,
        cancel_url,

        // Vous pouvez le laisser ou le retirer
        allow_promotion_codes: true,

        // Expiration (réduit le replay)
        expires_at: expiresAt,

        client_reference_id: "ghostops_level3_prebrief_board",

        metadata: {
          product: "ghostops_pre_brief_board",
          niveau: "pre-brief",
          level: "3",
        },
        payment_intent_data: {
          metadata: {
            product: "ghostops_pre_brief_board",
            niveau: "pre-brief",
            level: "3",
          },
        },

        ...(locale ? { locale } : {}),
      },
      { idempotencyKey: idem }
    );

    if (!session?.url) {
      return res.status(500).json({
        ok: false,
        error: "Session Stripe créée, mais URL de redirection absente.",
      });
    }

    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[create-checkout-session-pre-brief-board] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Impossible de créer la session de paiement (Pré-brief Board).",
    });
  }
};
