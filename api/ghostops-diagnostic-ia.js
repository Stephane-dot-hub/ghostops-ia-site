// /api/ghostops-diagnostic-ia.js

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    try {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => resolve(data));
      req.on('error', (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
}

async function readJsonPayload(req) {
  // 1) Si déjà parsé (cas Next.js classique)
  if (req.body && typeof req.body === 'object') return req.body;

  // 2) Si body fourni en string
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  // 3) Sinon: lecture brute du flux HTTP (cas Vercel/serverless selon configuration)
  const raw = await readRawBody(req);
  if (!raw || !raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function pickFirstNonEmptyString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

export default async function handler(req, res) {
  // Autoriser uniquement le POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY non configurée sur le serveur (Vercel > Variables d’environnement).',
    });
  }

  // Lecture payload robuste
  let payload = {};
  try {
    payload = await readJsonPayload(req);
  } catch (e) {
    console.error('Diagnostic IA - impossible de lire le body :', e);
    payload = {};
  }

  // IMPORTANT : log utile (à regarder dans Vercel > Functions logs)
  console.log('Diagnostic IA payload reçu :', payload);

  const description = payload?.description;
  const message = payload?.message;
  const contexte = payload?.contexte;
  const enjeu = payload?.enjeu;

  // On accepte description OU message
  const effectiveDescription = pickFirstNonEmptyString(description, message);

  if (!effectiveDescription) {
    // Log raw utile pour trancher définitivement
    try {
      const raw = await readRawBody(req);
      console.log('Diagnostic IA raw body (debug) :', raw);
    } catch (_) {}

    return res.status(400).json({
      error: 'Le champ "description" est obligatoire pour le diagnostic.',
    });
  }

  const safeContexte = typeof contexte === 'string' ? contexte : '';
  const safeEnjeu = typeof enjeu === 'string' ? enjeu : '';

  // Prompts
  const systemPrompt = `
Tu es "GhostOps IA – Diagnostic", IA utilisée en back-office dans le produit payant
"GhostOps Diagnostic IA – 90 minutes".

Ta mission :
- produire une lecture tactique structurée d'une situation complexe
  (crise RH, dirigeant exposé, jeux de pouvoir internes, blocages de gouvernance,
   enjeux d'influence interne/externe),
- sans résoudre totalement le cas,
- et sans te substituer à un conseil humain (juridique, RH, gouvernance).

Règles :
- Réponds en français, ton formel, professionnel, sobre.
- Pas de conseil juridique formel, pas de stratégie procédurale détaillée, pas de qualification pénale.
- Aucune manœuvre illégale, représailles ou contournement de règles.
- Niveau "lecture tactique" : clarification, cartographie, options de lecture, questions structurantes.
- Style assumable devant un board (clair, dense, sans jargon creux).
- Termine par : "Ce pré-diagnostic ne remplace ni un avis juridique, ni un conseil RH individualisé, ni une mission GhostOps complète."
`.trim();

  const userPrompt = `
Tu vas produire un pré-diagnostic structuré à partir des éléments suivants.

Données fournies par l’utilisateur :

- Description principale :
"""${effectiveDescription}"""

- Contexte complémentaire (si présent) :
"""${safeContexte}"""

- Enjeux / risques perçus (si présent) :
"""${safeEnjeu}"""

Ta réponse doit suivre strictement la structure ci-dessous, avec les titres exacts :

1) Synthèse de la situation telle que je la comprends
2) Points de tension majeurs
3) Questions à clarifier en priorité lors du Diagnostic IA (90 min)
4) Première cartographie des risques (hors droit pur)
   4.1. Risques Humains / RH
   4.2. Risques de Gouvernance / Pouvoir
   4.3. Risques Narratifs / Réputation
5) Niveau de tension estimé (indication qualitative)
6) Conclusion et intérêt d’une séance GhostOps Diagnostic IA – 90 minutes

Contraintes :
- Synthétique et sélectif.
- Pas de plan d’exécution détaillé.
- Ne modifie pas les titres.
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
      console.error('Erreur OpenAI Diagnostic IA :', data);
      return res.status(openaiResponse.status).json({
        error: data?.error?.message || `Erreur OpenAI (HTTP ${openaiResponse.status})`,
      });
    }

    let reply = 'Je n’ai pas pu générer de pré-diagnostic utile.';

    // Format Responses API
    const maybeText =
      data?.output?.[0]?.content?.find?.((c) => c?.type === 'output_text')?.text ||
      data?.output?.[0]?.content?.[0]?.text;

    if (typeof maybeText === 'string' && maybeText.trim()) {
      reply = maybeText.trim();
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Erreur lors de l’appel à OpenAI (Diagnostic IA) :', err);
    return res.status(500).json({
      error: 'Une erreur interne est survenue lors de l’appel au moteur GhostOps Diagnostic IA.',
    });
  }
}
