const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();
const { ConvexHttpClient } = require("convex/browser");
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Convex client
const convex = new ConvexHttpClient(process.env.CONVEX_URL || "https://your-convex-deployment.convex.cloud");

// Supabase client (service role for server-side operations)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
  : null;

// Sanitize filenames: remove spaces, diacritics, and unsafe URL characters
const sanitizeFilename = (name) => {
  try {
    if (!name || typeof name !== 'string') return 'file';
    const noPath = String(name).split('/').pop().split('\\').pop();
    const trimmed = noPath.trim();
    const dotIndex = trimmed.lastIndexOf('.');
    const base = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
    const ext = dotIndex > 0 ? trimmed.slice(dotIndex + 1) : '';

    const normalizedBase = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    let safe = normalizedBase
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-') // replace unsafe chars with '-'
      .replace(/-+/g, '-') // collapse multiple '-'
      .replace(/^[\-.]+|[\-.]+$/g, ''); // trim leading/trailing '.' or '-'
    if (!safe) safe = 'file';

    const safeExt = ext
      ? ext
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
      : '';

    return safeExt ? `${safe}.${safeExt}` : safe;
  } catch (_) {
    return 'file';
  }
};

// Helper: resolve a multimedia URL for a given image identifier (course-aware fallback)
const getCourseImageUrl = async (image, courseId) => {
  try {
    if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
      return image;
    }
    if (typeof image === 'string' && image.length) {
      const doc = await convex.query('multimedia:getById', { multimediaId: image });
      if (doc) {
        if (doc.storageProvider === 'supabase' && supabase && doc.supabaseBucket && doc.supabasePath) {
          const expiresIn = Number(process.env.SUPABASE_SIGNED_URL_TTL_SEC || 60 * 10);
          const { data, error } = await supabase.storage.from(doc.supabaseBucket).createSignedUrl(doc.supabasePath, expiresIn);
          if (!error) return data?.signedUrl || null;
        } else {
          const result = await convex.query('multimedia:getUrl', { multimediaId: image });
          if (result?.url) return result.url;
        }
      }
    }
    // Fallback: if courseId provided, try latest image linked to the course
    if (courseId) {
      const assets = await convex.query('multimedia:getCourseImages', { courseId });
      if (Array.isArray(assets) && assets.length) {
        const latest = assets.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
        if (latest.storageProvider === 'supabase' && supabase && latest.supabaseBucket && latest.supabasePath) {
          const expiresIn = Number(process.env.SUPABASE_SIGNED_URL_TTL_SEC || 60 * 10);
          const { data, error } = await supabase.storage.from(latest.supabaseBucket).createSignedUrl(latest.supabasePath, expiresIn);
          if (!error) return data?.signedUrl || null;
        } else if (latest._id) {
          const res = await convex.query('multimedia:getUrl', { multimediaId: latest._id });
          if (res?.url) return res.url;
        }
      }
    }
    return null;
  } catch (_) {
    return null;
  }
};

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
    'https://the-english-crab-app-federicopedraza-federico-pedrazas-projects.vercel.app',
    'https://the-english-crab-app-git-main-federico-pedrazas-projects.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  optionsSuccessStatus: 200
}));
// Explicitly enable preflight across-the-board
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Global request logger
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

// Deterministic password encryption (AES-256-ECB) using ENCRYPTION_KEY
const encryptPassword = (plain) => {
  const rawKey = process.env.ENCRYPTION_KEY;
  if (!rawKey) throw new Error('Missing ENCRYPTION_KEY');
  const key = crypto.createHash('sha256').update(String(rawKey)).digest();
  const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return encrypted.toString('hex');
};

