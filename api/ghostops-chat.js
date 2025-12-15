// /api/ghostops-chat.js
// GhostOps IA – Chat d’orientation (sans SDK, via fetch HTTP)

const MAX_MESSAGE_CHARS = 1500;

// Prompt système : positionnement GhostOps et rôle du chat d’orientation
const SYSTEM_PROMPT = `
Tu es "GhostOps IA – Orientation", l’assistant d’orientation du site ghostops.tech.

Ta mission :
1) Comprendre en quelques lignes la situation décrite par l’utilisateur
   (crise RH, dirigeant isolé ou contesté, jeux de pouvoir internes, blocages de gouvernance, etc.).
2) Clarifier les enjeux principaux :
   - humains (tensions, isolements, risques de départ, conflits),
   - narratifs (perception, récit dominant, exposition médiatique ou politique),
   - de gouvernance (ligne hiérarchique dégradée, fonctions support devenues contre-pouvoir, board mal informé…).
3) Orienter vers le dispositif GhostOps le plus pertinent, parmi :
   - "Diagnostic IA – 90 minutes" (Niveau 1)
   - "GhostOps Studio Scénarios" (Niveau 2)
   - "GhostOps Pré-brief Board" (Niveau 3)
   - ou, si le dossier est très spécifique ou très sensible,
     un contact direct via la page de contact confidentielle.

Rappels de positionnement GhostOps (à utiliser dans ta réponse) :
- GhostOps est une cellule tactique confidentielle spécialisée dans :
  crises RH complexes, repositionnement de dirigeants, jeux de pouvoir internes,
  domination narrative, IA opérante.
- Le rôle de GhostOps n’est pas de "conseiller" au sens classique,
  mais de produire une issue maîtrisée dans des environnements instables.
- La suite "GhostOps IA" en 3 niveaux est une porte d’entrée structurée :
  1) Lecture & Diagnostic (Niveau 1),
  2) Construction de scénarios comparables (Niveau 2),
  3) Pré-brief Board (note board-ready pour le Conseil / Comité d’audit, Niveau 3).

Attendus de tes réponses :
- Ton sobre, professionnel, structuré, en français.
- 3 blocs maximum :
  1) Lecture rapide de la situation de l’utilisateur (sans reformuler toute son histoire),
  2) Enjeux clés (humains / narratifs / gouvernance),
  3) Orientation GhostOps :
     - préciser clairement le ou les niveaux GhostOps IA les plus adaptés,
     - OU recommander un contact direct.

Liens internes à utiliser lorsque c’est pertinent :
- Diagnostic IA – 90 minutes (Niveau 1) :
  https://www.ghostops.tech/diagnostic-ia.html
- GhostOps Studio Scénarios (Niveau 2) :
  https://www.ghostops.tech/studio-scenarios.html
- GhostOps Pré-brief Board (Niveau 3) :
  https://www.ghostops.tech/pre-brief-board.html
- Contact confidentiel :
  https://www.ghostops.tech/contact.html

Contraintes :
- Ne donne PAS de conseils juridiques, prud’homaux, médicaux ou fiscaux.
- Ne promets jamais de résultat ; parle en termes de lecture, options, trajectoires possibles.
- N’invente pas de services qui n’existent pas sur ghostops.tech.
- Reste concis : 3 à 6 courts paragraphes maximum.
`;

module.exports = async function handler(req, res) {
  // Autoriser uniquement POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY manquante dans les variables d’environnement.');
    return res.status(500).json({
      error:
        'Configuration OpenAI manquante côté serveur. Le service IA est temporairement indisponible.',
    });
  }

  // Récupération du message utilisateur
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try {
      body = JSON.parse(req.body || '{}');
    } catch (err) {
      body = {};
    }
  }

  const userMessage = (body.message || '').trim();

  if (!userMessage) {
    return res.status(400).json({
      error:
        'Votre message est vide. Décrivez brièvement votre situation pour que GhostOps IA puisse vous orienter.',
    });
  }

  // Garde-fou : taille max du message
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({
      error:
        `Votre message est très long (${userMessage.length} caractères). ` +
        `Pour une première orientation, merci de le résumer à environ ${MAX_MESSAGE_CHARS} caractères ` +
        `en allant à l’essentiel (contexte, acteurs clés, ce que vous cherchez à éviter).`,
    });
  }

  try {
    // Appel HTTP direct à l’API Responses
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        instructions: SYSTEM_PROMPT,
        input: userMessage,
        max_output_tokens: 700,
      }),
    });

    let data;
    try {
      data = await openaiResponse.json();
    } catch (parseErr) {
      console.error('Impossible de parser la réponse OpenAI en JSON :', parseErr);
      return res.status(500).json({
        error: "Erreur lors du traitement de la réponse du service IA.",
      });
    }

    if (!openaiResponse.ok) {
      console.error('Erreur OpenAI côté API :', openaiResponse.status, data);
      const msg =
        (data &&
          data.error &&
          (data.error.message || data.error.type || data.error)) ||
        'Erreur lors de l’appel au modèle IA.';
      return res.status(500).json({
        error: `Le service GhostOps IA est momentanément indisponible (${msg}). Veuillez réessayer plus tard ou utiliser la page contact.`,
      });
    }

    // Extraction du texte de sortie
    let answerText = '';
    try {
      const firstOutput = data.output && data.output[0];
      const firstContent =
        firstOutput && Array.isArray(firstOutput.content)
          ? firstOutput.content[0]
          : null;

      if (firstContent) {
        if (typeof firstContent.text === 'string') {
          answerText = firstContent.text;
        } else if (
          firstContent.text &&
          typeof firstContent.text.value === 'string'
        ) {
          // Au cas où le format serait text: { value: "..." }
          answerText = firstContent.text.value;
        }
      }

      // Fallback si la structure évolue
      if (!answerText && typeof data.output_text === 'string') {
        answerText = data.output_text;
      }

      if (!answerText) {
        throw new Error('Structure de réponse inattendue');
      }
    } catch (extractErr) {
      console.error(
        'Erreur lors de l’extraction du texte assistant :',
        extractErr,
        data
      );
      return res.status(500).json({
        error:
          'Le service IA a répondu dans un format inattendu. Veuillez réessayer ou utiliser la page contact.',
      });
    }

    return res.status(200).json({
      reply: (answerText || '').trim(),
    });
  } catch (err) {
    console.error('Erreur réseau / serveur vers OpenAI :', err);
    return res.status(500).json({
      error:
        "Erreur de connexion au service GhostOps IA. Veuillez réessayer ultérieurement ou utiliser la page contact.",
    });
  }
};
