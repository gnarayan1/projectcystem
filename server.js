require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const RECAPTCHA_EXPECTED_ACTION = 'CONTACT_FORM_SUBMIT';
const RECAPTCHA_MIN_SCORE = 0.5;
const DEBUG_CONTACT = process.env.DEBUG_CONTACT === 'true';
const SEND_CONFIRMATION_EMAIL = process.env.SEND_CONFIRMATION_EMAIL === 'true';
// Trust exactly one reverse proxy hop by default (safe for common NGINX/Apache setups).
const trustProxySetting = process.env.TRUST_PROXY || 1;
app.set('trust proxy', trustProxySetting);
const PORT = process.env.PORT || 3000;

function debugContact(message, details = {}) {
  if (!DEBUG_CONTACT) return;
  console.log(`[DEBUG][CONTACT] ${message}`, JSON.stringify(details));
}

// Security & rate limiting
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://www.google.com',
          'https://www.gstatic.com',
          'https://www.googletagmanager.com',
        ],
        connectSrc: [
          "'self'",
          'https://www.google.com',
          'https://www.gstatic.com',
          'https://www.google-analytics.com',
          'https://region1.google-analytics.com',
          'https://www.googletagmanager.com',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'https://www.google.com',
          'https://www.gstatic.com',
          'https://www.google-analytics.com',
          'https://www.googletagmanager.com',
        ],
        frameSrc: ["'self'", 'https://www.google.com', 'https://recaptcha.google.com'],
      },
    },
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting for contact endpoint (max 5 requests per hour per IP)
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many contact submissions from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve static files (HTML, CSS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Contact form handler
app.post('/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, 'g-recaptcha-response': captchaToken } = req.body;

    // Determine client IP reliably when behind a proxy (Apache/Bitnami)
    const clientIp = req.ip || (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.connection.remoteAddress || '');
    debugContact('request_received', {
      ip: clientIp,
      hasName: Boolean(name),
      hasEmail: Boolean(email),
      messageLength: typeof message === 'string' ? message.trim().length : 0,
      hasCaptchaToken: Boolean(captchaToken),
      trustProxySetting,
    });

    // Validate honeypot (must be empty)
    const honeypot = req.body.hp_contact || '';
    if (honeypot) {
      console.warn('[SPAM DETECTED] Honeypot field filled from IP:', clientIp);
      return res.status(400).json({ error: 'Submission failed. Please try again.' });
    }

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Please fill in all fields.' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Validate message length
    if (message.trim().length < 10 || message.trim().length > 5000) {
      return res.status(400).json({ error: 'Message must be between 10 and 5000 characters.' });
    }

    // Verify reCAPTCHA
    if (!captchaToken) {
      return res.status(400).json({ error: 'reCAPTCHA verification failed. Please try again.' });
    }

    const recaptchaProjectId = process.env.RECAPTCHA_PROJECT_ID;
    const recaptchaApiKey = process.env.RECAPTCHA_API_KEY;
    const recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY;
    debugContact('recaptcha_config_check', {
      hasProjectId: Boolean(recaptchaProjectId),
      hasApiKey: Boolean(recaptchaApiKey),
      hasSiteKey: Boolean(recaptchaSiteKey),
      projectId: recaptchaProjectId || null,
      siteKeySuffix: recaptchaSiteKey ? recaptchaSiteKey.slice(-6) : null,
    });
    if (!recaptchaProjectId || !recaptchaApiKey || !recaptchaSiteKey) {
      console.error('RECAPTCHA_PROJECT_ID, RECAPTCHA_API_KEY, and RECAPTCHA_SITE_KEY must be set.');
      return res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    }

    const captchaVerifyUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(
      recaptchaProjectId
    )}/assessments`;
    const captchaResponse = await axios.post(
      captchaVerifyUrl,
      {
        event: {
          token: captchaToken,
          siteKey: recaptchaSiteKey,
          expectedAction: RECAPTCHA_EXPECTED_ACTION,
          userIpAddress: clientIp,
        },
      },
      {
        params: {
          key: recaptchaApiKey,
        },
      }
    );
    debugContact('recaptcha_assessment_response', {
      hasTokenProperties: Boolean(captchaResponse.data.tokenProperties),
      hasRiskAnalysis: Boolean(captchaResponse.data.riskAnalysis),
    });

    const tokenProperties = captchaResponse.data.tokenProperties || {};
    const riskAnalysis = captchaResponse.data.riskAnalysis || {};
    const captchaAction = tokenProperties.action;
    const captchaValid = tokenProperties.valid === true;
    const hasActionMismatch = typeof captchaAction === 'string' && captchaAction !== RECAPTCHA_EXPECTED_ACTION;
    const score = typeof riskAnalysis.score === 'number' ? riskAnalysis.score : null;
    const hasLowScore = typeof score === 'number' && score < RECAPTCHA_MIN_SCORE;

    if (!captchaValid || hasActionMismatch || hasLowScore) {
      console.warn(
        '[CAPTCHA FAILED] Action:',
        captchaAction,
        'Score:',
        score,
        'Valid:',
        captchaValid,
        'InvalidReason:',
        tokenProperties.invalidReason,
        'from IP:',
        clientIp
      );
      return res.status(400).json({ error: 'reCAPTCHA verification failed. Please try again.' });
    }
    debugContact('recaptcha_passed', {
      action: captchaAction || null,
      score,
      valid: captchaValid,
    });

    // Configure nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    debugContact('smtp_config_check', {
      host: process.env.SMTP_HOST || null,
      port: process.env.SMTP_PORT || null,
      secure: process.env.SMTP_SECURE || null,
      hasSmtpUser: Boolean(process.env.SMTP_USER),
      hasSmtpPass: Boolean(process.env.SMTP_PASS),
    });

    const rawMailFrom = process.env.MAIL_FROM || process.env.SMTP_USER || '';
    const mailFrom = rawMailFrom.trim().replace(/^<(.+)>$/, '$1');
    debugContact('mail_from_normalized', {
      rawMailFrom,
      normalizedMailFrom: mailFrom,
      mailTo: process.env.MAIL_TO || 'projectcystem@gmail.com',
    });
    if (!mailFrom || !emailRegex.test(mailFrom)) {
      console.error('MAIL_FROM must be a valid verified sender email address.');
      return res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    }

    // Email content
    const mailOptions = {
      from: `"Project CYSTEM Contact" <${mailFrom}>`,
      to: process.env.MAIL_TO || 'projectcystem@gmail.com',
      envelope: {
        from: mailFrom,
        to: process.env.MAIL_TO || 'projectcystem@gmail.com',
      },
      replyTo: email,
      subject: `New Contact Form Message from ${name}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
        <hr>
        <p><small>Submitted from: ${escapeHtml(clientIp)} at ${new Date().toISOString()}</small></p>
      `,
    };

    // Optionally send a confirmation email to the user
    const confirmationMailOptions = {
      from: `"Project CYSTEM" <${mailFrom}>`,
      to: email,
      envelope: {
        from: mailFrom,
        to: email,
      },
      subject: 'We received your message',
      html: `
        <h2>Thank you for reaching out!</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>We have received your message and will get back to you as soon as possible.</p>
        <p><strong>Your message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
        <hr>
        <p>Best regards,<br>Project CYSTEM Team</p>
      `,
    };

    // Always send admin notification. User confirmation is optional and non-fatal.
    await transporter.sendMail(mailOptions);
    if (SEND_CONFIRMATION_EMAIL) {
      try {
        await transporter.sendMail(confirmationMailOptions);
      } catch (confirmationError) {
        console.warn(
          '[WARN] Confirmation email failed:',
          confirmationError.message,
          'recipient:',
          email
        );
      }
    }
    debugContact('emails_sent', {
      envelopeFrom: mailFrom,
      adminTo: process.env.MAIL_TO || 'projectcystem@gmail.com',
      confirmationTo: SEND_CONFIRMATION_EMAIL ? email : null,
    });

    console.log(`[SUCCESS] Contact form submitted by ${email} (${name}) from IP: ${clientIp}`);
    return res.status(200).json({ success: true, message: 'Your message has been sent successfully!' });
  } catch (error) {
    const errorDetails = {
      message: error.message,
      code: error.code || null,
      status: error.response?.status || null,
      data: error.response?.data || null,
      mailFrom: process.env.MAIL_FROM || null,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    };
    console.error('[ERROR] Contact form error:', JSON.stringify(errorDetails));
    return res.status(500).json({ error: 'An error occurred. Please try again later.' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Start server
app.listen(PORT, () => {
  console.log(`✓ Project CYSTEM server running on http://localhost:${PORT}`);
  console.log(`✓ Contact form handler at POST /contact`);
});