// Simple admin auth middleware
const isAdmin = (req, res, next) => {
  try {
    const authHeader = req.get('authorization');
    const bearer = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    const tokenOk = process.env.ADMIN_TOKEN && bearer && bearer === process.env.ADMIN_TOKEN;

    if (tokenOk) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Admin login endpoint (password only, returns static token from env)
app.post('/admin/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    // Validate against Convex admin_credentials table
    try {
      const encrypted = encryptPassword(password);
      const result = await convex.mutation('requests:adminLogin', { password: encrypted });
      if (!result?.success) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (e) {
      logError('Convex admin login', e);
      return res.status(500).json({ error: 'Login failed' });
    }

    if (!process.env.ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Server misconfigured: missing ADMIN_TOKEN' });
    }

    // Return the configured token for subsequent Bearer auth
    return res.json({ token: process.env.ADMIN_TOKEN, tokenType: 'Bearer' });
  } catch (error) {
    logError('Admin login handler', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Admin change password endpoint
app.post('/admin/password', isAdmin, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing oldPassword or newPassword' });
    }

    const oldEnc = encryptPassword(oldPassword);
    const loginCheck = await convex.mutation('requests:adminLogin', { password: oldEnc });
    if (!loginCheck?.success) {
      return res.status(401).json({ error: 'Old password is incorrect' });
    }

    const newEnc = encryptPassword(newPassword);
    const result = await convex.mutation('requests:setAdminPassword', {
      oldPassword: oldEnc,
      newPassword: newEnc,
    });

    if (!result?.success) {
      return res.status(500).json({ error: 'Could not update password' });
    }

    res.json({ success: true });
  } catch (error) {
    logError('Admin change password', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// Super-admin: force password reset by providing encryption key in body
app.post('/admin/password/force', async (req, res) => {
  try {
    const { encryptionKey, newPassword } = req.body || {};
    if (!encryptionKey || !newPassword) {
      return res.status(400).json({ error: 'Missing encryptionKey or newPassword' });
    }

    // Validate provided key matches env
    if (!process.env.ENCRYPTION_KEY || encryptionKey !== process.env.ENCRYPTION_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const newEnc = encryptPassword(newPassword);
    const result = await convex.mutation('requests:forceSetAdminPassword', { newPassword: newEnc });
    if (!result?.success) {
      return res.status(500).json({ error: 'Could not force update password' });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    logError('Force password reset', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Helper to map request docs with contact details
const mapRequestsWithContacts = async (requests) => {
  return Promise.all(
    requests.map(async (reqDoc) => {
      let contact = null;
      try {
        contact = await convex.query('contacts:getContact', { contactId: reqDoc.contactId });
      } catch (_) {
        // ignore
      }
      return {
        id: reqDoc._id,
        source: reqDoc.source,
        status: reqDoc.status,
        createdAt: new Date(reqDoc.requestedAt).toISOString(),
        name: contact?.name,
        email: contact?.email,
        phone: contact?.phone,
        // include onboarding-specific optional fields transparently
        objective: reqDoc.objective,
        experience: reqDoc.experience,
        experienceLevel: reqDoc.experienceLevel,
        speakingExperience: reqDoc.speakingExperience,
        listeningExperience: reqDoc.listeningExperience,
        readingExperience: reqDoc.readingExperience,
        writingExperience: reqDoc.writingExperience,
        comment: reqDoc.comment,
        // new common metadata
        isRead: !!reqDoc.isRead,
        isFavorite: !!reqDoc.isFavorite,
        note: reqDoc.note || "",
      };
    })
  );
};

// Factory to create handlers for a given source type
const createRequestsBySourceHandler = (source) => async (req, res) => {
  try {
    const requests = await convex.query('requests:getRequestsBySource', { source });
    const enriched = await mapRequestsWithContacts(requests);
    res.json({ requests: enriched });
  } catch (error) {
    logError(`Fetching ${source} requests`, error);
    res.status(500).json({ error: `Error fetching ${source} requests`, details: error.message });
  }
};

// Admin-only endpoints for listing requests by source
app.get('/admin/interviews', isAdmin, createRequestsBySourceHandler('interview'));
app.get('/admin/onboarding', isAdmin, createRequestsBySourceHandler('onboarding'));

// Public aliases for interviews listings (no auth required)
app.get('/interviews', createRequestsBySourceHandler('interview'));
app.get('/interview/requests', createRequestsBySourceHandler('interview'));
app.get('/interview/all', createRequestsBySourceHandler('interview'));

// Public aliases for onboarding listings (no auth required)
app.get('/onboarding/requests', createRequestsBySourceHandler('onboarding'));
app.get('/onboardings', createRequestsBySourceHandler('onboarding'));
app.get('/onboarding/all', createRequestsBySourceHandler('onboarding'));

// Get all contacts endpoint
app.get('/contacts', async (req, res) => {
  try {
    const contacts = await convex.query("contacts:getAllContacts");
    res.json({ contacts });
  } catch (error) {
    logError('Fetching contacts', error);
    res.status(500).json({ error: 'Error fetching contacts', details: error.message });
  }
});

// Get all requests endpoint
app.get('/requests', async (req, res) => {
  try {
    const {
      page,
      pageSize,
      startDate,
      endDate,
      favoritesOnly,
      unreadOnly,
    } = req.query || {};

    if (
      page !== undefined ||
      pageSize !== undefined ||
      startDate !== undefined ||
      endDate !== undefined ||
      favoritesOnly !== undefined ||
      unreadOnly !== undefined
    ) {
      const result = await convex.query('requests:getRequestsFilteredPaged', {
        page: Number(page || 1),
        pageSize: Number(pageSize || 20),
        startDate: startDate ? Number(startDate) : undefined,
        endDate: endDate ? Number(endDate) : undefined,
        favoritesOnly: favoritesOnly === 'true' ? true : favoritesOnly === 'false' ? false : undefined,
        unreadOnly: unreadOnly === 'true' ? true : unreadOnly === 'false' ? false : undefined,
      });
      const enriched = await mapRequestsWithContacts(result.items || []);
      return res.json({
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        requests: enriched,
      });
    }

    const requests = await convex.query("requests:getAllRequests");
    const enriched = await mapRequestsWithContacts(requests);
    res.json({ requests: enriched });
  } catch (error) {
    logError('Fetching requests', error);
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
    const enriched = await mapRequestsWithContacts(requests);
    res.json({ requests: enriched });
  } catch (error) {
    logError('Fetching requests by status', error);
    res.status(500).json({ error: 'Error fetching requests by status', details: error.message });
  }
});

// Admin-only: mark as read
app.post('/requests/:id/read', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await convex.mutation('requests:markRequestRead', { requestId: id });
    res.json({ success: true });
  } catch (error) {
    logError('Mark request read', error);
    res.status(500).json({ success: false });
  }
});

// Admin-only: mark as unread
app.post('/requests/:id/unread', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await convex.mutation('requests:markRequestUnread', { requestId: id });
    res.json({ success: true });
  } catch (error) {
    logError('Mark request unread', error);
    res.status(500).json({ success: false });
  }
});

// Admin-only: set note
app.post('/requests/:id/note', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};
    await convex.mutation('requests:setRequestNote', { requestId: id, note: note || '' });
    res.json({ success: true });
  } catch (error) {
    logError('Set request note', error);
    res.status(500).json({ success: false });
  }
});

// Admin-only: favorite
app.post('/requests/:id/favorite', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await convex.mutation('requests:markRequestFavorite', { requestId: id });
    res.json({ success: true });
  } catch (error) {
    logError('Favorite request', error);
    res.status(500).json({ success: false });
  }
});

// Admin-only: unfavorite
app.post('/requests/:id/unfavorite', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await convex.mutation('requests:unmarkRequestFavorite', { requestId: id });
    res.json({ success: true });
  } catch (error) {
    logError('Unfavorite request', error);
    res.status(500).json({ success: false });
  }
});

// Admin-only: mark all as read
app.post('/requests/all/read', isAdmin, async (req, res) => {
  try {
    const result = await convex.mutation('requests:markAllRequestsRead', {});
    res.json(result);
  } catch (error) {
    logError('Mark all requests read', error);
    res.status(500).json({ success: false });
  }
});

// Admin-only: delete a request
app.delete('/requests/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await convex.mutation('requests:deleteRequest', { requestId: id });
    res.json(result);
  } catch (error) {
    logError('Delete request', error);
    res.status(500).json({ success: false });
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
    logError('Onboarding email', error);
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
    logError('Interview email', error);
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
    logError('Newsletter subscribe', error);
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
    logError('Newsletter unsubscribe', error);
    res.status(500).json({ success: false });
  }
});

