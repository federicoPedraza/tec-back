const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();
const { ConvexHttpClient } = require("convex/browser");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Convex client
const convex = new ConvexHttpClient(process.env.CONVEX_URL || "https://your-convex-deployment.convex.cloud");

// Create nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODEMAILER_USER,
    pass: process.env.NODEMAILER_PASSWORD
  }
});

// Middleware
app.use(cors({
  origin: [
    'https://the-english-crab-app.vercel.app',
    'https://the-english-crab-app-git-main-federico-pedrazas-projects.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200
}));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Get all contacts endpoint
app.get('/contacts', async (req, res) => {
  try {
    const contacts = await convex.query("contacts:getAllContacts");
    res.json({ contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Error fetching contacts', details: error.message });
  }
});

// Get all requests endpoint
app.get('/requests', async (req, res) => {
  try {
    const requests = await convex.query("requests:getAllRequests");
    res.json({ requests });
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Error fetching requests', details: error.message });
  }
});

// Get requests by status endpoint
app.get('/requests/status/:status', async (req, res) => {
  try {
    const { status } = req.params;
    if (status !== 'pending' && status !== 'processed') {
      return res.status(400).json({ error: 'Status must be either "pending" or "processed"' });
    }

    const requests = await convex.query("requests:getRequestsByStatus", { status });
    res.json({ requests });
  } catch (error) {
    console.error('Error fetching requests by status:', error);
    res.status(500).json({ error: 'Error fetching requests by status', details: error.message });
  }
});

// Onboarding endpoint
app.post('/onboarding', async (req, res) => {
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

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ success: false });
    }

    // Save to Convex database
    const { contactId, requestId } = await convex.mutation("requests:addOnboarding", {
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
    });

    // Email para el administrador/empresa
    const adminMailOptions = {
      from: process.env.NODEMAILER_USER,
      to: process.env.NODEMAILER_USER, // Enviar al mismo email del remitente
      subject: `Nueva solicitud de onboarding - ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
            Nueva solicitud de onboarding
          </h2>

          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Información de contacto</h3>
            <p><strong>Nombre:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Teléfono:</strong> ${phone || 'No proporcionado'}</p>
          </div>

          <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Objetivo de aprendizaje</h3>
            <p>${objective || 'No especificado'}</p>
          </div>

          ${experience ? `
          <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Experiencia con el inglés</h3>
            <p><strong>Experiencia general:</strong> ${experience}</p>
            ${experienceLevel ? `<p><strong>Nivel de experiencia:</strong> ${experienceLevel}</p>` : ''}
            ${speakingExperience ? `<p><strong>Experiencia hablando:</strong> ${speakingExperience}</p>` : ''}
            ${listeningExperience ? `<p><strong>Experiencia escuchando:</strong> ${listeningExperience}</p>` : ''}
            ${readingExperience ? `<p><strong>Experiencia leyendo:</strong> ${readingExperience}</p>` : ''}
            ${writingExperience ? `<p><strong>Experiencia escribiendo:</strong> ${writingExperience}</p>` : ''}
          </div>
          ` : ''}

          ${comment ? `
          <div style="background-color: #fefce8; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Comentario adicional</h3>
            <p style="font-style: italic;">"${comment}"</p>
          </div>
          ` : ''}

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
            <p>Email enviado desde el formulario de onboarding de The English Crab</p>
            <p>Fecha: ${new Date().toLocaleString('es-ES')}</p>
          </div>
        </div>
      `,
    };

    // Email de confirmación para el usuario
    const userMailOptions = {
      from: `"The English Crab" <${process.env.NODEMAILER_USER}>`,
      to: email,
      subject: '¡Bienvenido a The English Crab! 🦀',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin-bottom: 10px;">¡Bienvenido a The English Crab! 🦀</h1>
            <p style="color: #6b7280; font-size: 18px;">¡Gracias por unirte a nuestra comunidad de aprendizaje!</p>
          </div>

          <div style="background-color: #f8fafc; padding: 25px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 0; font-size: 16px; line-height: 1.6;">
              Hola <strong>${name}</strong>,
            </p>
            <p style="font-size: 16px; line-height: 1.6;">
              Hemos recibido tu solicitud de onboarding y estamos emocionados de acompañarte en tu viaje de aprendizaje del inglés.
            </p>
            <p style="font-size: 16px; line-height: 1.6;">
              Nuestro equipo revisará tu información y te contactaremos muy pronto para coordinar tu plan de estudios personalizado.
            </p>
          </div>

          <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1e40af; margin-top: 0;">¿Qué sigue?</h3>
            <ul style="color: #374151; line-height: 1.6;">
              <li>Te contactaremos en las próximas 24-48 horas</li>
              <li>Programaremos una entrevista inicial para conocerte mejor</li>
              <li>Diseñaremos un plan de estudios adaptado a tus objetivos</li>
              <li>¡Comenzaremos tu aventura de aprendizaje!</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #6b7280; margin: 0;">
              Si tienes alguna pregunta, no dudes en contactarnos.
            </p>
            <p style="color: #2563eb; font-weight: bold; margin: 10px 0;">
              ¡Nos vemos pronto! 🚀
            </p>
          </div>

          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; text-align: center;">
            <p>The English Crab Team</p>
            <p>Este email fue enviado porque completaste nuestro formulario de onboarding.</p>
          </div>
        </div>
      `,
    };

    // Enviar ambos emails
    const [adminResult, userResult] = await Promise.all([
      transporter.sendMail(adminMailOptions),
      transporter.sendMail(userMailOptions)
    ]);

    console.log('Emails sent successfully:', {
      admin: adminResult.messageId,
      user: userResult.messageId
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ success: false });
  }
});

// Interview endpoint
app.post('/interview', async (req, res) => {
  try {
    const {
      name,
      email,
      phone
    } = req.body;

    // Validate required fields
    if (!name || (!email && !phone)) {
      return res.status(400).json({ success: false });
    }

    // Save to Convex database
    const { contactId, requestId } = await convex.mutation("requests:addInterview", {
      name,
      email,
      phone
    });

    // Email para el administrador/empresa
    const adminMailOptions = {
      from: process.env.NODEMAILER_USER,
      to: process.env.NODEMAILER_USER, // Enviar al mismo email del remitente
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

      userResult = await transporter.sendMail(userMailOptions);
    }

    // Enviar email al administrador
    const adminResult = await transporter.sendMail(adminMailOptions);

    console.log('Interview request emails sent successfully:', {
      admin: adminResult.messageId,
      user: userResult?.messageId || 'No user email provided'
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Interview email error:', error);
    res.status(500).json({ success: false });
  }
});

// Newsletter subscribe endpoint
app.post('/newsletter/subscribe', async (req, res) => {
  try {
    const { name, email } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ success: false });
    }

    // Subscribe to newsletter
    await convex.mutation("newsletter:subscribe", {
      name,
      email
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error subscribing to newsletter:', error);
    res.status(500).json({ success: false });
  }
});

// Newsletter unsubscribe endpoint
app.post('/newsletter/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({ success: false });
    }

    // Unsubscribe from newsletter
    await convex.mutation("newsletter:unsubscribe", {
      email
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error unsubscribing from newsletter:', error);
    res.status(500).json({ success: false });
  }
});

// Get newsletter subscription status endpoint
app.get('/newsletter/subscription/:email', async (req, res) => {
  try {
    const { email } = req.params;

    // Get subscription status
    const subscription = await convex.query("newsletter:getSubscription", {
      email
    });

    if (!subscription) {
      return res.json({ subscribed: false, message: 'No subscription found for this email' });
    }

    res.json({
      subscribed: subscription.active,
      subscription
    });
  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ error: 'Error getting subscription status', details: error.message });
  }
});

// Get all active newsletter subscriptions endpoint
app.get('/newsletter/subscribers', async (req, res) => {
  try {
    const subscribers = await convex.query("newsletter:getAllActiveSubscriptions");
    res.json({ subscribers });
  } catch (error) {
    console.error('Error fetching newsletter subscribers:', error);
    res.status(500).json({ error: 'Error fetching newsletter subscribers', details: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}`);
  console.log(`Onboarding endpoint: POST http://localhost:${PORT}/onboarding`);
  console.log(`Interview endpoint: POST http://localhost:${PORT}/interview`);
  console.log(`Newsletter subscribe: POST http://localhost:${PORT}/newsletter/subscribe`);
  console.log(`Newsletter unsubscribe: POST http://localhost:${PORT}/newsletter/unsubscribe`);
  console.log(`Newsletter status: GET http://localhost:${PORT}/newsletter/subscription/{email}`);
  console.log(`Newsletter subscribers: GET http://localhost:${PORT}/newsletter/subscribers`);
  console.log(`Contacts endpoint: GET http://localhost:${PORT}/contacts`);
  console.log(`Requests endpoint: GET http://localhost:${PORT}/requests`);
  console.log(`Requests by status: GET http://localhost:${PORT}/requests/status/{pending|processed}`);
});
