// /api/ghostops-pre-brief-board-verify.js
// Vérifie un Checkout Session Stripe (cs_id) et confirme le paiement.

const Stripe = require("stripe");

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ ok: false, error: "Méthode non autorisée. Utilisez POST." });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ ok: false, error: "STRIPE_SECRET_KEY non configurée." });
    }

    const csid = cleanStr(req.body?.cs_id);
    if (!csid || !csid.startsWith("cs_")) {
      return res.status(400).json({ ok: false, error: "cs_id invalide ou manquant." });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    // Récupération session Checkout
    const session = await stripe.checkout.sessions.retrieve(csid);

    const status = session?.status || null;               // ex: "complete"
    const payment_status = session?.payment_status || null; // ex: "paid"

    const verified = status === "complete" && payment_status === "paid";

    // Retour détaillé (utile pour debug)
    return res.status(200).json({
      ok: true,
      verified,
      status,
      payment_status,
      mode: session?.mode || null,
      livemode: session?.livemode ?? null,
      amount_total: session?.amount_total ?? null,
      currency: session?.currency || null,
      id: session?.id || null,
    });
  } catch (err) {
    console.error("[ghostops-pre-brief-board-verify] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Erreur lors de la vérification du paiement.",
      debug: err?.message || String(err),
    });
  }
};
