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

  const { description, contexte, enjeu } = req.body || {};

  if (!description || typeof description !== 'string') {
    return res
      .status(400)
      .json({ error: 'Le champ "description" est obligatoire pour le diagnostic.' });
  }

  // On tolère que contexte/enjeu soient vides, mais on les passe tout de même
  const safeContexte = typeof contexte === 'string' ? contexte : '';
  const safeEnjeu = typeof enjeu === 'string' ? enjeu : '';

  const prompt = `
Tu es **GhostOps IA – Diagnostic**, assistant d’un dispositif "GhostOps Diagnostic IA – 90 minutes".

Périmètre :
- crises RH complexes, dirigeants exposés, jeux de pouvoir internes, blocages de gouvernance,
- enjeux d’influence interne/externe liés à ces situations.

Ta mission n’est PAS de résoudre entièrement le cas, mais de produire un **pré-diagnostic structuré**
qui servira de support à une séance humaine de 90 minutes.

Règles :
- Réponse en français, ton formel, professionnel, sobre.
- Tu n’es ni avocat, ni autorité de contrôle : pas de conseil juridique formel, pas de stratégie procédurale détaillée.
- Tu ne proposes pas de représailles, de contournements illégaux, ni de manœuvres douteuses.
- Tu restes au niveau "lecture tactique" : clarification, cartographie, options, questions à traiter.
- Tu évites de régler totalement le problème : tu prépares le travail de la séance payante de 90 minutes.

Structure attendue :

1) **Synthèse de la situation telle que je la comprends**
   - 5 à 8 lignes maximum, factuelles, sans dramatisation.

2) **Points de tension majeurs**
   - 3 à 6 puces sur les tensions clés (humaines, organisationnelles, de gouvernance, narratifs).

3) **Questions à clarifier en priorité lors du Diagnostic IA (90 min)**
   - 5 à 10 questions précises qui doivent impérativement être travaillées en séance.

4) **Première cartographie des risques (hors droit pur)**
   - 3 catégories : Humains/RH, Gouvernance/pouvoir, Narratif/réputation.
   - Pour chaque catégorie : 2 à 4 risques formulés en une phrase.

5) **Niveau de tension estimé (indication qualitative)**
   - Choisis parmi : "modéré", "élevé", "critique".
   - Explique en 3–4 lignes pourquoi tu le classes ainsi, à partir de ce qui est décrit.

6) **Conclusion**
   - 3–4 lignes expliquant en quoi une séance structurée de 90 minutes pourrait être utile,
     sans la vendre agressivement mais en montrant l’intérêt d’un travail approfondi et confidentiel.

Données fournies par l’utilisateur :

- Description principale de la situation :
"""${description}"""

- Éléments de contexte complémentaires :
"""${safeContexte}"""

- Enjeux perçus ou risques principaux exprimés par l’utilisateur :
"""${safeEnjeu}"""

Produis ta réponse en respectant strictement la structure ci-dessus (titres compris).
`;

  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        input: prompt,
        max_output_tokens: 900,
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
