// /api/ghostops-pre-brief-board-checkout.js
// Crée une Stripe Checkout Session pour le Niveau 3 (Pré-brief Board)
// Aligné avec l’architecture N1/N2 : no-store, origin robuste, validation env, erreurs propres.

const Stripe = require("stripe");

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function pickOrigin(req) {
  // Priorité : env > header origin > host > fallback
  const envOrigin = cleanStr(process.env.GHOSTOPS_PUBLIC_ORIGIN);
  if (envOrigin) return envOrigin.replace(/\/+$/, "");

  const hdrOrigin = cleanStr(req.headers?.origin);
  if (hdrOrigin) return hdrOrigin.replace(/\/+$/, "");

  const forwardedProto = cleanStr(req.headers?.["x-forwarded-proto"]) || "https";
  const forwardedHost = cleanStr(req.headers?.["x-forwarded-host"]);
  const host = forwardedHost || cleanStr(req.headers?.host);

  if (host) return `${forwardedProto}://${host}`.replace(/\/+$/, "");
  return "https://www.ghostops.tech";
}

module.exports = async function handler(req, res) {
  // No cache (cohérence avec les API IA / checkout)
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Méthode non autorisée. Utilisez POST." });
  }

  const stripeSecretKey = cleanStr(process.env.STRIPE_SECRET_KEY);
  if (!stripeSecretKey) {
    return res.status(500).json({ ok: false, error: "STRIPE_SECRET_KEY non configurée." });
  }

  // Nouveau nom d'env recommandé (reste compatible avec l'ancien)
  const priceId =
    cleanStr(process.env.STRIPE_PRICE_ID_PRE_BRIEF_BOARD) ||
    cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID) ||
    "price_1SeWCRK0Qxok0kNVLzqMd4Au";

  if (!priceId.startsWith("price_")) {
    return res.status(500).json({
      ok: false,
      error:
        "ID de prix Stripe invalide. Configurez STRIPE_PRICE_ID_PRE_BRIEF_BOARD (ou GHOSTOPS_BOARD_STRIPE_PRICE_ID).",
    });
  }

  const origin = pickOrigin(req);

  const success_url = `${origin}/pre-brief-board-session.html?cs_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${origin}/paiement-pre-brief-board.html?canceled=1`;

  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    // Si un body JSON est envoyé plus tard (ex: email, locale, etc.), on est prêt.
    // Vercel/Next parse souvent req.body automatiquement ; sinon il restera undefined (sans impact).
    const locale = cleanStr(req.body?.locale); // optionnel

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,

      // Identifiant interne
      client_reference_id: "ghostops_level3_prebrief_board",

      // Métadonnées (lisibles dans Stripe)
      metadata: {
        product: "ghostops_pre_brief_board",
        level: "3",
        niveau: "pre-brief",
      },

      // Optionnel : si vous voulez forcer une langue Stripe Checkout.
      ...(locale ? { locale } : {}),
    });

    // session.url existe en Checkout "hosted"
    if (!session?.url) {
      return res.status(500).json({
        ok: false,
        error: "Session Stripe créée, mais URL de redirection absente.",
      });
    }

    return res.status(200).json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error("[ghostops-pre-brief-board-checkout] error:", err);

    // Message public neutre + debug exploitable côté logs
    return res.status(500).json({
      ok: false,
      error: "Impossible de créer la session de paiement.",
      debug: err?.message || String(err),
    });
  }
};
