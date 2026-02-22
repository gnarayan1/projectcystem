const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');
const RAG_DIR = path.join(ROOT, 'rag');
const OUTPUT_DOCS = path.join(RAG_DIR, 'documents.json');
const OUTPUT_FAQS = path.join(RAG_DIR, 'faqs.json');
const OUTPUT_GUARDRAILS = path.join(RAG_DIR, 'guardrails.txt');

const MAX_CHARS = parseInt(process.env.KB_CHUNK_MAX_CHARS || '1800', 10);
const OVERLAP_CHARS = parseInt(process.env.KB_CHUNK_OVERLAP_CHARS || '260', 10);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: text };
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 5);
  const meta = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  }
  return { meta, body };
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTailAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const start = text.length - maxChars;
  const tail = text.slice(start);
  const firstSpace = tail.indexOf(' ');
  if (firstSpace === -1) return tail;
  return tail.slice(firstSpace + 1);
}

function chunkText(text, maxChars, overlapChars) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => normalizeWhitespace(p))
    .filter(Boolean);

  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (paragraph.length > maxChars) {
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + maxChars, paragraph.length);
        const segment = paragraph.slice(start, end).trim();
        if (segment) chunks.push(segment);
        if (end >= paragraph.length) break;
        start = Math.max(0, end - overlapChars);
      }
      current = '';
    } else {
      const overlap = chunks.length ? getTailAtWordBoundary(chunks[chunks.length - 1], overlapChars) : '';
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function buildDocuments() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    throw new Error(`Missing knowledge directory: ${KNOWLEDGE_DIR}`);
  }

  const files = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'guardrails.md')
    .sort();

  const documents = [];
  for (const file of files) {
    const fullPath = path.join(KNOWLEDGE_DIR, file);
    const { meta, body } = parseFrontmatter(fs.readFileSync(fullPath, 'utf8'));
    const cleanBody = stripMarkdown(body);
    if (!cleanBody) continue;

    const title = meta.title || file.replace(/\.md$/i, '').replace(/_/g, ' ');
    const sourceUrl = meta.source_url || '';
    const tags = meta.tags
      ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const chunks = chunkText(cleanBody, MAX_CHARS, OVERLAP_CHARS);
    const baseId = slugify(file.replace(/\.md$/i, ''));

    chunks.forEach((chunk, index) => {
      documents.push({
        id: `${baseId}-${index + 1}`,
        title: chunks.length > 1 ? `${title} (Part ${index + 1})` : title,
        url: sourceUrl,
        content: chunk,
        section: file.replace(/\.md$/i, ''),
        tags,
        token_estimate: estimateTokens(chunk),
      });
    });
  }

  return documents;
}

function validateFaqs(faqs) {
  if (!Array.isArray(faqs)) throw new Error('knowledge/faq.json must be an array.');
  for (const item of faqs) {
    if (!item || typeof item !== 'object') throw new Error('Each FAQ item must be an object.');
    if (!Array.isArray(item.prompts) || !item.prompts.length) {
      throw new Error(`FAQ "${item.id || 'unknown'}" must include prompts[].`);
    }
    if (typeof item.answer !== 'string' || !item.answer.trim()) {
      throw new Error(`FAQ "${item.id || 'unknown'}" must include answer.`);
    }
    if (!Array.isArray(item.sources)) item.sources = [];
  }
}

function buildFaqs() {
  const faqPath = path.join(KNOWLEDGE_DIR, 'faq.json');
  if (!fs.existsSync(faqPath)) return [];
  const faqs = JSON.parse(fs.readFileSync(faqPath, 'utf8'));
  validateFaqs(faqs);
  return faqs;
}

function buildGuardrails() {
  const guardrailsPath = path.join(KNOWLEDGE_DIR, 'guardrails.md');
  if (!fs.existsSync(guardrailsPath)) return '';
  const raw = fs.readFileSync(guardrailsPath, 'utf8');
  const { body } = parseFrontmatter(raw);
  return stripMarkdown(body);
}

function main() {
  ensureDir(RAG_DIR);
  const documents = buildDocuments();
  const faqs = buildFaqs();
  const guardrails = buildGuardrails();

  fs.writeFileSync(OUTPUT_DOCS, JSON.stringify(documents, null, 2), 'utf8');
  fs.writeFileSync(OUTPUT_FAQS, JSON.stringify(faqs, null, 2), 'utf8');
  fs.writeFileSync(OUTPUT_GUARDRAILS, guardrails, 'utf8');

  console.log(`Built ${documents.length} chunks -> ${OUTPUT_DOCS}`);
  console.log(`Built ${faqs.length} FAQs -> ${OUTPUT_FAQS}`);
  console.log(`Wrote guardrails -> ${OUTPUT_GUARDRAILS}`);
}

main();
