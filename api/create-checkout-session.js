// /api/create-checkout-session.js
const Stripe = require("stripe");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_DIAGNOSTIC_IA || "";

function safeStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

module.exports = async function handler(req, res) {
  // POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });
  }

  if (!stripeSecretKey) {
    return res.status(500).json({
      error: "STRIPE_SECRET_KEY non configurée dans les variables d’environnement.",
    });
  }
  if (!priceId) {
    return res.status(500).json({
      error: "STRIPE_PRICE_ID_DIAGNOSTIC_IA non configuré dans les variables d’environnement.",
    });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

  try {
    // Body attendu (optionnel) :
    // { user_id?: "...", email?: "..." }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const userId = safeStr(body.user_id);
    const email = safeStr(body.email);

    // Origin fiable : header > PUBLIC_SITE_ORIGIN > VERCEL_URL > localhost
    const publicOrigin =
      process.env.PUBLIC_SITE_ORIGIN ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const origin = req.headers.origin || publicOrigin;

    // Expiration checkout
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Number(process.env.STRIPE_CHECKOUT_EXPIRES_IN || "3600") || 3600;
    const expiresAt = now + expiresInSeconds;

    // IMPORTANT :
    // - client_reference_id = user_id si disponible (cas A)
    // - metadata doit contenir au moins niveau + user_id/email pour le webhook
    const metadata = {
      product: "ghostops_diagnostic_ia",
      niveau_produit: "diagnostic",
      user_id: userId || "",
      email: email || "",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],

      // Après paiement OK : on revient sur la page session (protégée),
      // mais le droit aura été posé par webhook → l’accès passera après login.
      success_url: `${origin}/diagnostic-ia-session.html?cs_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/paiement-diagnostic-ia.html?canceled=1`,

      // Traçabilité & activation serveur
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
      metadata,

      expires_at: expiresAt,

      payment_intent_data: {
        metadata,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe create-checkout-session (diagnostic) :", err);
    return res.status(500).json({
      error: "Erreur lors de la création de la session de paiement Stripe (Diagnostic IA).",
      details: err && err.message ? err.message : String(err),
    });
  }
};
