import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODEMAILER_USER,
    pass: process.env.NODEMAILER_PASSWORD
  }
});

// Unified error logger
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
    const templatePath = path.join(process.cwd(), 'templates', 'html', filename);
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

// CORS headers helper
const setCorsHeaders = (req, res) => {
  const allowedOrigins = [
    'https://www.theenglishcrab.com',
    'https://theenglishcrab.com',
    'https://the-english-crab-app.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
  ];
  
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://www.theenglishcrab.com");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
};

export {
  transporter,
  logError,
  loadTemplate,
  setCorsHeaders
};

