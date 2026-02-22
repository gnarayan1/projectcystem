require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.CHATBOT_EMBEDDING_MODEL || 'text-embedding-3-small';
const BATCH_SIZE = Math.max(1, parseInt(process.env.KB_EMBED_BATCH_SIZE || '20', 10));
const ROOT = path.join(__dirname, '..');
const docsPath = path.join(ROOT, 'rag', 'documents.json');
const outPath = path.join(ROOT, 'rag', 'embeddings.json');

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function getEmbeddings(inputs) {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: MODEL,
      input: inputs,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return response.data?.data || [];
}

async function main() {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required.');
  }
  if (!fs.existsSync(docsPath)) {
    throw new Error(`Missing file: ${docsPath}`);
  }

  const docs = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
  if (!Array.isArray(docs) || !docs.length) {
    throw new Error('rag/documents.json must contain at least one document.');
  }

  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { model: MODEL, items: [] };
  const existingMap = new Map();
  if (Array.isArray(existing.items)) {
    for (const item of existing.items) {
      if (item && typeof item.id === 'string' && Array.isArray(item.embedding)) {
        existingMap.set(item.id, item);
      }
    }
  }

  const pendingDocs = [];
  const items = [];
  for (const doc of docs) {
    const inputText = `${doc.title || ''}\n${doc.content || ''}`;
    const hash = contentHash(inputText);
    const cached = existingMap.get(doc.id);
    if (cached && cached.hash === hash && Array.isArray(cached.embedding)) {
      items.push({ id: doc.id, hash, embedding: cached.embedding });
      continue;
    }
    pendingDocs.push({ id: doc.id, inputText, hash });
  }

  for (let i = 0; i < pendingDocs.length; i += BATCH_SIZE) {
    const batch = pendingDocs.slice(i, i + BATCH_SIZE);
    const responseItems = await getEmbeddings(batch.map((d) => d.inputText));
    if (!Array.isArray(responseItems) || responseItems.length !== batch.length) {
      throw new Error('Embedding API returned unexpected batch response shape.');
    }
    for (let j = 0; j < batch.length; j += 1) {
      const embedding = responseItems[j]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error(`Failed to get embedding for doc id=${batch[j].id}`);
      }
      items.push({ id: batch[j].id, hash: batch[j].hash, embedding });
      console.log(`Embedded: ${batch[j].id}`);
    }
  }

  // Preserve ordering by documents file.
  const byId = new Map(items.map((item) => [item.id, item]));
  const orderedItems = docs.map((doc) => byId.get(doc.id)).filter(Boolean);

  fs.writeFileSync(outPath, JSON.stringify({ model: MODEL, items: orderedItems }, null, 2), 'utf8');
  console.log(`Saved embeddings -> ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