// Multimedia list endpoint (public)
app.get('/multimedia', async (req, res) => {
  try {
    const items = await convex.query('multimedia:getAllMultimedia');
    res.json({ items });
  } catch (error) {
    logError('List multimedia', error);
    res.status(500).json({ error: 'Error fetching multimedia', details: error.message });
  }
});

// Multimedia upload (admin): accepts base64, uploads to Supabase, records in Convex
app.post('/multimedia', isAdmin, async (req, res) => {
  try {
    const { kind, mimeType, filename, base64, data: dataStr, title, alt, courseId, bucket: bucketOverride } = req.body || {};
    console.log('[UPLOAD] received', {
      kind,
      mimeType,
      hasFilename: !!filename,
      base64Chars: typeof base64 === 'string' ? base64.length : 0,
      dataChars: typeof dataStr === 'string' ? dataStr.length : 0,
      supabaseConfigured: !!supabase,
      supabaseUrlSet: !!SUPABASE_URL,
      hasServiceRole: !!SUPABASE_SERVICE_ROLE,
    });
    if (!kind || !mimeType || !filename) {
      return res.status(400).json({ error: 'Missing required fields: kind, mimeType' });
    }
    if (!supabase) {
      console.error('[UPLOAD] Supabase not configured', { SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE });
      return res.status(500).json({ error: 'Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE)' });
    }
    // Accept either `base64` or `data` as a Base64 string (optionally a data URL)
    const rawB64 = (typeof base64 === 'string' && base64.length)
      ? base64
      : (typeof dataStr === 'string' && dataStr.length)
      ? dataStr
      : null;
    if (!rawB64) {
      return res.status(400).json({ error: 'Missing base64 data: provide `base64` or `data` string' });
    }
    const commaIdx = rawB64.indexOf(',');
    const base64Body = commaIdx >= 0 ? rawB64.slice(commaIdx + 1) : rawB64;
    const buf = Buffer.from(base64Body, 'base64');
    const bucket = bucketOverride || process.env.SUPABASE_BUCKET || 'assets';
    // Use a dated path for organization
    const y = new Date().getUTCFullYear();
    const m = String(new Date().getUTCMonth() + 1).padStart(2, '0');
    const d = String(new Date().getUTCDate()).padStart(2, '0');
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const safeFilename = sanitizeFilename(filename || 'file');
    const path = `${y}/${m}/${d}/${unique}-${safeFilename}`;
    console.log('[UPLOAD] target', { bucket, path, size: buf.byteLength });

    const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadErr) {
      console.error('[UPLOAD] supabase upload error', { name: uploadErr.name, message: uploadErr.message, statusCode: uploadErr.statusCode });
      throw uploadErr;
    }

    const id = await convex.mutation('multimedia:createRecord', {
      kind,
      mimeType,
      filename,
      size: buf.byteLength,
      storageProvider: 'supabase',
      supabaseBucket: bucket,
      supabasePath: path,
      title,
      alt,
      courseId,
    });
    res.json({ success: true, id, bucket, path });
  } catch (error) {
    logError('Upload multimedia', error);
    res.status(500).json({ success: false, error: error?.message || 'Upload failed' });
  }
});

