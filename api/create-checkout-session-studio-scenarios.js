// /api/create-checkout-session-studio-scenarios.js
const Stripe = require("stripe");
const crypto = require("crypto");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_STUDIO_SCENARIOS || ""; // Stripe Price ID (Niveau 2)

// IMPORTANT : doit être votre domaine prod (ex: https://www.ghostops.tech)
// => à définir dans Vercel ENV (Production + Preview si vous testez en preview)
const publicOriginEnv = (process.env.PUBLIC_SITE_ORIGIN || "").trim();

function normalizeOrigin(origin) {
  const v = String(origin || "").trim();
  if (!v) return "";

  // interdit les origins "vercel.app" pour éviter le piège "Log in to Vercel"
  if (/vercel\.app$/i.test(v.replace(/^https?:\/\//i, "").split("/")[0])) return "";

  // force https en prod si l'utilisateur a oublié le schéma
  if (!/^https?:\/\//i.test(v)) return `https://${v}`;

  // retire un trailing slash
  return v.replace(/\/+$/, "");
}

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

  // ✅ ORIGIN FIABLE
  // - On utilise PUBLIC_SITE_ORIGIN (recommandé et obligatoire en prod)
  // - On refuse explicitement les origins vercel.app
  // - En fallback local uniquement : localhost
  const normalizedPublicOrigin = normalizeOrigin(publicOriginEnv);
  const origin = normalizedPublicOrigin || "http://localhost:3000";

  // Stripe client
  const stripe = new Stripe(stripeSecretKey);

  try {
    // Durée de validité de la Checkout Session (UNIX seconds)
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Number(process.env.STRIPE_CHECKOUT_EXPIRES_IN || "3600") || 3600;
    const expiresAt = now + expiresInSeconds;

    // Idempotency : évite la création de plusieurs sessions si double-clic / retry navigateur
    const idem =
      (req.headers["x-idempotency-key"] && String(req.headers["x-idempotency-key"]).slice(0, 128)) ||
      crypto.createHash("sha256").update(`${req.headers["user-agent"] || ""}|${now}`).digest("hex");

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],

        // ✅ Après paiement OK → espace session (Stripe remplace {CHECKOUT_SESSION_ID})
        success_url: `${origin}/studio-scenarios-session.html?cs_id={CHECKOUT_SESSION_ID}`,

        // ✅ Annulation → retour page paiement
        cancel_url: `${origin}/paiement-studio-scenarios.html?canceled=1`,

        // Expiration Checkout Session
        expires_at: expiresAt,

        // Traces / filtre dans Stripe
        client_reference_id: "ghostops_studio_scenarios",

        // Métadonnées utiles
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
    return res.status(500).json({
      error: "Erreur lors de la création de la session de paiement Stripe (Studio Scénarios).",
    });
  }
};
