// api/ghostops-chat.js

export default async function handler(req, res) {
  // On n'accepte que le POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { message, messages } = req.body || {};

    // On accepte soit:
    // - un simple champ "message": string
    // - soit un tableau "messages": [{ role, content }, ...]
    let chatMessages;

    if (Array.isArray(messages) && messages.length > 0) {
      chatMessages = messages;
    } else if (typeof message === 'string' && message.trim() !== '') {
      chatMessages = [
        {
          role: 'user',
          content: message.trim(),
        },
      ];
    } else {
      return res.status(400).json({ error: 'Aucun message fourni.' });
    }

    // Cadre "system" pour le ton GhostOps
    const systemMessage = {
      role: 'system',
      content:
        "Tu es le chatbot GhostOps. Tu réponds en français, avec un ton professionnel, " +
        "sobre et précis. Tu expliques les services GhostOps (crises RH complexes, " +
        "repositionnement de dirigeants, domination narrative, IA opérante). " +
        "Tu peux renvoyer vers la page /expertise.html pour le détail des domaines " +
        "et vers /contact.html pour un brief confidentiel lorsqu'un cas concret est évoqué. " +
        "Tu ne promets jamais de résultats irréalistes et tu restes factuel.",
    };

    const payloadMessages = [systemMessage, ...chatMessages];

    // Appel à l’API OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // clé stockée sur Vercel
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // ajustable: gpt-4.1, gpt-4o-mini, etc.
        messages: payloadMessages,
        temperature: 0.25,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('Erreur OpenAI:', errorText);
      return res.status(500).json({
        error: 'Erreur lors de l’appel à OpenAI.',
        details: errorText,
      });
    }

    const data = await openaiResponse.json();

    const reply =
      data.choices?.[0]?.message?.content?.trim() ||
      "Je rencontre une difficulté momentanée pour répondre. Merci de réessayer dans un instant.";

    // Réponse envoyée au front (widget sur index.html)
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Erreur dans /api/ghostops-chat :', err);
    return res.status(500).json({ error: 'Erreur serveur interne.' });
  }
}