// Admin: check Supabase configuration and bucket existence
app.get('/admin/supabase/health', isAdmin, async (req, res) => {
  try {
    const bucket = req.query.bucket || process.env.SUPABASE_BUCKET || 'assets';
    const isConfigured = !!supabase;
    if (!isConfigured) return res.json({ isConfigured, bucket, exists: false });
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    const exists = Array.isArray(buckets) && buckets.some((b) => b.name === bucket);
    res.json({ isConfigured, bucket, exists });
  } catch (error) {
    logError('Supabase health', error);
    res.status(500).json({ error: error?.message || 'Health check failed' });
  }
});

// Admin: create a Supabase bucket if missing
app.post('/admin/supabase/buckets/:bucket', isAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { bucket } = req.params;
    const { public: isPublic } = req.body || {};
    const { error } = await supabase.storage.createBucket(bucket, { public: !!isPublic });
    if (error) throw error;
    res.json({ success: true, bucket, public: !!isPublic });
  } catch (error) {
    logError('Create bucket', error);
    res.status(500).json({ success: false, error: error?.message || 'Create bucket failed' });
  }
});

// Link multimedia to course (admin)
app.post('/multimedia/:id/link', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { courseId } = req.body || {};
    if (!courseId) return res.status(400).json({ error: 'Missing courseId' });
    const result = await convex.mutation('multimedia:linkToCourse', { multimediaId: id, courseId });
    res.json(result);
  } catch (error) {
    logError('Link multimedia', error);
    res.status(500).json({ success: false });
  }
});

