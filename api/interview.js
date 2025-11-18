import { transporter, logError, setCorsHeaders } from './utils.js';

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
      phone
    } = req.body;

    if (!name || (!email && !phone)) {
      return res.status(400).json({ success: false });
    }

    const adminMailOptions = {
      from: process.env.NODEMAILER_USER,
      to: process.env.NODEMAILER_USER,
      subject: `Nueva solicitud de entrevista - ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
            Nueva solicitud de entrevista
          </h2>

          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Información de contacto</h3>
            <p><strong>Nombre:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email || 'No proporcionado'}</p>
            <p><strong>Teléfono:</strong> ${phone || 'No proporcionado'}</p>
          </div>

          <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Tipo de solicitud</h3>
            <p>🎯 <strong>Solicitud de entrevista personalizada</strong></p>
            <p>El estudiante está interesado en agendar una entrevista para evaluar su nivel y planificar su aprendizaje.</p>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
            <p>Email enviado desde el formulario de entrevistas de The English Crab</p>
            <p>Fecha: ${new Date().toLocaleString('es-ES')}</p>
          </div>
        </div>
      `,
    };

    // Email de confirmación para el usuario (solo si proporcionó email)
    let userResult = null;
    if (email) {
      const userMailOptions = {
        from: `"The English Crab" <${process.env.NODEMAILER_USER}>`,
        to: email,
        subject: '¡Tu entrevista con The English Crab está en proceso! 🦀',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin-bottom: 10px;">¡Gracias por solicitar una entrevista! 🦀</h1>
              <p style="color: #6b7280; font-size: 18px;">¡Estamos emocionados de conocerte!</p>
            </div>

            <div style="background-color: #f8fafc; padding: 25px; border-radius: 10px; margin: 20px 0;">
              <p style="margin: 0; font-size: 16px; line-height: 1.6;">
                Hola <strong>${name}</strong>,
              </p>
              <p style="font-size: 16px; line-height: 1.6;">
                Hemos recibido tu solicitud de entrevista y estamos emocionados de tener la oportunidad de conocerte mejor.
              </p>
              <p style="font-size: 16px; line-height: 1.6;">
                Nuestro equipo se pondrá en contacto contigo muy pronto para coordinar tu entrevista personalizada.
              </p>
            </div>

            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e40af; margin-top: 0;">¿Qué sigue?</h3>
              <ul style="color: #374151; line-height: 1.6;">
                <li>Te contactaremos en las próximas 24 horas</li>
                <li>Coordinaremos una entrevista de 30-60 minutos</li>
                <li>Evaluaremos juntos tu nivel actual</li>
                <li>Diseñaremos el mejor plan para alcanzar tus objetivos</li>
                <li>¡Todo en un ambiente relajado y divertido!</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #6b7280; margin: 0;">
                Si tienes alguna pregunta, no dudes en contactarnos.
              </p>
              <p style="color: #2563eb; font-weight: bold; margin: 10px 0;">
                ¡Nos vemos pronto en tu entrevista! 🚀
              </p>
            </div>

            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; text-align: center;">
              <p>The English Crab Team</p>
              <p>Este email fue enviado porque solicitaste una entrevista con nosotros.</p>
            </div>
          </div>
        `,
      };

      // userResult = await transporter.sendMail(userMailOptions); // Commented out - not sending email to client for now
      userResult = null;
    }

    // Only send admin email if not in local environment
    // If IS_LOCAL is not present in .env, emails will be sent (assuming it's not local)
    let adminResult = null;
    if (process.env.IS_LOCAL !== 'true') {
      adminResult = await transporter.sendMail(adminMailOptions);
    }

    console.log('✅ Interview request emails sent successfully:', {
      admin: adminResult?.messageId || (process.env.IS_LOCAL === 'true' ? 'Skipped (IS_LOCAL=true)' : 'Failed'),
      user: userResult?.messageId || 'No user email provided'
    });

    res.json({ success: true });
  } catch (error) {
    logError('Interview email', error);
    res.status(500).json({ success: false });
  }
}

