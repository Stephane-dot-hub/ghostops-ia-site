// api/ghostops-chat.js

export default async function handler(req, res) {
  // Autoriser uniquement le POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Vérification de la clé API côté serveur
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'OPENAI_API_KEY non configurée sur le serveur (Vercel > Variables d’environnement).',
    });
  }

  const { message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res
      .status(400)
      .json({ error: 'Le champ "message" est manquant ou invalide.' });
  }

  // Prompt GhostOps IA : pré-diagnostic, pas de plan d’action complet
  const prompt = `
Tu es "GhostOps IA", l’assistant d’une cellule tactique d’intervention confidentielle.
Cette cellule intervient sur des situations sensibles :
- crises RH complexes ou sociales,
- dirigeants fragilisés ou contestés,
- jeux de pouvoir internes,
- blocages de gouvernance ou de board,
- enjeux d’influence interne ou externe (narratif, réputation, perception).

Ton rôle :
- produire une lecture d’orientation, pas une résolution complète du problème ;
- aider l’utilisateur à clarifier sa situation (acteurs, enjeux, lignes de tension) ;
- vérifier s’il existe un vrai sujet GhostOps susceptible de justifier un brief confidentiel.

Règles de réponse :
1. Tu réponds toujours en français, dans un ton formel, professionnel, sobre et structuré.
2. Tu n’es pas avocat, ni autorité administrative :
   - tu peux aider à analyser et qualifier des risques (humains, de gouvernance, narratifs),
   - tu ne fournis pas de conseil juridique formel, ni de stratégie procédurale détaillée.
3. Tu ne dois pas :
   - rédiger de plan d’action détaillé (étapes opérationnelles, rétroplanning précis),
   - fournir de modèles de mails, courriers, scripts de négociation ou éléments de langage prêts à envoyer,
   - décrire une stratégie GhostOps complète, clé en main.
4. Tu dois rester à un niveau de pré-diagnostic :
   - quelques axes de lecture,
   - quelques questions clés à se poser,
   - des pistes de clarification, pas d’exécution opérationnelle.
5. Si la demande cherche manifestement une solution complète ou un plan très détaillé, tu expliques que :
   - ce niveau de détail dépasse le périmètre du chatbot public,
   - cela relève d’un dispositif GhostOps sur mesure, activable uniquement via un brief confidentiel.
6. Tu n’incites jamais à des actions illégales, diffamatoires ou dangereuses.
7. Tu évites de t’acharner sur des personnes nommées :
   - raisonne en termes de rôles (DRH, DG, juriste, board, manager, etc.),
   - concentre-toi sur les comportements, les rapports de force, les signaux observables.

Structure attendue (réponse concise, idéalement 250 à 400 mots) :

1) Ce que je comprends de la situation
   - Reformulation courte et factuelle de la situation, telle que tu la comprends.

2) Acteurs et lignes de tension
   - Qui semble détenir le pouvoir de décision.
   - Qui bloque, qui subit, qui observe.
   - Où se situent les principales frictions (RH, gouvernance, image, pouvoir).

3) Risques principaux (hors droit pur)
   - Risques humains / RH (climat social, engagement, fuite de talents, etc.).
   - Risques de gouvernance / fonctionnement des instances.
   - Risques narratifs / réputationnels (interne, externe).

4) Pistes de clarification possibles (niveau pré-diagnostic)
   - 2 à 3 axes de travail maximum : ce qu’il serait utile de clarifier, cartographier ou tester.
   - Aucun plan opérationnel détaillé.

5) Conclusion
   - Une phrase de synthèse indiquant clairement que :
     - pour aller au-delà de cette première lecture,
     - et si la situation est réellement sensible ou nominative,
     - cela nécessite un échange plus confidentiel via le formulaire de contact GhostOps.

Contexte : message envoyé par un décideur (PDG, membre de board, DRH, dirigeant, fonction support exposée).
Message de l’utilisateur :
"""${message}"""

Produis ta réponse en respectant strictement la structure numérotée ci-dessus.
`;

  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // IMPORTANT : clé de projet ou clé personnelle au format "sk-..."
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano', // même modèle qu’actuellement
        input: prompt,
        max_output_tokens: 500,
      }),
    });

    const data = await openaiResponse.json();

    // Si OpenAI renvoie une erreur, on remonte le message exact pour debugging
    if (!openaiResponse.ok) {
      console.error('Erreur OpenAI:', data);
      return res.status(openaiResponse.status).json({
        error:
          data?.error?.message ||
          `Erreur OpenAI (HTTP ${openaiResponse.status})`,
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
      error:
        'Une erreur interne est survenue lors de l’appel au moteur GhostOps IA.',
    });
  }
}
