// /api/ghostops-contact.js
const nodemailer = require('nodemailer');
const querystring = require('querystring');

// Helper pour parser le body de manière robuste
async function getParsedBody(req) {
  // Si Vercel a déjà mis quelque chose dans req.body
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        // pas du JSON, on continue
      }
    } else if (typeof req.body === 'object') {
      return req.body;
    }
  }

  // Sinon on lit le flux brut
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8') || '';

  if (!raw) return {};

  const contentType = (req.headers['content-type'] || '').toLowerCase();

  // JSON
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  // Formulaire classique
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return querystring.parse(raw);
  }

  // Par défaut
  return { raw };
}

module.exports = async function handler(req, res) {
  // Health-check en GET
  if (req.method === 'GET') {
    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      CONTACT_TO,
      CONTACT_FROM,
    } = process.env;

    return res.status(200).json({
      ok: true,
      message: 'Endpoint GhostOps contact opérationnel (utiliser POST pour le formulaire).',
      env: {
        SMTP_HOST: !!SMTP_HOST,
        SMTP_PORT: !!SMTP_PORT,
        SMTP_USER: !!SMTP_USER,
        SMTP_PASS: !!SMTP_PASS,
        CONTACT_TO: !!CONTACT_TO,
        CONTACT_FROM: !!CONTACT_FROM,
      },
    });
  }

  // Refuser les autres méthodes
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  }

  try {
    // 1) Récupération et parsing du body
    const body = await getParsedBody(req) || {};

    // Tolérance sur les noms de champs
    const name =
      body.name ||
      body.nom ||
      body.fullName ||
      body.fullname ||
      body['full-name'];

    const email =
      body.email ||
      body.mail ||
      body['e-mail'];

    const message =
      body.message ||
      body.msg ||
      body.contenu ||
      body.commentaire;

    const company =
      body.company ||
      body.structure ||
      body.societe ||
      body.entreprise;

    const role =
      body.role ||
      body.fonction ||
      body.poste ||
      body.titre;

    const subject =
      body.subject ||
      body.sujet ||
      '';

    if (!name || !email || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Merci de renseigner au minimum votre nom, votre email et le message.',
      });
    }

    // 2) Vérification de la configuration SMTP
    const {
      SMTP_USER,
      SMTP_PASS,
      CONTACT_TO,
      CONTACT_FROM,
    } = process.env;

    if (!SMTP_USER || !SMTP_PASS) {
      return res.status(500).json({
        ok: false,
        error: 'Configuration e-mail incomplète côté serveur (SMTP_USER / SMTP_PASS).',
      });
    }

    const toAddress = CONTACT_TO || SMTP_USER;
    const fromAddress = CONTACT_FROM || `GhostOps Contact <${SMTP_USER}>`;

    // 3) Création du transporteur Nodemailer (Gmail + mot de passe d’application)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // 4) Construction du contenu du mail
    const subjectLine =
      subject && subject.toString().trim().length > 0
        ? `[GhostOps] ${subject.toString().trim()}`
        : `[GhostOps] Nouveau brief confidentiel de ${name}`;

    const textBody = `
NOUVEAU BRIEF GHOSTOPS

Nom       : ${name}
E-mail    : ${email}
Fonction  : ${role || 'Non précisé'}
Structure : ${company || 'Non précisé'}

Message :
${message}
    `.trim();

    const htmlBody = `
      <h2>Nouveau brief confidentiel GhostOps</h2>
      <p><strong>Nom :</strong> ${name}</p>
      <p><strong>E-mail :</strong> ${email}</p>
      <p><strong>Fonction :</strong> ${role || 'Non précisé'}</p>
      <p><strong>Structure :</strong> ${company || 'Non précisé'}</p>
      <hr />
      <p><strong>Message :</strong></p>
      <p style="white-space:pre-line;">${message}</p>
    `;

    // 5) Envoi du mail
    await transporter.sendMail({
      from: fromAddress,
      to: toAddress,
      replyTo: email,
      subject: subjectLine,
      text: textBody,
      html: htmlBody,
    });

    // 6) Réponse OK au front
    return res.status(200).json({
      ok: true,
      message: 'Brief envoyé avec succès.',
    });
  } catch (err) {
    console.error('Erreur inattendue GhostOps contact :', err);
    return res.status(500).json({
      ok: false,
      error: 'Erreur serveur inattendue.',
      details: err && err.message ? err.message : String(err),
    });
  }
};
