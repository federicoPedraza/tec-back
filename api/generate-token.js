import jwt from 'jsonwebtoken';
import { setCorsHeaders, logError } from './utils.js';

export default function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

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
}

