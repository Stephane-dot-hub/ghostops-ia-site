const nodemailer = require('nodemailer');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  // 1) Méthode HTTP autorisée
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  // 2) Lecture du corps brut (Vercel Node function "pure", sans framework)
  let rawBody = '';
  try {
    for await (const chunk of req) {
      rawBody += chunk;
    }
  } catch (err) {
    console.error('Erreur lecture du corps de requête :', err);
    res.status(400).json({ error: 'Requête invalide (lecture du corps)' });
    return;
  }

  // 3) Parsing JSON
  let data;
  try {
    data = JSON.parse(rawBody || '{}');
  } catch (err) {
    console.error('JSON invalide :', err);
    res.status(400).json({ error: 'Requête invalide (JSON mal formé)' });
    return;
  }

  const { nom, email, organisation, fonction, sujet, message } = data || {};

  // 4) Vérification des champs obligatoires
  if (!nom || !email || !message) {
    console.warn('Champs manquants :', { nom, email, message });
    res.status(400).json({ error: 'Champs obligatoires manquants (nom, email, message)' });
    return;
  }

  // 5) Vérification configuration SMTP (variables d’environnement Vercel)
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_TO } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_TO) {
    console.error('Configuration SMTP incomplète :', {
      SMTP_HOST: !!SMTP_HOST,
      SMTP_PORT: !!SMTP_PORT,
      SMTP_USER: !!SMTP_USER,
      SMTP_PASS: !!SMTP_PASS,
      SMTP_TO: !!SMTP_TO
    });
    res.status(500).json({ error: 'Configuration e-mail incomplète côté serveur' });
    return;
  }

  // 6) Transport Nodemailer
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true pour 465 (SSL)
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const mailSubject = `Brief confidentiel GhostOps – ${sujet || 'Situation'}`;

  const textBody = `Nouveau brief GhostOps reçu via le formulaire :

Nom        : ${nom}
E-mail     : ${email}
Organisation : ${organisation || '-'}
Fonction   : ${fonction || '-'}
Sujet      : ${sujet || '-'}

Message :
${message}
`;

  const htmlBody = `
    <p>Nouveau brief GhostOps reçu via le formulaire :</p>
    <ul>
      <li><strong>Nom :</strong> ${escapeHtml(nom)}</li>
      <li><strong>E-mail :</strong> ${escapeHtml(email)}</li>
      <li><strong>Organisation :</strong> ${escapeHtml(organisation || '-')}</li>
      <li><strong>Fonction :</strong> ${escapeHtml(fonction || '-')}</li>
      <li><strong>Sujet :</strong> ${escapeHtml(sujet || '-')}</li>
    </ul>
    <p><strong>Message :</strong></p>
    <pre style="white-space:pre-wrap;font-family:monospace;">${escapeHtml(message)}</pre>
  `;

  // 7) Envoi de l’e-mail
  try {
    await transporter.sendMail({
      from: `"GhostOps – Formulaire" <${SMTP_USER}>`,
      to: SMTP_TO,
      replyTo: email,
      subject: mailSubject,
      text: textBody,
      html: htmlBody
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erreur lors de l’envoi du mail GhostOps :', err);
    res.status(500).json({ error: 'Erreur lors de l’envoi de votre message' });
  }
};
