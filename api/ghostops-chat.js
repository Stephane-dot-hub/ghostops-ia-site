// api/ghostops-chat.js

export default async function handler(req, res) {
  // Autoriser uniquement POST (et OPTIONS si besoin)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).json({
      error: 'OPENAI_API_KEY n’est pas configurée côté serveur.',
    });
    return;
  }

  try {
    // Selon la config du front, le champ peut s’appeler "message" ou "userMessage"
    const body = req.body || {};
    const rawMessage = body.message || body.userMessage || '';
    const userMessage = String(rawMessage || '').trim();

    if (!userMessage) {
      res.status(400).json({ error: 'Message utilisateur manquant.' });
      return;
    }

    // Prompt GhostOps : ton formel, FR, crise RH / gouvernance
    const prompt = `
Tu es "GhostOps – Cellule tactique d'influence RH et de gouvernance". 
Tu réponds toujours en français, avec un ton formel, professionnel et précis.
Ton rôle est d'aider des PDG, membres de board, DRH ou directions juridiques à clarifier une situation
de crise RH, de gouvernance ou de jeux de pouvoir internes.

Structure de réponse attendue :
1) Une phrase courte qui reformule l’enjeu principal que tu comprends.
2) 2 à 3 pistes d’analyse ou d’actions possibles, concrètes.
3) Lorsque la situation est très sensible, suggère de décrire le cas via le formulaire de contact du site, 
   sans insister lourdement.

Ne promets jamais de résultat, et ne mentionne pas de noms d’entreprises réelles.

Question de l’utilisateur :
"""${userMessage}"""`;

    // Appel HTTP à /v1/responses (équivalent à responses.create)
    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        input: prompt,
        max_output_tokens: 400,
        store: false,
      }),
    });

    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error('Erreur OpenAI:', apiResponse.status, data);
      res.status(500).json({
        error:
          'Une erreur est survenue lors de l’appel au moteur GhostOps. Veuillez réessayer ultérieurement.',
      });
      return;
    }

    let replyText = '';

    try {
      // Extraction propre du texte renvoyé par l’API Responses
      replyText =
        data.output &&
        data.output[0] &&
        data.output[0].content &&
        data.output[0].content[0] &&
        data.output[0].content[0].text
          ? String(data.output[0].content[0].text).trim()
          : '';
    } catch (e) {
      console.error('Erreur lors de la lecture de output[0].content[0].text :', e);
    }

    if (!replyText) {
      res.status(500).json({
        error:
          'Réponse du moteur GhostOps vide ou illisible. Veuillez reformuler votre question.',
      });
      return;
    }

    res.status(200).json({ reply: replyText });
  } catch (error) {
    console.error('Erreur interne GhostOps chat :', error);
    res.status(500).json({
      error:
        'Erreur interne du service GhostOps. Veuillez réessayer dans quelques instants.',
    });
  }
}
