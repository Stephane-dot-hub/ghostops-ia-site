// /api/ghostops-pre-brief-board-checkout.js
// Crée une Stripe Checkout Session pour le Niveau 3 (Pré-Brief Board)

const Stripe = require("stripe");

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({ error: "STRIPE_SECRET_KEY non configurée." });
  }

  // Price ID Niveau 3 (env prioritaire, sinon fallback sur celui que vous m’avez donné)
  const priceId =
    cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID) ||
    "price_1SeWCRK0Qxok0kNVLzqMd4Au";

  const origin =
    cleanStr(req.headers.origin) ||
    cleanStr(process.env.GHOSTOPS_PUBLIC_ORIGIN) ||
    "https://www.ghostops.tech";

  // URLs (ajustables)
  const success_url = `${origin}/pre-brief-board-session.html?cs_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${origin}/pre-brief-board.html?canceled=1`;

  try {
    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
      // Vous pouvez activer la collecte d’email client si souhaité :
      // customer_creation: "always",
      // billing_address_collection: "auto",
      metadata: {
        product: "ghostops_pre_brief_board",
        level: "3",
      },
    });

    return res.status(200).json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error("[pre-brief-board-checkout] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Impossible de créer la session de paiement.",
      debug: err?.message || String(err),
    });
  }
};
