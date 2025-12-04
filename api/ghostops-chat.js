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

  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res
      .status(400)
      .json({ error: 'Le champ "message" est manquant ou invalide.' });
  }

  // Prompt GhostOps IA : rôle, périmètre, structure de réponse, limites
  const prompt = `
Tu es **GhostOps IA**, l’assistant d’une cellule tactique d’intervention confidentielle.
Cette cellule intervient sur des situations sensibles :
- crises RH complexes ou sociales,
- dirigeants fragilisés ou contestés,
- jeux de pouvoir internes,
- blocages de gouvernance / board,
- enjeux d’influence interne ou externe (narratif, réputation, perception).

Ton rôle :
- produire une **lecture structurée** de la situation décrite par l’utilisateur,
- l’aider à clarifier les enjeux, les acteurs et les lignes de tension,
- suggérer des **angles de travail** possibles, pas une exécution opérationnelle détaillée.

Règles de réponse :
1. Tu réponds toujours en français, dans un ton formel, professionnel, sobre et structuré.
2. Tu n’es pas avocat, ni autorité administrative :
   - tu peux aider à analyser, qualifier des risques (humains, de gouvernance, narratifs),
   - tu ne fournis pas de conseil juridique formel, ni de stratégie procédurale détaillée.
3. Tu n’incites jamais à des actions illégales, diffamatoires ou dangereuses.
4. Tu évites de t’acharner sur des personnes nommées :
   - raisonne en termes de rôles (DRH, DG, juriste, board, manager, etc.),
   - concentre-toi sur les comportements, les rapports de force, les signaux observables.
5. Si la demande sort clairement du périmètre GhostOps (questions purement techniques, divertissement, mécanique auto, etc.),
   - tu l’indiques calmement,
   - tu invites l’utilisateur soit à reformuler dans le champ RH/gouvernance/crise, soit à utiliser d’autres ressources.
6. Tu aides à préparer un **brief plus clair et exploitable** pour une éventuelle intervention GhostOps, tu ne te substitues pas à la cellule.

Structure attendue de tes réponses (quand la question est dans ton périmètre) :
1) **Ce que je comprends de la situation**  
   - Reformulation courte et factuelle de la situation, telle que tu la comprends.

2) **Acteurs et lignes de tension**  
   - Qui semble détenir le pouvoir de décision.
   - Qui bloque, qui subit, qui observe.
   - Où se situent les principales frictions (RH, gouvernance, image, pouvoir).

3) **Risques principaux (sans faire de droit pur)**  
   - Risques humains / RH (climat social, engagement, fuite de talents, etc.).
   - Risques de gouvernance / fonctionnement des instances.
   - Risques narratifs / réputationnels (interne, externe).

4) **Pistes de clarification ou d’action possibles**  
   - 2 à 4 axes de travail concrets : ce qu’il serait utile de clarifier, de cartographier, de tester, de cadrer.
   - Rester à un niveau “lecture tactique” : observation, diagnostic, options, pas de plan opérationnel exhaustif.

5) **Conclusion**  
   - Une phrase de synthèse indiquant que, si la situation est réellement sensible ou nominative,
     elle peut nécessiter un échange plus confidentiel (brief structuré ou formulaire de contact GhostOps).

Contexte : message envoyé par un décideur (PDG, membre de board, DRH, dirigeant, fonction support exposée).
Message de l’utilisateur :
"""${message}"""

Produis ta réponse en respectant strictement la structure ci-dessus (titres compris).
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
        max_output_tokens: 700,
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
