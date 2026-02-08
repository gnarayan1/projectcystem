require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
// when running behind a proxy (Apache/NGINX/Bitnami), trust X-Forwarded-* headers
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// Security & rate limiting
app.use(helmet());
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

    const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
    if (!recaptchaSecret) {
      console.error('RECAPTCHA_SECRET_KEY is not set in environment variables.');
      return res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    }

    const captchaVerifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
    const captchaResponse = await axios.post(captchaVerifyUrl, null, {
      params: {
        secret: recaptchaSecret,
        response: captchaToken,
      },
    });

    if (!captchaResponse.data.success || (typeof captchaResponse.data.score === 'number' && captchaResponse.data.score < 0.5)) {
      console.warn('[CAPTCHA FAILED] Score:', captchaResponse.data.score, 'from IP:', clientIp);
      return res.status(400).json({ error: 'reCAPTCHA verification failed. Please try again.' });
    }

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

    // Email content
    const mailOptions = {
      from: `"${name} (via Project CYSTEM)" <${process.env.SMTP_USER}>`,
      to: process.env.MAIL_TO || 'projectcystem@gmail.com',
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
      from: `"Project CYSTEM" <${process.env.SMTP_USER}>`,
      to: email,
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

    // Send both emails
    await Promise.all([
      transporter.sendMail(mailOptions),
      transporter.sendMail(confirmationMailOptions),
    ]);

    console.log(`[SUCCESS] Contact form submitted by ${email} (${name}) from IP: ${clientIp}`);
    return res.status(200).json({ success: true, message: 'Your message has been sent successfully!' });
  } catch (error) {
    console.error('[ERROR] Contact form error:', error.message);
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
