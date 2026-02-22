require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const RECAPTCHA_EXPECTED_ACTION = 'CONTACT_FORM_SUBMIT';
const RECAPTCHA_MIN_SCORE = 0.5;
const DEBUG_CONTACT = process.env.DEBUG_CONTACT === 'true';
const SEND_CONFIRMATION_EMAIL = process.env.SEND_CONFIRMATION_EMAIL === 'true';
const CHATBOT_ENABLED = process.env.CHATBOT_ENABLED === 'true';
const CHATBOT_MODEL = process.env.CHATBOT_MODEL || 'gpt-4o-mini';
const CHATBOT_EMBEDDING_MODEL = process.env.CHATBOT_EMBEDDING_MODEL || 'text-embedding-3-small';
const CHATBOT_MAX_OUTPUT_TOKENS = parseInt(process.env.CHATBOT_MAX_OUTPUT_TOKENS || '350', 10);
const CHATBOT_CONTEXT_CHUNKS = Math.max(1, parseInt(process.env.CHATBOT_CONTEXT_CHUNKS || '2', 10));
const CHATBOT_CACHE_TTL_HOURS = Math.max(1, parseInt(process.env.CHATBOT_CACHE_TTL_HOURS || '168', 10));
// Trust exactly one reverse proxy hop by default (safe for common NGINX/Apache setups).
const trustProxySetting = process.env.TRUST_PROXY || 1;
app.set('trust proxy', trustProxySetting);
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const RAG_DIR = path.join(__dirname, 'rag');
const CHAT_CACHE_FILE = path.join(__dirname, 'cache', 'chat-cache.json');

let ragDocuments = [];
let ragFaqs = [];
let ragEmbeddingsById = null;
let chatCache = {};

function debugContact(message, details = {}) {
  if (!DEBUG_CONTACT) return;
  console.log(`[DEBUG][CONTACT] ${message}`, JSON.stringify(details));
}

const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many chat requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const blockedMedicalPatterns = [
  /\b(dose|dosage|mg|prescribe|prescription|medication plan|treat me|diagnose me)\b/i,
  /\bhow much\b.*\b(mg|dose)\b/i,
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter((t) => t.length > 2);
}

function loadJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    console.warn(`[WARN] Failed to load ${filePath}:`, error.message);
    return fallback;
  }
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadChatData() {
  ragDocuments = loadJsonFile(path.join(RAG_DIR, 'documents.json'), []);
  ragFaqs = loadJsonFile(path.join(RAG_DIR, 'faqs.json'), []);
  const embeddingsPayload = loadJsonFile(path.join(RAG_DIR, 'embeddings.json'), null);
  if (embeddingsPayload && Array.isArray(embeddingsPayload.items)) {
    ragEmbeddingsById = new Map();
    for (const item of embeddingsPayload.items) {
      if (item && typeof item.id === 'string' && Array.isArray(item.embedding)) {
        ragEmbeddingsById.set(item.id, item.embedding);
      }
    }
  } else {
    ragEmbeddingsById = null;
  }
  chatCache = loadJsonFile(CHAT_CACHE_FILE, {});
  console.log(
    `[CHATBOT] Loaded docs=${ragDocuments.length}, faqs=${ragFaqs.length}, embeddings=${ragEmbeddingsById ? ragEmbeddingsById.size : 0}`
  );
}

function saveChatCache() {
  try {
    ensureDirForFile(CHAT_CACHE_FILE);
    fs.writeFileSync(CHAT_CACHE_FILE, JSON.stringify(chatCache, null, 2), 'utf8');
  } catch (error) {
    console.warn('[WARN] Failed to persist chat cache:', error.message);
  }
}

function getCachedAnswer(cacheKey) {
  const item = chatCache[cacheKey];
  if (!item) return null;
  const ttlMs = CHATBOT_CACHE_TTL_HOURS * 60 * 60 * 1000;
  if (Date.now() - item.timestamp > ttlMs) {
    delete chatCache[cacheKey];
    saveChatCache();
    return null;
  }
  return item;
}

function setCachedAnswer(cacheKey, value) {
  chatCache[cacheKey] = {
    ...value,
    timestamp: Date.now(),
  };
  saveChatCache();
}

function isBlockedMedicalQuestion(question) {
  return blockedMedicalPatterns.some((pattern) => pattern.test(question));
}

function findFaqAnswer(question) {
  const qTokens = new Set(tokenize(question));
  if (!qTokens.size) return null;
  let best = null;
  let bestScore = 0;
  for (const faq of ragFaqs) {
    const prompts = Array.isArray(faq.prompts) ? faq.prompts : [];
    for (const prompt of prompts) {
      const pTokens = new Set(tokenize(prompt));
      if (!pTokens.size) continue;
      let overlap = 0;
      for (const token of qTokens) {
        if (pTokens.has(token)) overlap += 1;
      }
      const score = overlap / Math.max(qTokens.size, pTokens.size);
      if (score > bestScore) {
        bestScore = score;
        best = faq;
      }
    }
  }
  if (best && bestScore >= 0.7) return best;
  return null;
}

