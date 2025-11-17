import { transporter, logError, loadTemplate, setCorsHeaders } from './utils.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const {
      name,
      email,
      phone,
      objective,
      experience,
      experienceLevel,
      speakingExperience,
      listeningExperience,
      readingExperience,
      writingExperience,
      comment
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false });
    }

    // Build experience section conditionally
    let experienceSection = '';
    if (experience) {
      experienceSection = `
        <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #374151; margin-top: 0;">Experiencia con el inglés</h3>
          <p><strong>Experiencia general:</strong> ${experience}</p>
          ${experienceLevel ? `<p><strong>Nivel de experiencia:</strong> ${experienceLevel}</p>` : ''}
          ${speakingExperience ? `<p><strong>Experiencia hablando:</strong> ${speakingExperience}</p>` : ''}
          ${listeningExperience ? `<p><strong>Experiencia escuchando:</strong> ${listeningExperience}</p>` : ''}
          ${readingExperience ? `<p><strong>Experiencia leyendo:</strong> ${readingExperience}</p>` : ''}
          ${writingExperience ? `<p><strong>Experiencia escribiendo:</strong> ${writingExperience}</p>` : ''}
        </div>
      `;
    }

    // Build comment section conditionally
    let commentSection = '';
    if (comment) {
      commentSection = `
        <div style="background-color: #fefce8; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #374151; margin-top: 0;">Comentario adicional</h3>
          <p style="font-style: italic;">"${comment}"</p>
        </div>
      `;
    }

    // Email para el administrador/empresa
    const adminMailOptions = {
      from: process.env.NODEMAILER_USER,
      to: process.env.NODEMAILER_USER,
      subject: `Nueva solicitud de onboarding - ${name}`,
      html: loadTemplate('onboarding-request.html', {
        name,
        email,
        phone: phone || 'No proporcionado',
        objective: objective || 'No especificado',
        experienceSection,
        commentSection,
        date: new Date().toLocaleString('es-ES')
      })
    };

    // Email de confirmación para el usuario
    const userMailOptions = {
      from: `"The English Crab" <${process.env.NODEMAILER_USER}>`,
      to: email,
      subject: '¡Bienvenido a The English Crab! 🦀',
      html: loadTemplate('welcome.html', {
        name
      })
    };

    const [adminResult, userResult] = await Promise.all([
      transporter.sendMail(adminMailOptions),
      transporter.sendMail(userMailOptions)
    ]);

    console.log('✅ Emails sent successfully:', {
      admin: adminResult.messageId,
      user: userResult.messageId
    });

    res.json({ success: true });
  } catch (error) {
    logError('Onboarding email', error);
    res.status(500).json({ success: false });
  }
}

