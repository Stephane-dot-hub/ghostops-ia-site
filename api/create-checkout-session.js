// /api/create-checkout-session-diagnostic-ia.js
const Stripe = require("stripe");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_DIAGNOSTIC_IA || ""; // ID du prix Stripe pour le Diagnostic IA

module.exports = async function handler(req, res) {
  // Sécurité : uniquement POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });
  }

  // Vérification configuration Stripe
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

  const stripe = new Stripe(stripeSecretKey);

  try {
    const origin =
      req.headers.origin ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    // Optionnel : durée de validité de la Checkout Session (ex: 1h)
    // Stripe attend un timestamp UNIX (en secondes)
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Number(process.env.STRIPE_CHECKOUT_EXPIRES_IN || "3600") || 3600;
    const expiresAt = now + expiresInSeconds;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId, // prix géré côté Stripe (Diagnostic IA – 790 € TTC)
          quantity: 1,
        },
      ],

      // 🔁 Après paiement OK → redirection vers l’espace IA (avec l’ID Stripe)
      // Stripe remplacera automatiquement {CHECKOUT_SESSION_ID}
      success_url: `${origin}/diagnostic-ia-session.html?cs_id={CHECKOUT_SESSION_ID}`,

      // ❌ Si l’utilisateur annule → retour à la page de paiement
      cancel_url: `${origin}/paiement-diagnostic-ia.html?canceled=1`,

      // Métadonnées utiles
      metadata: {
        product: "ghostops_diagnostic_ia",
      },

      // Optionnel mais utile pour retrouver une session côté Stripe
      client_reference_id: "ghostops_diagnostic_ia",

      // Optionnel : expiration de la Checkout Session (limite le “replay”)
      // Si vous ne voulez pas d’expiration Stripe, supprimez cette ligne.
      expires_at: expiresAt,

      // Optionnel : metadata aussi au niveau PaymentIntent
      payment_intent_data: {
        metadata: {
          product: "ghostops_diagnostic_ia",
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe create-checkout-session-diagnostic-ia :", err);
    return res.status(500).json({
      error: "Erreur lors de la création de la session de paiement Stripe (Diagnostic IA).",
      details: err && err.message ? err.message : String(err),
    });
  }
};
