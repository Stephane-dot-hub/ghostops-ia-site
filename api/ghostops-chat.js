// /api/ghostops-chat.js

export default async function handler(req, res) {
  // Autoriser uniquement POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
    }

  // Récupération de la clé API OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'Clé API OpenAI manquante côté serveur (variable OPENAI_API_KEY non définie dans Vercel).'
    });
  }

  // Lecture du message utilisateur
  let userMessage = '';

  try {
    if (req.body && typeof req.body === 'object') {
      // Cas standard Vercel/Next : body déjà parsé
      userMessage = req.body.message || req.body.userMessage || '';
    } else if (typeof req.body === 'string') {
      // Cas éventuel où body est une string JSON
      const parsed = JSON.parse(req.body || '{}');
      userMessage = parsed.message || parsed.userMessage || '';
    }
  } catch (err) {
    console.error('Erreur parsing body GhostOps :', err);
    return res
      .status(400)
      .json({ error: 'Requête invalide (JSON non lisible côté serveur).' });
  }

  if (!userMessage || typeof userMessage !== 'string') {
    return res
      .status(400)
      .json({ error: 'Message utilisateur manquant dans la requête.' });
  }

  // Prompt système GhostOps
  const instructions =
    "Tu es GhostOps IA, cellule tactique d’analyse de situations sensibles : " +
    "crises RH, dirigeants exposés, jeux de pouvoir internes, gouvernance. " +
    "Tu réponds en français, sur un ton professionnel, structuré et concis. " +
    "Tu identifies clairement les angles d’analyse (risques, acteurs, scénarios possibles). " +
    "Tu ne donnes pas de conseils juridiques, mais tu peux suggérer de consulter un avocat spécialisé si nécessaire. " +
    "Tu évites les généralités creuses et tu restes orienté action.";

  try {
    // Appel à l’API OpenAI (endpoint /v1/responses)
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.1-mini',
        instructions,
        input: userMessage
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('Erreur HTTP OpenAI :', openaiResponse.status, errorText);
      return res.status(500).json({
        error: `Erreur OpenAI (HTTP ${openaiResponse.status}).`
      });
    }

    const data = await openaiResponse.json();

    // Extraction du texte de réponse : data.output[0].content[0].text
    let replyText = '';
    try {
      replyText =
        data?.output?.[0]?.content?.[0]?.text ||
        data?.output_text ||
        '';
    } catch (e) {
      console.error('Erreur extraction texte OpenAI :', e);
    }

    if (!replyText) {
      replyText =
        "Je n’ai pas pu générer de réponse exploitable à partir des éléments fournis. " +
        "Merci de reformuler en précisant le contexte (type de crise, acteurs impliqués, horizon de temps).";
    }

    return res.status(200).json({ reply: replyText });
  } catch (err) {
    console.error('Erreur lors de l’appel OpenAI :', err);
    return res.status(500).json({
      error:
        'Erreur de connexion au moteur GhostOps (OpenAI).'
    });
  }
}
