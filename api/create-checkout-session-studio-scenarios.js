// /api/create-checkout-session-studio-scenarios.js
const Stripe = require("stripe");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_STUDIO_SCENARIOS || ""; // ID du prix Stripe pour Studio Scénarios (Niveau 2)

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
      error: "STRIPE_PRICE_ID_STUDIO_SCENARIOS non configuré dans les variables d’environnement.",
    });
  }

  // Stripe client
  const stripe = new Stripe(stripeSecretKey);

  try {
    // Origin fiable : header > URL publique configurée > VERCEL_URL > localhost
    const publicOrigin =
      process.env.PUBLIC_SITE_ORIGIN ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const origin = req.headers.origin || publicOrigin;

    // Durée de validité de la Checkout Session (timestamp UNIX en secondes)
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Number(process.env.STRIPE_CHECKOUT_EXPIRES_IN || "3600") || 3600;
    const expiresAt = now + expiresInSeconds;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      // (Optionnel) vous pouvez supprimer cette ligne : Stripe déduira automatiquement selon config
      payment_method_types: ["card"],

      line_items: [
        {
          price: priceId, // prix géré côté Stripe (Studio Scénarios – 1 490 € TTC)
          quantity: 1,
        },
      ],

      // ✅ Après paiement OK → redirection vers l’espace Studio Scénarios avec l’ID Stripe
      // Stripe remplacera automatiquement {CHECKOUT_SESSION_ID}
      success_url: `${origin}/studio-scenarios-session.html?cs_id={CHECKOUT_SESSION_ID}`,

      // ❌ Si l’utilisateur annule → retour à la page de paiement Studio Scénarios
      cancel_url: `${origin}/paiement-studio-scenarios.html?canceled=1`,

      // Métadonnées utiles
      metadata: {
        product: "ghostops_studio_scenarios",
      },

      // Utile côté Stripe pour tracer
      client_reference_id: "ghostops_studio_scenarios",

      // Expiration de la Checkout Session (limite certains “replay”)
      expires_at: expiresAt,

      // Metadata également au niveau PaymentIntent
      payment_intent_data: {
        metadata: {
          product: "ghostops_studio_scenarios",
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe create-checkout-session-studio-scenarios :", err);
    return res.status(500).json({
      error: "Erreur lors de la création de la session de paiement Stripe (Studio Scénarios).",
      details: err && err.message ? err.message : String(err),
    });
  }
};
