// /api/ghostops-studio-scenarios.js
// Module IA dédié au GhostOps Studio Scénarios : construction de 2–3 scénarios tactiques comparables,
// sans livrer un plan d’exécution complet ni une stratégie GhostOps “clé en main”.

const OpenAI = require('openai');

const apiKey = process.env.OPENAI_API_KEY;
const defaultModel = process.env.OPENAI_MODEL_STUDIO_SCENARIOS || 'gpt-4.1-mini';

module.exports = async function handler(req, res) {
  // Sécurité : uniquement POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res
      .status(405)
      .json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Vérification configuration OpenAI
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY non configurée dans les variables d’environnement.'
    });
  }

  let body = {};
  try {
    body = req.body || {};
  } catch (e) {
    // Si le body n’est pas parsé automatiquement
  }

  const { message } = body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: 'Aucun message valide fourni. Envoyez un champ "message" de type string en JSON.'
    });
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: defaultModel,
      temperature: 0.5,
      max_tokens: 1100,
      messages: [
        {
          role: 'system',
          content: [
            'Tu es GhostOps IA – Studio Scénarios.',
            'Tu interviens après (ou en complément de) un diagnostic déjà réalisé, pour aider à comparer',
            '2 à 3 scénarios tactiques possibles autour d’une situation à fort enjeu humain / politique / de gouvernance.',
            '',
            'Important :',
            '- Tu ne livres PAS un plan d’exécution complet ni une stratégie GhostOps “clé en main”.',
            '- Tu ne fournis PAS de conseils juridiques, sociaux ou réglementaires présentés comme définitifs.',
            '- Tu restes sur la structuration, la comparaison et la mise en lumière des conditions / risques.',
            '',
            'À chaque réponse, tu dois :',
            '1) Rappeler en quelques lignes le CONTEXTE tel que tu le comprends (sans l’inventer).',
            '2) Proposer 2 ou 3 SCÉNARIOS comparables, par exemple :',
            '   - Scénario A : maintien / consolidation contrôlée',
            '   - Scénario B : reconfiguration / repositionnement',
            '   - Scénario C : sortie / rupture pilotée (si pertinent)',
            '   Pour chaque scénario, préciser :',
            '     • Hypothèse centrale et trajectoire',
            '     • Conditions de faisabilité (prérequis, leviers, seuils de risque)',
            '     • Principaux risques (humains, narratifs, de gouvernance, réputationnels)',
            '     • Gains potentiels et points de vigilance',
            '',
            '3) Donner une courte LECTURE COMPARATIVE :',
            '   - Dans quels cas chaque scénario peut être pertinent ou au contraire dangereux.',
            '',
            '4) Terminer par 2 à 4 QUESTIONS D’AFFINEMENT à poser au décideur,',
            '   pour préparer un travail plus approfondi ou un Pré-brief Board.',
            '',
            'Style :',
            '- Français, ton neutre, analytique, compatible board / comité.',
            '- Phrases claires, listes à puces autorisées.',
            '- Pas de dramatisation, pas de storytelling inutile.',
            '',
            'Si l’utilisateur donne des détails très identifiants, tu peux suggérer d’anonymiser (PDG, DRH, board, etc.).'
          ].join('\n')
        },
        {
          role: 'user',
          content: message
        }
      ]
    });

    const reply =
      completion &&
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
        ? completion.choices[0].message.content.trim()
        : "Je n’ai pas pu générer d’analyse exploitable. Pouvez-vous reformuler votre situation en quelques lignes (contexte, acteurs, risques, échéances) ?";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Erreur OpenAI ghostops-studio-scenarios :', err);
    return res.status(500).json({
      error: 'Erreur lors de l’analyse IA pour le Studio Scénarios.',
      details: err && err.message ? err.message : String(err),
    });
  }
};
