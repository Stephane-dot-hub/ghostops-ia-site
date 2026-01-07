// /api/create-checkout-session-studio-scenarios.js
const Stripe = require("stripe");
const crypto = require("crypto");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_STUDIO_SCENARIOS || ""; // Stripe Price ID (Niveau 2)
const publicOriginEnv = (process.env.PUBLIC_SITE_ORIGIN || "").trim(); // ex: https://www.ghostops.tech

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

  // Origin fiable : NE PAS faire confiance à req.headers.origin (peut être usurpé)
  const origin =
    publicOriginEnv ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  // Stripe client
  const stripe = new Stripe(stripeSecretKey);

  try {
    // Durée de validité de la Checkout Session (UNIX seconds)
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Number(process.env.STRIPE_CHECKOUT_EXPIRES_IN || "3600") || 3600;
    const expiresAt = now + expiresInSeconds;

    // Idempotency : évite la création de plusieurs sessions si double-clic / retry navigateur
    // (le client envoie déjà un anti-double-clic, mais on sécurise serveur aussi)
    const idem =
      (req.headers["x-idempotency-key"] && String(req.headers["x-idempotency-key"]).slice(0, 128)) ||
      crypto.createHash("sha256").update(`${req.headers["user-agent"] || ""}|${now}`).digest("hex");

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",

        // Laisser Stripe décider des moyens selon votre config (recommandé).
        // payment_method_types: ["card"],

        line_items: [{ price: priceId, quantity: 1 }],

        // Après paiement OK → espace session (Stripe remplace {CHECKOUT_SESSION_ID})
        success_url: `${origin}/studio-scenarios-session.html?cs_id={CHECKOUT_SESSION_ID}`,

        // Annulation → retour page paiement
        cancel_url: `${origin}/paiement-studio-scenarios.html?canceled=1`,

        // Expiration Checkout Session (réduit le "replay")
        expires_at: expiresAt,

        // Traces / filtre dans Stripe
        client_reference_id: "ghostops_studio_scenarios",

        // Métadonnées utiles (Checkout + PaymentIntent)
        metadata: {
          product: "ghostops_studio_scenarios",
          niveau: "studio",
        },
        payment_intent_data: {
          metadata: {
            product: "ghostops_studio_scenarios",
            niveau: "studio",
          },
        },
      },
      { idempotencyKey: idem }
    );

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe create-checkout-session-studio-scenarios :", err);

    // Éviter de trop exposer en prod ; garder details utiles côté logs
    return res.status(500).json({
      error: "Erreur lors de la création de la session de paiement Stripe (Studio Scénarios).",
    });
  }
};