function retrieveByKeyword(question, limit) {
  const qTokens = new Set(tokenize(question));
  if (!qTokens.size) return [];
  const scored = ragDocuments
    .map((doc) => {
      const sourceText = `${doc.title || ''} ${doc.content || ''}`;
      const dTokens = new Set(tokenize(sourceText));
      let overlap = 0;
      for (const token of qTokens) {
        if (dTokens.has(token)) overlap += 1;
      }
      const score = overlap / Math.max(1, qTokens.size);
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbedding(input) {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: CHATBOT_EMBEDDING_MODEL,
      input,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 12000,
    }
  );
  const embedding = response.data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding response missing vector.');
  }
  return embedding;
}

async function retrieveContext(question, limit) {
  if (!ragDocuments.length) return [];
  if (OPENAI_API_KEY && ragEmbeddingsById && ragEmbeddingsById.size) {
    try {
      const queryEmbedding = await getEmbedding(question);
      const scored = [];
      for (const doc of ragDocuments) {
        const vector = ragEmbeddingsById.get(doc.id);
        if (!vector) continue;
        const score = cosineSimilarity(queryEmbedding, vector);
        if (score > 0) scored.push({ doc, score });
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored.length) return scored.slice(0, limit);
    } catch (error) {
      console.warn('[WARN] Embedding retrieval failed, falling back to keyword search:', error.message);
    }
  }
  return retrieveByKeyword(question, limit);
}

function buildContextText(items) {
  return items
    .map((item, index) => {
      const doc = item.doc;
      return `Source ${index + 1}: ${doc.title}\nURL: ${doc.url}\nExcerpt: ${doc.content}`;
    })
    .join('\n\n');
}

function buildSourceList(items) {
  const unique = new Map();
  for (const item of items) {
    const doc = item.doc;
    if (!unique.has(doc.url)) {
      unique.set(doc.url, { title: doc.title, url: doc.url });
    }
  }
  return Array.from(unique.values());
}

async function generateChatAnswer(question, contextItems) {
  const contextText = buildContextText(contextItems);
  const systemPrompt =
    'You are an educational assistant for Project CYSTEM about PCOS awareness. ' +
    'Do not provide medical diagnosis, prescriptions, or dosage advice. ' +
    'If asked for personalized treatment, refuse briefly and recommend consulting a licensed clinician. ' +
    'Use only the supplied sources. If sources are insufficient, say you do not have enough trusted information. ' +
    'Keep responses under 180 words and include source tags like [Source 1].';

  const userPrompt = `Question: ${question}\n\nTrusted sources:\n${contextText || 'No relevant sources found.'}`;
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: CHATBOT_MODEL,
      temperature: 0.2,
      max_tokens: CHATBOT_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return response.data?.choices?.[0]?.message?.content?.trim() || 'I could not generate an answer right now.';
}

loadChatData();

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

app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    if (!CHATBOT_ENABLED) {
      return res.status(503).json({ error: 'Chatbot is currently disabled.' });
    }

    const question = String(req.body?.question || '').trim();
    if (question.length < 4 || question.length > 800) {
      return res.status(400).json({ error: 'Please send a question between 4 and 800 characters.' });
    }

    if (isBlockedMedicalQuestion(question)) {
      return res.status(200).json({
        answer:
          'I can share general educational information, but I cannot provide diagnosis, prescriptions, or dosage advice. Please consult a licensed clinician for personal medical guidance.',
        sources: [],
        cached: false,
      });
    }

    const faqHit = findFaqAnswer(question);
    if (faqHit) {
      return res.status(200).json({
        answer: `${faqHit.answer}\n\nThis is educational information, not medical advice.`,
        sources: Array.isArray(faqHit.sources) ? faqHit.sources : [],
        cached: false,
      });
    }

    const cacheKey = normalizeText(question);
    const cached = getCachedAnswer(cacheKey);
    if (cached) {
      return res.status(200).json({
        answer: cached.answer,
        sources: cached.sources || [],
        cached: true,
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: 'Chatbot is not configured yet (missing OPENAI_API_KEY).' });
    }

    const contextItems = await retrieveContext(question, CHATBOT_CONTEXT_CHUNKS);
    if (!contextItems.length) {
      const noDataAnswer =
        'I do not have enough trusted information in the current knowledge base to answer that. Please contact a licensed clinician or use our trusted resource links.';
      setCachedAnswer(cacheKey, { answer: noDataAnswer, sources: [] });
      return res.status(200).json({ answer: noDataAnswer, sources: [], cached: false });
    }

    const answer = await generateChatAnswer(question, contextItems);
    const sources = buildSourceList(contextItems);
    const finalAnswer = `${answer}\n\nThis is educational information and not medical advice.`;

    setCachedAnswer(cacheKey, { answer: finalAnswer, sources });
    return res.status(200).json({ answer: finalAnswer, sources, cached: false });
  } catch (error) {
    const details = {
      message: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
    };
    console.error('[ERROR] Chatbot error:', JSON.stringify(details));
    return res.status(500).json({ error: 'Chat assistant is temporarily unavailable.' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    chatbot: {
      enabled: CHATBOT_ENABLED,
      docs: ragDocuments.length,
      faqs: ragFaqs.length,
      embeddings: ragEmbeddingsById ? ragEmbeddingsById.size : 0,
    },
  });
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