// Unlink multimedia from course (admin)
app.post('/multimedia/:id/unlink', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await convex.mutation('multimedia:unlinkFromCourse', { multimediaId: id });
    res.json(result);
  } catch (error) {
    logError('Unlink multimedia', error);
    res.status(500).json({ success: false });
  }
});

// Delete if orphan (admin) — also deletes from Supabase if applicable
app.delete('/multimedia/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Fetch record to know where it's stored
    const doc = await convex.query('multimedia:getById', { multimediaId: id });
    if (!doc) return res.json({ success: true, deleted: false });
    if (doc.status !== 'orphan') return res.json({ success: false, reason: 'not_orphan' });

    // Delete from provider first
    if (doc.storageProvider === 'supabase' && supabase && doc.supabaseBucket && doc.supabasePath) {
      await supabase.storage.from(doc.supabaseBucket).remove([doc.supabasePath]);
    }

    const result = await convex.mutation('multimedia:deleteIfOrphan', { multimediaId: id });
    res.json(result);
  } catch (error) {
    logError('Delete multimedia', error);
    res.status(500).json({ success: false });
  }
});

// Get multimedia metadata
app.get('/multimedia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await convex.query('multimedia:getById', { multimediaId: id });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ multimedia: doc });
  } catch (error) {
    logError('Get multimedia', error);
    res.status(500).json({ error: 'Error fetching multimedia', details: error.message });
  }
});

// Get a temporary URL for the asset (Supabase signed URL if stored there)
app.get('/multimedia/:id/url', async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await convex.query('multimedia:getById', { multimediaId: id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (doc.storageProvider === 'supabase' && supabase && doc.supabaseBucket && doc.supabasePath) {
      const expiresIn = Number(process.env.SUPABASE_SIGNED_URL_TTL_SEC || 60 * 10); // default 10m
      const { data, error: urlErr } = await supabase
        .storage
        .from(doc.supabaseBucket)
        .createSignedUrl(doc.supabasePath, expiresIn);
      if (urlErr) throw urlErr;
      return res.json({ url: data?.signedUrl || null, mimeType: doc.mimeType });
    }

    // Fallback to Convex storage (legacy)
    const result = await convex.query('multimedia:getUrl', { multimediaId: id });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (error) {
    logError('Get multimedia url', error);
    res.status(500).json({ error: 'Error generating URL', details: error.message });
  }
});

// Courses: list with optional filters
app.get('/courses', async (req, res) => {
  try {
    const { minLevel, startDateFrom, startDateTo, text } = req.query || {};
    const result = await convex.query('courses:findCourses', {
      minLevel: typeof minLevel === 'string' && minLevel.length ? minLevel : undefined,
      startDateFrom: startDateFrom ? Number(startDateFrom) : undefined,
      startDateTo: startDateTo ? Number(startDateTo) : undefined,
      textSearch: typeof text === 'string' && text.length ? text : undefined,
    });
    const courses = await Promise.all(
      (Array.isArray(result) ? result : []).map(async (c) => ({
        ...c,
        imageUrl: await getCourseImageUrl(c?.image, c?._id),
      }))
    );
    res.json({ courses });
  } catch (error) {
    logError('List courses', error);
    res.status(500).json({ error: 'Error fetching courses', details: error.message });
  }
});

// Courses: get one
app.get('/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const course = await convex.query('courses:getCourse', { courseId: id });
    if (!course) return res.status(404).json({ error: 'Not found' });
    const imageUrl = await getCourseImageUrl(course?.image, course?._id);
    res.json({ course: { ...course, imageUrl } });
  } catch (error) {
    logError('Get course', error);
    res.status(500).json({ error: 'Error fetching course', details: error.message });
  }
});

