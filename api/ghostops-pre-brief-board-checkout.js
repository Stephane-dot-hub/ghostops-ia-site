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

  const priceId =
    cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID) ||
    "price_1SeWCRK0Qxok0kNVLzqMd4Au";

  const origin =
    cleanStr(process.env.GHOSTOPS_PUBLIC_ORIGIN) ||
    cleanStr(req.headers.origin) ||
    "https://www.ghostops.tech";

  const success_url = `${origin}/pre-brief-board-session.html?cs_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${origin}/paiement-pre-brief-board.html?canceled=1`;

  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
      client_reference_id: "ghostops_level3_prebrief_board",
      metadata: { product: "ghostops_pre_brief_board", level: "3" },
    });

    return res.status(200).json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error("[ghostops-pre-brief-board-checkout] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Impossible de créer la session de paiement.",
      debug: err?.message || String(err),
    });
  }
};
