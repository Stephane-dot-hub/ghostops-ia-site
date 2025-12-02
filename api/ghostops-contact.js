// api/ghostops-contact.js

const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  // Récupération des variables d'environnement
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    CONTACT_TO,
    CONTACT_FROM,
  } = process.env;

  // --- GET = DIAGNOSTIC / HEALTHCHECK ---
  if (req.method === 'GET') {
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

  // --- AUTRE QUE POST = 405 ---
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // --- POST = TRAITEMENT FORMULAIRE ---

  // Sécurisation de la lecture du body (Vercel parse déjà le JSON)
  const body = req.body || {};
  const {
    name,
    email,
    role,
    company,
    perimeter,
    message,
  } = body;

  // Validation minimale des champs requis
  if (!name || !email || !message) {
    return res.status(400).json({
      error: 'Champs obligatoires manquants (nom, e-mail, message).',
    });
  }

  // Vérification de la configuration e-mail
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !CONTACT_TO || !CONTACT_FROM) {
    console.error('Configuration e-mail incomplète :', {
      SMTP_HOST: !!SMTP_HOST,
      SMTP_PORT: !!SMTP_PORT,
      SMTP_USER: !!SMTP_USER,
      SMTP_PASS: !!SMTP_PASS,
      CONTACT_TO: !!CONTACT_TO,
      CONTACT_FROM: !!CONTACT_FROM,
    });
    return res.status(500).json({
      error: 'Configuration e-mail incomplète côté serveur',
    });
  }

  // Création du transporteur SMTP
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true pour 465, false pour 587
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  // Sujet de l’e-mail
  const subjectParts = ['Brief confidentiel GhostOps'];
  if (role) subjectParts.push(`– ${role}`);
  if (company) subjectParts.push(`@ ${company}`);
  const subject = subjectParts.join(' ');

  // Contenu texte de l’e-mail
  const textContent = `
NOUVEAU BRIEF GHOSTOPS

Nom : ${name}
E-mail : ${email}
Rôle / Fonction : ${role || '(non renseigné)'}
Organisation : ${company || '(non renseigné)'}

Périmètre concerné :
${perimeter || '(non renseigné)'}

Message :
${message}

------
Ce message provient du formulaire de contact GhostOps.tech.
`.trim();

  const mailOptions = {
    from: CONTACT_FROM,
    to: CONTACT_TO,
    replyTo: email || CONTACT_FROM,
    subject,
    text: textContent,
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.status(200).json({
      ok: true,
      message: 'Brief confidentiel envoyé avec succès.',
    });
  } catch (err) {
    console.error('Erreur lors de l’envoi de l’e-mail GhostOps :', err);
    return res.status(500).json({
      error: 'Erreur lors de l’envoi de l’e-mail.',
      details: 'MAILER_ERROR',
    });
  }
};