// Courses: create (admin)
app.post('/courses', isAdmin, async (req, res) => {
  try {
    const {
      title,
      image,
      description,
      startDate,
      textColor,
      minLevel,
      specialNotes,
      attachments,
      links,
    } = req.body || {};

    // Only require title
    if (!title || (typeof title !== 'string') || !title.trim()) {
      return res.status(400).json({ error: 'Missing required field: title' });
    }

    const courseId = await convex.mutation('courses:addCourse', {
      title,
      image,
      description,
      startDate: startDate === null ? null : (startDate !== undefined ? Number(startDate) : undefined),
      textColor,
      minLevel,
      // Normalize nullable optionals to undefined/arrays per Convex validators
      specialNotes: typeof specialNotes === 'string' ? specialNotes : undefined,
      attachments: Array.isArray(attachments) ? attachments : undefined,
      links: Array.isArray(links) ? links : undefined,
    });
    // Return created course with imageUrl for convenience
    const imageUrl = await getCourseImageUrl(image, courseId);
    res.json({ success: true, id: courseId, imageUrl });
  } catch (error) {
    logError('Create course', error);
    res.status(500).json({ success: false });
  }
});

// Courses: update (admin)
app.put('/courses/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      image,
      description,
      startDate,
      textColor,
      minLevel,
      specialNotes,
      attachments,
      links,
    } = req.body || {};

    const payload = {
      courseId: id,
      title,
      image,
      description,
      // allow clearing with null
      startDate: startDate === null ? null : startDate !== undefined ? Number(startDate) : undefined,
      textColor,
      minLevel,
      specialNotes: specialNotes === null ? null : specialNotes,
      attachments: attachments === null ? null : attachments,
      links: links === null ? null : links,
    };

    const result = await convex.mutation('courses:updateCourse', payload);
    // If successful, include resolved image URL based on the latest course doc
    let imageUrl = null;
    try {
      const updated = await convex.query('courses:getCourse', { courseId: id });
      imageUrl = await getCourseImageUrl(updated?.image, updated?._id);
    } catch (_) {}
    res.json({ ...result, imageUrl });
  } catch (error) {
    logError('Update course', error);
    res.status(500).json({ success: false });
  }
});

// Courses: partial update (admin)
app.patch('/courses/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const payload = { courseId: id };

    if (Object.prototype.hasOwnProperty.call(body, 'title')) payload.title = body.title;
    if (Object.prototype.hasOwnProperty.call(body, 'image')) payload.image = body.image;
    if (Object.prototype.hasOwnProperty.call(body, 'description')) payload.description = body.description;
    if (Object.prototype.hasOwnProperty.call(body, 'startDate')) payload.startDate = body.startDate === null ? null : Number(body.startDate);
    if (Object.prototype.hasOwnProperty.call(body, 'textColor')) payload.textColor = body.textColor;
    if (Object.prototype.hasOwnProperty.call(body, 'minLevel')) payload.minLevel = body.minLevel;
    if (Object.prototype.hasOwnProperty.call(body, 'specialNotes')) payload.specialNotes = body.specialNotes === null ? null : body.specialNotes;
    if (Object.prototype.hasOwnProperty.call(body, 'attachments')) payload.attachments = body.attachments === null ? null : body.attachments;
    if (Object.prototype.hasOwnProperty.call(body, 'links')) payload.links = body.links === null ? null : body.links;

    const result = await convex.mutation('courses:updateCourse', payload);

    // Return updated course imageUrl for convenience
    let imageUrl = null;
    try {
      const updated = await convex.query('courses:getCourse', { courseId: id });
      imageUrl = await getCourseImageUrl(updated?.image, updated?._id);
    } catch (_) {}

    res.json({ ...result, imageUrl });
  } catch (error) {
    logError('Patch course', error);
    res.status(500).json({ success: false });
  }
});

