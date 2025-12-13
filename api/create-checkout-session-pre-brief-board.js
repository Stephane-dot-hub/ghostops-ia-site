// /api/create-checkout-session-pre-brief-board.js
const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_PRE_BRIEF_BOARD || ''; // ID du prix Stripe (one-shot)

module.exports = async function handler(req, res) {
  // Sécurité : uniquement POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Vérification configuration Stripe
  if (!stripeSecretKey) {
    return res.status(500).json({
      error: 'STRIPE_SECRET_KEY non configurée dans les variables d’environnement.'
    });
  }
  if (!priceId) {
    return res.status(500).json({
      error: 'STRIPE_PRICE_ID_PRE_BRIEF_BOARD non configuré dans les variables d’environnement.'
    });
  }

  const stripe = new Stripe(stripeSecretKey);

  try {
    const origin =
      req.headers.origin ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId, // géré côté Stripe (prix Pré-brief Board)
          quantity: 1,
        },
      ],
      // Après paiement OK → retour vers pre-brief-board.html?paid=1
      success_url: `${origin}/pre-brief-board.html?paid=1`,
      // Si annulation → retour page de paiement Pré-brief Board
      cancel_url: `${origin}/paiement-pre-brief-board.html?canceled=1`,
      metadata: {
        product: 'ghostops_pre_brief_board',
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Erreur Stripe create-checkout-session-pre-brief-board :', err);
    return res.status(500).json({
      error: 'Erreur lors de la création de la session de paiement Stripe (Pré-brief Board).',
      details: err && err.message ? err.message : String(err),
    });
  }
};
