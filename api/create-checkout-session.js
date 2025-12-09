// /api/create-checkout-session.js
const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_DIAGNOSTIC_IA || '';

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  if (!stripeSecretKey || !stripe) {
    return res.status(500).json({
      error: 'STRIPE_SECRET_KEY non configurée dans les variables d’environnement.'
    });
  }

  if (!priceId) {
    return res.status(500).json({
      error: 'STRIPE_PRICE_ID_DIAGNOSTIC_IA non configuré dans les variables d’environnement.'
    });
  }

  try {
    const origin =
      req.headers.origin ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/diagnostic-ia.html?paid=1#ghostops-diagnostic-ia-widget`,
      cancel_url: `${origin}/paiement-diagnostic-ia.html?canceled=1`,
      metadata: {
        product: 'ghostops_diagnostic_ia_90min',
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Erreur Stripe create-checkout-session :', err);
    return res.status(500).json({
      error: 'Erreur lors de la création de la session de paiement Stripe.',
      details: err && err.message ? err.message : String(err),
    });
  }
};
