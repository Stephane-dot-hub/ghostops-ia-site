// pages/api/ghostops-diagnostic-ia.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // à adapter si vous utilisez une autre variable
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { description, contexte, enjeu, message, mode } = req.body || {};

    let systemPrompt = '';
    let userPrompt = '';

    // 1) CAS PRÉ-DIAGNOSTIC (page diagnostic-ia.html – widget public)
    if (description) {
      systemPrompt = `
Tu es "GhostOps IA – Pré-diagnostic".
Tu t'adresses à un dirigeant / membre de board / DRH confronté à une situation sensible (RH, gouvernance, jeux de pouvoir).

Objectif : produire une note courte, exploitable, structurée en 3 blocs numérotés :

1. Reformulation structurée de la situation
   - Clarifier le périmètre, les acteurs, les tensions, sans dramatisation.
2. Lecture des risques principaux
   - Risques humains / sociaux, narratifs (storytelling interne / externe), et de gouvernance.
3. Pistes de lecture et questions de cadrage
   - 2 à 3 angles de lecture possibles, sans plan d’action détaillé, avec quelques questions clés à se poser.

Contraintes :
- Français, ton sobre, professionnel, orienté décision.
- Pas de jargon inutile, pas de conseil juridique formel.
- Longueur indicative : 600 à 900 mots.
- Ne parle pas de "prompt" ou de "modèle IA".
      `.trim();

      const blocDescription = (description || '').trim();
      const blocContexte    = (contexte || '').trim();
      const blocEnjeu       = (enjeu || '').trim();

      userPrompt = `
DESCRIPTION DE LA SITUATION
${blocDescription || '[non renseigné]'}

CONTEXTE / HISTORIQUE (FACULTATIF)
${blocContexte || '[non renseigné]'}

ENJEUX ET RISQUES PERÇUS (FACULTATIF)
${blocEnjeu || '[non renseigné]'}

Merci de produire la note dans le format demandé (3 blocs numérotés).
      `.trim();
    }

    // 2) CAS SESSION DIAGNOSTIC IA (page diagnostic-ia-session.html – après paiement)
    else if (message) {
      systemPrompt = `
Tu es "GhostOps IA – Diagnostic 90 minutes".
Tu aides un décideur (PDG, membre de board, DRH, etc.) à lire une situation sensible
(crise RH, dirigeant exposé, site en tension, jeu de pouvoir interne).

Objectif : produire une note courte, structurée, directement exploitable en interne.

La note doit être structurée en 5 blocs numérotés :

1. Résumé exécutif
   - 10 à 15 lignes maximum, lisibles par un membre de board pressé.
2. Reformulation structurée de la situation
   - Périmètre, faits saillants, acteurs clés, lignes de force, sans nommer d’individus si ce n’est pas nécessaire.
3. Cartographie des risques principaux
   - Risques humains / sociaux, narratifs (image / discours interne et externe),
     et de gouvernance (alignement board, fonctions support, régulateur, etc.).
4. Options de lecture (2 à 3 maximum)
   - Ce ne sont PAS des plans d’exécution.
   - Chaque option = une manière de lire la situation (par ex. "crise de gouvernance locale",
     "conflit de mandat", "symptôme d’un problème de groupe", etc.), avec ses implications.
5. Points aveugles, questions clés et suites possibles
   - Questions à éclairer avant décision.
   - Exemples de suites possibles : rester en veille renforcée, approfondir via un Studio Scénarios,
     envisager un Pré-brief Board, ou mobiliser d’autres dispositifs internes.

Contraintes :
- Français, ton sobre, analytique, non dramatique.
- Pas de conseil juridique formel, pas de qualification pénale.
- Pas de mention du fait que tu es un modèle IA.
- Longueur indicative : 900 à 1 400 mots.
      `.trim();

      userPrompt = `
SITUATION DÉCRITE PAR LE DÉCIDEUR :

${message}

Merci de produire la note dans le format demandé (5 blocs numérotés 1 à 5).
      `.trim();
    }

    else {
      return res.status(400).json({
        error: 'Requête incomplète : fournissez soit (description, contexte, enjeu), soit un message.',
      });
    }

    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini', // ou le modèle que vous utilisez pour GhostOps
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Je n’ai pas pu générer de note exploitable à partir des éléments fournis.";

    return res.status(200).json({ reply });
  } catch (error: any) {
    console.error('Erreur /api/ghostops-diagnostic-ia :', error);
    return res.status(500).json({
      error: "Erreur interne côté GhostOps IA. Veuillez réessayer ou utiliser la page contact.",
    });
  }
}
