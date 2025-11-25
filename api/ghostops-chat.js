// api/ghostops-chat.js

export default async function handler(req, res) {
  // On n'accepte que le POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('OPENAI_API_KEY manquante dans les variables Vercel.');
    return res.status(500).json({
      error:
        "Configuration serveur incomplète : la clé OpenAI n'est pas disponible côté serveur.",
    });
  }

  // Récupération du corps de la requête (selon l'environnement : objet ou string)
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  const { message } = body;

  if (!message || typeof message !== 'string') {
    return res
      .status(400)
      .json({ error: 'Aucun message valide transmis au chatbot.' });
  }

  // Persona / garde-fous du chatbot GhostOps
  const instructions = `
Tu es "GhostOps Chat", une interface d'orientation confidentielle.

Ton rôle :
- Aider les visiteurs à clarifier leur situation (crise RH, dirigeant exposé, verrouillage interne, jeu de pouvoir, etc.).
- Poser des questions structurantes, sans chercher à tout régler dans le chat.
- Proposer des angles de lecture (humain, politique, narratif, gouvernance) de façon professionnelle et factuelle.
- Inviter, quand c'est pertinent, à utiliser la page de contact GhostOps pour un brief confidentiel plus poussé.

Contraintes :
- Tu restes sobre, professionnel, sans effet de manche.
- Tu ne donnes pas de conseils juridiques personnalisés, ni d’avis médicaux ou fiscaux.
- Tu ne cites jamais de vrais noms d’entreprises ou de personnes : tu restes générique.
- Tu ne promets pas de "résoudre" une affaire dans le chat : tu aides à cadrer la situation et les options.

Style :
- Tu réponds en français.
- Tu restitues en 1 à 3 paragraphes courts maximum, éventuellement avec des listes à puces.
- Tu peux conclure, lorsque c’est pertinent, par une phrase du type :
  "Si vous souhaitez un cadrage confidentiel plus poussé, vous pouvez passer par le formulaire de contact GhostOps."
  (sans lien cliquable, ce sera géré côté interface).
`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // vous pouvez changer de modèle si besoin
        instructions,
        input: message,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('Erreur OpenAI:', response.status, errText);
      return res.status(500).json({
        error:
          "Une erreur est survenue lors de la génération de la réponse du modèle.",
      });
    }

    const data = await response.json();

    // Extraction du texte (premier bloc de sortie)
    const reply =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "Je n'ai pas pu générer de réponse utile pour cette demande.";

    return res.status(200).json({
      reply: reply.trim(),
    });
  } catch (error) {
    console.error('Erreur serveur / OpenAI:', error);
    return res.status(500).json({
      error:
        'Erreur interne lors de la communication avec le modèle. Veuillez réessayer ultérieurement.',
    });
  }
}
