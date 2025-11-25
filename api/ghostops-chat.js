// api/ghostops-chat.js

export default async function handler(req, res) {
  // Autoriser uniquement le POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Vérification de la clé API côté serveur
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY non configurée sur le serveur (Vercel > Variables d’environnement).'
    });
  }

  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Le champ "message" est manquant ou invalide.' });
  }

  // Prompt GhostOps combiné dans un seul input (format simple 100 % compatible /responses)
  const prompt = `
Tu es "GhostOps", une cellule d'intervention confidentielle spécialisée en :
- crises RH complexes,
- dirigeants exposés,
- jeux de pouvoir internes,
- gouvernance et influence.

Règles de réponse :
- Réponds toujours en français, de manière très professionnelle, sobre et structurée.
- Tu n’es PAS un avocat : tu peux aider à analyser, cadrer les risques et proposer des pistes,
  mais tu ne fournis pas de conseil juridique formel.
- Tu dois systématiquement inviter à utiliser le formulaire de contact du site GhostOps
  si la situation paraît réellement critique ou nominative.

Contexte de la question posée par un décideur (PDG / board / DRH / fonction support exposée) :
"""${message}"""

Tâche :
1. Reformuler brièvement la situation telle que tu la comprends.
2. Identifier les risques humains / de gouvernance / narratifs (sans faire de droit pur).
3. Proposer 2 à 3 pistes de clarification ou d’action concrètes.
4. Conclure en une phrase en indiquant que la situation pourrait nécessiter,
   le cas échéant, un échange plus confidentiel via le formulaire de contact GhostOps.
`;

  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // IMPORTANT : clé de projet ou clé personnelle au format "sk-..."
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        // Utilisez un modèle supporté par /v1/responses.
        // Si votre clé de test a été générée avec "gpt-5-nano", vous pouvez aussi mettre "gpt-5-nano".
        model: 'gpt-5-nano',
        input: prompt,
        max_output_tokens: 500
      })
    });

    const data = await openaiResponse.json();

    // Si OpenAI renvoie une erreur, on remonte le message exact pour debugging
    if (!openaiResponse.ok) {
      console.error('Erreur OpenAI:', data);
      return res.status(openaiResponse.status).json({
        error: data?.error?.message || `Erreur OpenAI (HTTP ${openaiResponse.status})`
      });
    }

    // Extraction robuste du texte dans la structure "responses"
    let reply = 'Je n’ai pas pu générer de réponse utile.';

    if (
      data.output &&
      Array.isArray(data.output) &&
      data.output[0] &&
      data.output[0].content &&
      Array.isArray(data.output[0].content) &&
      data.output[0].content[0] &&
      typeof data.output[0].content[0].text === 'string'
    ) {
      reply = data.output[0].content[0].text;
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Erreur lors de l’appel à OpenAI:', err);
    return res.status(500).json({
      error: 'Une erreur interne est survenue lors de l’appel au moteur GhostOps.'
    });
  }
}
