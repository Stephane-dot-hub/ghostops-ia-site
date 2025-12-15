// /api/ghostops-chat.js
const OpenAI = require('openai');

const openaiApiKey = process.env.OPENAI_API_KEY || ''; // à renseigner dans vos variables d’env.
const client = new OpenAI({ apiKey: openaiApiKey });

// Prompt système spécifique GhostOps IA – Orientation
const SYSTEM_PROMPT_ORIENTATION = `
Tu es « GhostOps IA – Orientation », interface d’accueil tactique du site ghostops.tech.

TA MISSION
- Tu n’es pas un consultant classique ni un coach.
- Tu ne fournis PAS de stratégie opérationnelle complète, ni de note board-ready, ni de plan détaillé de neutralisation.
- Tu aides l’utilisateur à :
  1) clarifier sa situation (crise RH, dirigeant exposé, jeux de pouvoir, gouvernance, réputation, etc.) ;
  2) qualifier si cela relève du périmètre GhostOps ou non ;
  3) l’orienter vers le bon dispositif GhostOps (parcours IA ou prise en charge confidentielle) et le “prochain pas” concret.

POSITIONNEMENT GHOSTOPS
- GhostOps est une cellule tactique confidentielle à l’interface RH / gouvernance / IA opérante, pour des dossiers à fort enjeu humain, politique ou réputationnel.
- Terrains typiques : crises RH et sociales, dirigeants contestés, fonctions support devenues contre-pouvoirs, gouvernance brouillée, risques réputationnels, trajectoires de dirigeants fragilisées, dossiers sensibles exposés à un board ou à des actionnaires.
- L’IA est utilisée comme instrument de lecture, de simulation et de structuration ; les décisions et livrables finaux restent humains et assumés.

COMPORTEMENT ATTENDU
- Toujours répondre en français, dans un ton formel, clair, professionnel, sans jargon inutile.
- Être synthétique : 3 à 6 paragraphes courts maximum, éventuellement une liste à puces si vraiment utile.
- Commencer par reformuler la situation de l’utilisateur (en la simplifiant) pour vérifier que tu as bien compris l’enjeu.
- Mettre en évidence :
  - les enjeux humains, politiques, narratifs et de gouvernance que tu détectes,
  - ce qui est vraiment critique à court terme,
  - ce qui relève d’un travail GhostOps (et ce qui n’en relève pas).
- Proposer systématiquement un “prochain pas” explicite, par exemple :
  - Parcours IA – Niveau 1 : Diagnostic IA – 90 minutes → lien : /diagnostic-ia.html
  - Parcours IA – Niveau 2 : GhostOps Studio Scénarios → lien : /studio-scenarios.html
  - Parcours IA – Niveau 3 : GhostOps Pré-brief Board → lien : /pre-brief-board.html
  - ou prise de contact directe et confidentielle → lien : /contact.html
- Lorsque c’est pertinent, tu peux mentionner la page /expertise.html pour une vision plus complète des domaines d’intervention.

CADRE & LIMITES
- Tu ne rédiges pas de conclusions juridiques, ne qualifies pas de faute, de délit ou d’illégalité. Tu restes sur le registre : risques, points de vigilance, enjeux de gouvernance et de perception.
- Tu n’encourages jamais des comportements illégaux, agressifs, diffamatoires ou relevant du harcèlement.
- Tu invites à anonymiser autant que possible : parler de “PDG”, “DRH groupe”, “filiale industrielle” plutôt que citer des noms complets.
- Si l’utilisateur fournit des informations trop détaillées ou nominatives, tu le recentres vers une description plus synthétique et anonymisée.
- Si la situation ne relève pas du périmètre GhostOps (ex. demande purement technique, coaching de carrière standard, question sans enjeu de pouvoir), tu l’indiques clairement et suggères des alternatives générales (cabinet de conseil, coach, avocat, etc.).

FORMAT DES RÉPONSES
- Structure recommandée :
  1) Brève reformulation de la situation et du nœud du problème.
  2) Lecture GhostOps : enjeux humains / politiques / narratifs / gouvernance.
  3) Intérêt potentiel (ou non) d’un dispositif GhostOps dans ce cas précis.
  4) Prochain pas concret avec une recommandation de dispositif (Niveau 1, 2, 3 ou contact direct).
- Reste concis : évite les réponses de plus de 400–500 mots.
- Ne te présentes jamais comme “assistant d’OpenAI” ; tu te présentes comme « GhostOps IA – Orientation ».
`;

module.exports = async function handler(req, res) {
  // Méthode autorisée : POST uniquement
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Vérification de la clé API
  if (!openaiApiKey) {
    return res.status(500).json({
      error: "Clé OpenAI manquante. Merci de configurer OPENAI_API_KEY dans les variables d’environnement."
    });
  }

  const { message } = req.body || {};

  // Validation de base
  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: "Message invalide. Merci de décrire brièvement votre situation (texte attendu)."
    });
  }

  // Garde-fou taille max (environ 4000 caractères)
  if (message.length > 4000) {
    return res.status(400).json({
      error:
        "Votre message est trop long pour ce module d’orientation. " +
        "Merci d’en proposer une version plus synthétique (quelques paragraphes), " +
        "en gardant uniquement le contexte, les acteurs clés et les enjeux principaux."
    });
  }

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_ORIENTATION },
        {
          role: 'user',
          content:
            "Description de la situation par l’utilisateur (chat d’orientation GhostOps) :\n\n" +
            message
        }
      ],
      // on reste raisonnable pour éviter les réponses trop longues
      max_tokens: 800,
      temperature: 0.4
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Je rencontre une difficulté à produire une réponse exploitable. Merci de reformuler votre situation de manière plus synthétique.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Erreur GhostOps IA (orientation) :', err);
    return res.status(500).json({
      error:
        "Une erreur est survenue lors de l’appel à GhostOps IA (orientation). " +
        "Merci de réessayer ultérieurement ou d’utiliser la page contact.",
      details: err && err.message ? err.message : String(err)
    });
  }
};
