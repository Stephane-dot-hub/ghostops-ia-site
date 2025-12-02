// /api/ghostops-contact.js
const nodemailer = require('nodemailer');

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
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    // --- 1) Récupération des données envoyées par le formulaire ---
    // Vercel parse normalement le JSON automatiquement si le Content-Type est application/json
    const { name, email, company, role, subject, message } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Merci de renseigner au minimum votre nom, votre email et le message.',
      });
    }

    // --- 2) Vérification de la configuration SMTP ---
    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      CONTACT_TO,
      CONTACT_FROM,
    } = process.env;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      return res.status(500).json({
        ok: false,
        error: "Configuration e-mail incomplète côté serveur (SMTP).",
      });
    }

    const toAddress = CONTACT_TO || SMTP_USER;
    const fromAddress =
      CONTACT_FROM || `GhostOps Contact <${SMTP_USER}>`;

    // --- 3) Création du transporteur Nodemailer ---
    const portNumber = parseInt(SMTP_PORT, 10) || 465;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: portNumber,
      secure: portNumber === 465, // true pour 465, false pour 587
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // (Optionnel) Vérifier la connexion SMTP pour un debug plus fin
    try {
      await transporter.verify();
    } catch (verifyError) {
      console.error('Erreur de vérification SMTP GhostOps :', verifyError);
      return res.status(500).json({
        ok: false,
        error: "Impossible de se connecter au serveur SMTP (vérifier HOST / PORT / USER / PASS).",
        details: verifyError.message || null,
      });
    }

    // --- 4) Construction du contenu du mail ---
    const subjectLine =
      subject && subject.trim().length > 0
        ? `[GhostOps] ${subject.trim()}`
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

    // --- 5) Envoi du mail ---
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: toAddress,
        replyTo: email, // pour répondre directement au décideur
        subject: subjectLine,
        text: textBody,
        html: htmlBody,
      });
    } catch (sendError) {
      console.error('Erreur envoi mail GhostOps :', sendError);
      return res.status(500).json({
        ok: false,
        error: "Erreur lors de l’envoi de l’e-mail.",
        details: sendError.message || null,
      });
    }

    // --- 6) Réponse OK au front ---
    return res.status(200).json({
      ok: true,
      message: 'Brief envoyé avec succès.',
    });
  } catch (err) {
    console.error('Erreur inattendue GhostOps contact :', err);
    return res.status(500).json({
      ok: false,
      error: "Erreur serveur inattendue.",
      details: err.message || null,
    });
  }
};
