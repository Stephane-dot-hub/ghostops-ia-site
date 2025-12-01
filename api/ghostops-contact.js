// api/ghostops-contact.js
const nodemailer = require("nodemailer");

module.exports = async (req, res) => {
  // 1) Méthode HTTP
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { name, email, role, company, message } = req.body || {};

    // 2) Validation minimale
    if (!name || !email || !message) {
      return res
        .status(400)
        .json({ error: "Merci de renseigner au minimum nom, e-mail et message." });
    }

    // 3) Lecture des variables d'environnement
    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      CONTACT_RECEIVER,
    } = process.env;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !CONTACT_RECEIVER) {
      console.error("Configuration SMTP incomplète :", {
        hasHost: !!SMTP_HOST,
        hasPort: !!SMTP_PORT,
        hasUser: !!SMTP_USER,
        hasPass: !!SMTP_PASS,
        hasReceiver: !!CONTACT_RECEIVER,
      });

      return res.status(500).json({
        error: "Configuration serveur incomplète (SMTP).",
      });
    }

    // 4) Transporteur SMTP
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465, // true si port 465 (SSL)
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // 5) Contenu de l’email
    const subject = `Nouveau brief GhostOps – ${name}`;
    const textBody = `
Nouveau brief GhostOps via le formulaire.

Nom : ${name}
E-mail : ${email}
Rôle : ${role || "(non précisé)"}
Entreprise : ${company || "(non précisé)"}

Message :
${message}
    `.trim();

    const htmlBody = `
      <p><strong>Nouveau brief GhostOps via le formulaire.</strong></p>
      <p><strong>Nom :</strong> ${name}</p>
      <p><strong>E-mail :</strong> ${email}</p>
      <p><strong>Rôle :</strong> ${role || "(non précisé)"}</p>
      <p><strong>Entreprise :</strong> ${company || "(non précisé)"}</p>
      <p><strong>Message :</strong></p>
      <p>${(message || "").replace(/\n/g, "<br>")}</p>
    `;

    const mailOptions = {
      from: `"GhostOps – Formulaire" <${SMTP_USER}>`,
      to: CONTACT_RECEIVER, // <= adresse de réception réelle (cachée du front)
      replyTo: email,       // <= si vous répondez, ça partira vers l’expéditeur
      subject: subject,
      text: textBody,
      html: htmlBody,
    };

    // 6) Envoi
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      ok: true,
      message: "Brief transmis avec succès.",
    });
  } catch (err) {
    console.error("Erreur GhostOps contact :", err);
    return res
      .status(500)
      .json({ error: "Erreur interne lors de l’envoi de votre brief." });
  }
};
