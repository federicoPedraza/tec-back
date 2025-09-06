const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('redis');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const crypto = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
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

// redis
const redis = createClient({
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  }
});
redis.connect();
const store = new RedisStore({
  client: redis,
  prefix: 'sess:'
});
app.set("trust proxy", 1);
app.use(session({
  store,
  secret: process.env.SESSION_PASSWORD,
  resave: false,
  saveUninitialized: false,
  name: "sid",
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}))

// nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODEMAILER_USER,
    pass: process.env.NODEMAILER_PASSWORD
  }
});

// Password hashing helpers (scrypt)
const derivePasswordHash = async (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt:1:${salt}:${Buffer.from(derivedKey).toString('hex')}`;
};

const verifyPassword = async (password, stored) => {
  try {
    const parts = String(stored).split(':');
    if (parts.length !== 4) return false;
    const [algo, version, salt, hashHex] = parts;
    if (algo !== 'scrypt' || version !== '1') return false;
    const derivedKey = await scryptAsync(password, salt, 64);
    const candidateHex = Buffer.from(derivedKey).toString('hex');
    const a = Buffer.from(candidateHex, 'hex');
    const b = Buffer.from(hashHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
};

const getMasterKey = () => process.env.LOGIN_MASTER_KEY || process.env.MASTER_KEY;

// logger
app.use((req, res, next) => {
  const startTimeNs = process.hrtime.bigint();
  const { method, originalUrl } = req;
  console.log(`[REQ] ${method} ${originalUrl}`);
  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - startTimeNs) / 1000000n);
    console.log(`[RES] ${method} ${originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Authentication (password-only)
app.post("/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.sendStatus(400);

    const storedHash = await redis.get('auth:password');
    if (storedHash) {
      const ok = await verifyPassword(password, storedHash);
      if (!ok) return res.sendStatus(401);
    } else {
      const configuredPassword = process.env.LOGIN_PASSWORD;
      if (!configuredPassword) {
        return res.status(500).json({ error: "No password configured" });
      }
      if (password !== configuredPassword) return res.sendStatus(401);
    }

    req.session.regenerate(err => {
      if (err) return res.sendStatus(500);
      req.session.userId = "password-only-user";
      res.sendStatus(204);
    });
  } catch (err) {
    logError('Login', err);
    res.sendStatus(500);
  }
});

// Create password (requires master key); fails if one already exists
app.post('/password/create', async (req, res) => {
  try {
    const { password, masterKey } = req.body || {};
    if (!password || !masterKey) return res.sendStatus(400);

    const configuredMasterKey = getMasterKey();
    if (!configuredMasterKey) {
      return res.status(500).json({ error: 'LOGIN_MASTER_KEY not configured' });
    }
    if (masterKey !== configuredMasterKey) return res.sendStatus(403);

    const existing = await redis.get('auth:password');
    if (existing) return res.status(409).json({ error: 'Password already set' });

    const hash = await derivePasswordHash(password);
    await redis.set('auth:password', hash);
    return res.sendStatus(201);
  } catch (err) {
    logError('Create password', err);
    res.sendStatus(500);
  }
});

// Recover/reset password (requires master key); overwrites existing password
app.post('/password/recover', async (req, res) => {
  try {
    const { newPassword, masterKey } = req.body || {};
    if (!newPassword || !masterKey) return res.sendStatus(400);

    const configuredMasterKey = getMasterKey();
    if (!configuredMasterKey) {
      return res.status(500).json({ error: 'LOGIN_MASTER_KEY not configured' });
    }
    if (masterKey !== configuredMasterKey) return res.sendStatus(403);

    const hash = await derivePasswordHash(newPassword);
    await redis.set('auth:password', hash);
    return res.sendStatus(204);
  } catch (err) {
    logError('Recover password', err);
    res.sendStatus(500);
  }
});

// Change password (requires active session). Validate old password, or accept MASTER_KEY as override
app.post('/admin/password', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) return res.sendStatus(401);
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.sendStatus(400);

    const storedHash = await redis.get('auth:password');
    const configuredPassword = process.env.LOGIN_PASSWORD;
    const configuredMasterKey = getMasterKey();

    let authorized = false;
    if (storedHash) {
      authorized = await verifyPassword(oldPassword, storedHash);
    } else if (configuredPassword) {
      authorized = oldPassword === configuredPassword;
    }
    if (!authorized && configuredMasterKey) {
      authorized = oldPassword === configuredMasterKey;
    }
    if (!authorized) return res.status(401).json({ error: 'Invalid old password' });

    const newHash = await derivePasswordHash(newPassword);
    await redis.set('auth:password', newHash);
    return res.sendStatus(204);
  } catch (err) {
    logError('Change password', err);
    res.sendStatus(500);
  }
});

app.get("/me", (req, res) => {
  if (!req.session.userId) return res.sendStatus(401)
  res.json({ userId: req.session.userId })
})

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.sendStatus(500)
    res.sendStatus(204)
  })
})

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

    // Email para el administrador/empresa
    const adminMailOptions = {
      from: process.env.NODEMAILER_USER,
      to: process.env.NODEMAILER_USER,
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

    console.log('Interview request emails sent successfully:', {
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
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}`);
  console.log(`Onboarding endpoint: POST http://localhost:${PORT}/onboarding`);
  console.log(`Interview endpoint: POST http://localhost:${PORT}/interview`);
});