// Courses: delete (admin)
app.delete('/courses/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await convex.mutation('courses:deleteCourse', { courseId: id });
    res.json(result);
  } catch (error) {
    logError('Delete course', error);
    res.status(500).json({ success: false });
  }
});

// Courses: thumbnails — GET current config (public)
app.get('/courses/:id/thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const cfg = await convex.query('courses:getCourseThumbnail', { courseId: id });
    return res.json({ thumbnail: cfg || null });
  } catch (error) {
    logError('Get course thumbnail', error);
    res.status(500).json({ error: 'Error fetching course thumbnail', details: error.message });
  }
});

// Alias for thumbnail GET
app.get('/courses/:id/thumbnail-config', async (req, res) => {
  try {
    const { id } = req.params;
    const cfg = await convex.query('courses:getCourseThumbnail', { courseId: id });
    return res.json({ thumbnail: cfg || null });
  } catch (error) {
    logError('Get course thumbnail-config', error);
    res.status(500).json({ error: 'Error fetching course thumbnail', details: error.message });
  }
});

// Alternate path using course id — responds with { data }
app.get('/course-thumbnails/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cfg = await convex.query('courses:getCourseThumbnail', { courseId: id });
    return res.json({ data: cfg || null });
  } catch (error) {
    logError('Get course-thumbnails by course id', error);
    res.status(500).json({ error: 'Error fetching course thumbnail', details: error.message });
  }
});

// Courses: thumbnails — UPSERT config (admin)
const normalizeThumbnailPayload = (raw) => {
  const body = raw || {};
  const source = body.thumbnail && typeof body.thumbnail === 'object' ? body.thumbnail : body;
  const normalized = {
    customTexts: Array.isArray(source.customTexts) ? source.customTexts : [],
    imagePosition: source.imagePosition,
    imageScale: source.imageScale,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : undefined,
  };
  return normalized;
};

app.put('/courses/:id/thumbnail', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { customTexts, imagePosition, imageScale, updatedAt } = normalizeThumbnailPayload(req.body);
    if (!Array.isArray(customTexts)) {
      return res.status(400).json({ error: 'customTexts must be an array' });
    }
    const result = await convex.mutation('courses:upsertCourseThumbnail', {
      courseId: id,
      customTexts,
      imagePosition,
      imageScale,
      updatedAt,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logError('Upsert course thumbnail', error);
    res.status(500).json({ success: false, error: 'Error saving course thumbnail', details: error.message });
  }
});

// Alias for UPSERT via PUT
app.put('/courses/:id/thumbnail-config', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { customTexts, imagePosition, imageScale, updatedAt } = normalizeThumbnailPayload(req.body);
    if (!Array.isArray(customTexts)) {
      return res.status(400).json({ error: 'customTexts must be an array' });
    }
    const result = await convex.mutation('courses:upsertCourseThumbnail', {
      courseId: id,
      customTexts,
      imagePosition,
      imageScale,
      updatedAt,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logError('Upsert course thumbnail-config', error);
    res.status(500).json({ success: false, error: 'Error saving course thumbnail', details: error.message });
  }
});

// Alternate path: POST to /course-thumbnails/:id (admin)
app.post('/course-thumbnails/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { customTexts, imagePosition, imageScale, updatedAt } = normalizeThumbnailPayload(req.body);
    if (!Array.isArray(customTexts)) {
      return res.status(400).json({ error: 'customTexts must be an array' });
    }
    const result = await convex.mutation('courses:upsertCourseThumbnail', {
      courseId: id,
      customTexts,
      imagePosition,
      imageScale,
      updatedAt,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logError('Post course thumbnail-config', error);
    res.status(500).json({ success: false, error: 'Error saving course thumbnail', details: error.message });
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
    logError('Get newsletter subscription', error);
    res.status(500).json({ error: 'Error getting subscription status', details: error.message });
  }
});

