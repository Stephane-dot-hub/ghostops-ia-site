// /api/ghostops-diagnostic-ia.js

export default async function handler(req, res) {
  // Autoriser uniquement le POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'OPENAI_API_KEY non configurée sur le serveur (Vercel > Variables d’environnement).',
    });
  }

  // ------------------------------------------------------------------
  // On fait confiance au parsing JSON intégré (comme sur vos autres API)
  // ------------------------------------------------------------------
  const body = req.body || {};
  const { description, contexte, enjeu, message, mode } = body;

  // On prend d’abord "description", sinon "message"
  let effectiveDescription = '';
  if (typeof description === 'string' && description.trim().length > 0) {
    effectiveDescription = description.trim();
  } else if (typeof message === 'string' && message.trim().length > 0) {
    effectiveDescription = message.trim();
  }

  if (!effectiveDescription) {
    return res.status(400).json({
      error: 'Le champ "description" est obligatoire pour le diagnostic.',
      debug: {
        bodyType: typeof body,
        body,
      },
    });
  }

  const safeContexte =
    typeof contexte === 'string' ? contexte : '';
  const safeEnjeu =
    typeof enjeu === 'string' ? enjeu : '';

  // ------------------------------------------------------------------
  // Prompt système GhostOps Diagnostic IA (gpt-5.1-mini)
  // ------------------------------------------------------------------
  const systemPrompt = `
Tu es "GhostOps IA – Diagnostic", IA utilisée en back-office dans le produit payant
"GhostOps Diagnostic IA – 90 minutes".

Ta mission :
- produire une **lecture tactique structurée** d'une situation complexe
  (crise RH, dirigeant exposé, jeux de pouvoir internes, blocages de gouvernance,
   enjeux d'influence interne/externe),
- sans résoudre totalement le cas,
- et sans te substituer à un conseil humain (juridique, RH, gouvernance).

Règles :
- Réponds **en français**, dans un **ton formel, professionnel, sobre**.
- Tu n'es ni avocat, ni autorité de contrôle : **pas de conseil juridique formel**,
  pas de stratégie procédurale détaillée, pas de qualification pénale.
- Tu ne proposes **aucune manœuvre illégale** ni représailles, ni contournement des règles internes.
- Tu restes au **niveau "lecture tactique"** : clarification, cartographie, options de lecture,
  questions structurantes pour la suite.
- Tu ne prétends **pas résoudre entièrement** la crise : tu prépares le travail de la séance
  de 90 minutes avec GhostOps.
- Tu évites le jargon creux ; privilégie les formulations claires, assumables devant un board
  ou un comité d'audit.
- Termine toujours par une phrase de prudence du type :
  "Ce pré-diagnostic ne remplace ni un avis juridique, ni un conseil RH individualisé,
   ni une mission GhostOps complète."
`.trim();

  // ------------------------------------------------------------------
  // Prompt utilisateur : structure attendue + données envoyées
  // ------------------------------------------------------------------
  const userPrompt = `
Tu vas produire un **pré-diagnostic structuré** à partir des éléments suivants.

Données fournies par l’utilisateur :

- Description principale de la situation :
"""${effectiveDescription}"""

- Éléments de contexte complémentaires (s'ils existent) :
"""${safeContexte}"""

- Enjeux perçus ou risques principaux exprimés par l’utilisateur (s'ils existent) :
"""${safeEnjeu}"""

Ta réponse doit suivre **strictement** la structure ci-dessous, avec les titres exacts :

1) Synthèse de la situation telle que je la comprends
   - 5 à 8 lignes maximum, factuelles, sans dramatisation.
   - Reformule la situation avec tes mots, en restant neutre.

2) Points de tension majeurs
   - 3 à 6 puces.
   - Mets en avant les tensions clés : humaines, organisationnelles, de gouvernance, narratifs.
   - Chaque puce = une phrase claire.

3) Questions à clarifier en priorité lors du Diagnostic IA (90 min)
   - 5 à 10 questions précises.
   - Ce sont les questions à travailler en séance pour affiner le diagnostic
     (pas des conseils, mais des axes de clarification).

4) Première cartographie des risques (hors droit pur)
   - Trois sous-parties, chacune avec 2 à 4 puces :

   4.1. Risques Humains / RH
   - …

   4.2. Risques de Gouvernance / Pouvoir
   - …

   4.3. Risques Narratifs / Réputation
   - …

5) Niveau de tension estimé (indication qualitative)
   - Indique un niveau parmi : "modéré", "élevé" ou "critique".
   - Explique en 3 à 4 lignes pourquoi tu classes la situation à ce niveau,
     en t'appuyant uniquement sur les éléments décrits.

6) Conclusion et intérêt d’une séance GhostOps Diagnostic IA – 90 minutes
   - 3 à 5 lignes :
     - ce que cette lecture initiale permet déjà de voir,
     - en quoi une séance structurée de 90 min pourrait aider à clarifier les options,
     - rappel qu’il s’agit d’un pré-diagnostic et non d’un conseil juridique ou d’une mission complète.

Contraintes supplémentaires :
- Pas de listes interminables : sois synthétique et sélectif, mais exigeant.
- Pas de scénario d'exécution détaillé : tu restes sur le "quoi voir" et le "quoi clarifier",
  pas sur "comment manœuvrer".
- Ne modifie pas les titres des sections.
`.trim();

  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.1-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_output_tokens: 1100,
      }),
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error('Erreur OpenAI Diagnostic IA:', data);
      return res.status(openaiResponse.status).json({
        error:
          data?.error?.message ||
          `Erreur OpenAI (HTTP ${openaiResponse.status})`,
      });
    }

    let reply = 'Je n’ai pas pu générer de pré-diagnostic utile.';

    // Format OpenAI "responses" : data.output[0].content[0].text
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
    console.error('Erreur lors de l’appel à OpenAI (Diagnostic IA):', err);
    return res.status(500).json({
      error:
        'Une erreur interne est survenue lors de l’appel au moteur GhostOps Diagnostic IA.',
    });
  }
}
