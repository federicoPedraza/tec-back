const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
  'https://www.theenglishcrab.com',
  'https://theenglishcrab.com',
  'https://the-english-crab-app.vercel.app',
  'https://fresh-louse-regularly.ngrok-free.app',
  'http://localhost:5173'
];
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODEMAILER_USER,
    pass: process.env.NODEMAILER_PASSWORD
  }
});

// logger
app.use((req, res, next) => {
  const startTimeNs = process.hrtime.bigint();
  const { method, originalUrl } = req;
  console.log(`📥 [REQ] ${method} ${originalUrl}`);
  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - startTimeNs) / 1000000n);
    console.log(`📤 [RES] ${method} ${originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
  });
  next();
});

// Unified error logger to always include message and stack
const logError = (context, err) => {
  const message = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? err.stack : undefined;
  if (stack) {
    console.error(`[ERR] ${context} -> ${message}\n${stack}`);
  } else {
    console.error(`[ERR] ${context} -> ${message}`);
  }
};

// Template loader helper
const loadTemplate = (filename, variables = {}) => {
  try {
    const templatePath = path.join(__dirname, 'templates', 'html', filename);
    let template = fs.readFileSync(templatePath, 'utf8');
    
    // Replace all placeholders
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      template = template.replace(regex, variables[key] || '');
    });
    
    return template;
  } catch (err) {
    logError(`Load template ${filename}`, err);
    throw err;
  }
};

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// API routes - proxy to Vercel function handlers for local development
app.all('/api/generate-token', async (req, res) => {
  try {
    const handler = (await import('./api/generate-token.js')).default;
    return handler(req, res);
  } catch (error) {
    logError('Load generate-token handler', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.all('/api/onboarding', async (req, res) => {
  try {
    const handler = (await import('./api/onboarding.js')).default;
    return handler(req, res);
  } catch (error) {
    logError('Load onboarding handler', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.all('/api/interview', async (req, res) => {
  try {
    const handler = (await import('./api/interview.js')).default;
    return handler(req, res);
  } catch (error) {
    logError('Load interview handler', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// JWT token generation endpoint
app.post('/generate-token', (req, res) => {
  try {
    const { payload, expiresIn } = req.body;
    
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payload. Payload must be an object.' 
      });
    }

    const secretKey = process.env.JWT_SECRET_KEY;
    if (!secretKey) {
      logError('Generate token', new Error('JWT_SECRET_KEY not configured'));
      return res.status(500).json({ 
        success: false, 
        error: 'Server configuration error' 
      });
    }

    const options = {};
    if (expiresIn && typeof expiresIn === 'string') {
      options.expiresIn = expiresIn;
    }

    const token = jwt.sign(payload, secretKey, options);

    console.log('✅ JWT token generated successfully');
    res.json({ success: true, token });
  } catch (error) {
    logError('Generate token', error);
    res.status(500).json({ success: false, error: 'Failed to generate token' });
  }
});

// Onboarding endpoint (emails only)
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
});

// Interview endpoint (emails only)
app.post('/interview', async (req, res) => {
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

      userResult = await transporter.sendMail(userMailOptions);
    }

    const adminResult = await transporter.sendMail(adminMailOptions);

    console.log('✅ Interview request emails sent successfully:', {
      admin: adminResult.messageId,
      user: userResult?.messageId || 'No user email provided'
    });

    res.json({ success: true });
  } catch (error) {
    logError('Interview email', error);
    res.status(500).json({ success: false });
  }
});

// Centralized error handler (must be after all routes)
app.use((err, req, res, next) => {
  try {
    const { method, originalUrl } = req || {};
    logError(`${method || 'UNKNOWN'} ${originalUrl || ''}`, err);
  } catch (_) {}
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}`);
  console.log(`📧 Onboarding endpoint: POST http://localhost:${PORT}/onboarding`);
  console.log(`📧 API Onboarding endpoint: POST http://localhost:${PORT}/api/onboarding`);
  console.log(`🎤 Interview endpoint: POST http://localhost:${PORT}/interview`);
  console.log(`🎤 API Interview endpoint: POST http://localhost:${PORT}/api/interview`);
  console.log(`🔑 JWT generation endpoint: POST http://localhost:${PORT}/generate-token`);
  console.log(`🔑 API JWT generation endpoint: POST http://localhost:${PORT}/api/generate-token`);
});