// Get all active newsletter subscriptions endpoint
app.get('/newsletter/subscribers', async (req, res) => {
  try {
    const subscribers = await convex.query("newsletter:getAllActiveSubscriptions");
    res.json({ subscribers });
  } catch (error) {
    logError('Fetch newsletter subscribers', error);
    res.status(500).json({ error: 'Error fetching newsletter subscribers', details: error.message });
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
  console.log(`Newsletter subscribe: POST http://localhost:${PORT}/newsletter/subscribe`);
  console.log(`Newsletter unsubscribe: POST http://localhost:${PORT}/newsletter/unsubscribe`);
  console.log(`Newsletter status: GET http://localhost:${PORT}/newsletter/subscription/{email}`);
  console.log(`Newsletter subscribers: GET http://localhost:${PORT}/newsletter/subscribers`);
  console.log(`Contacts endpoint: GET http://localhost:${PORT}/contacts`);
  console.log(`Requests endpoint: GET http://localhost:${PORT}/requests`);
  console.log(`Requests by status: GET http://localhost:${PORT}/requests/status/{pending|processed}`);
  console.log(`Mark request read: POST http://localhost:${PORT}/requests/{id}/read`);
  console.log(`Mark request unread: POST http://localhost:${PORT}/requests/{id}/unread`);
  console.log(`Set request note: POST http://localhost:${PORT}/requests/{id}/note`);
  console.log(`Favorite request: POST http://localhost:${PORT}/requests/{id}/favorite`);
  console.log(`Unfavorite request: POST http://localhost:${PORT}/requests/{id}/unfavorite`);
  console.log(`Mark all requests read: POST http://localhost:${PORT}/requests/all/read`);
  console.log(`Delete request: DELETE http://localhost:${PORT}/requests/{id}`);
  console.log(`Interview requests (admin): GET http://localhost:${PORT}/admin/interviews`);
  console.log(`Onboarding requests (admin): GET http://localhost:${PORT}/admin/onboarding`);
  console.log(`Interview requests (public): GET http://localhost:${PORT}/interviews | /interview/requests | /interview/all`);
  console.log(`Onboarding requests (public): GET http://localhost:${PORT}/onboarding/requests | /onboardings | /onboarding/all`);
  console.log(`Admin login: POST http://localhost:${PORT}/admin/login`);
  console.log(`Courses list: GET http://localhost:${PORT}/courses`);
  console.log(`Courses get: GET http://localhost:${PORT}/courses/{id}`);
  console.log(`Courses create (admin): POST http://localhost:${PORT}/courses`);
  console.log(`Courses update (admin): PUT http://localhost:${PORT}/courses/{id}`);
  console.log(`Courses delete (admin): DELETE http://localhost:${PORT}/courses/{id}`);
  console.log(`Course thumbnail get: GET http://localhost:${PORT}/courses/{id}/thumbnail`);
  console.log(`Course thumbnail get (alias): GET http://localhost:${PORT}/courses/{id}/thumbnail-config`);
  console.log(`Course thumbnail get (alt path): GET http://localhost:${PORT}/course-thumbnails/{id}`);
  console.log(`Course thumbnail save (admin): PUT http://localhost:${PORT}/courses/{id}/thumbnail`);
  console.log(`Course thumbnail save (admin alias): PUT http://localhost:${PORT}/courses/{id}/thumbnail-config`);
  console.log(`Course thumbnail save (admin alt): POST http://localhost:${PORT}/course-thumbnails/{id}`);
  console.log(`Multimedia list: GET http://localhost:${PORT}/multimedia`);
  console.log(`Multimedia upload (admin): POST http://localhost:${PORT}/multimedia`);
  console.log(`Multimedia link (admin): POST http://localhost:${PORT}/multimedia/{id}/link`);
  console.log(`Multimedia unlink (admin): POST http://localhost:${PORT}/multimedia/{id}/unlink`);
  console.log(`Multimedia delete-if-orphan (admin): DELETE http://localhost:${PORT}/multimedia/{id}`);
  console.log(`Multimedia get: GET http://localhost:${PORT}/multimedia/{id}`);
  console.log(`Multimedia get URL: GET http://localhost:${PORT}/multimedia/{id}/url`);
});
