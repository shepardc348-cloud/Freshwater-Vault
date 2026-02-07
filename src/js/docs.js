/**
 * Freshwater Vault - Document Processing Module
 *
 * Handles agreement loading, parsing, search,
 * and text processing.
 */

const GOOGLE_DOC_ID = '1lRhOh_Ji2jWlI7BUEo32GGskDAqFEmQp';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const CACHE_KEY = 'agreement_cache';
const CACHE_TIME_KEY = 'agreement_cache_time';

// Synonym dictionary for agreement search
const SYNONYMS = {
  cancel: [
    'cancellation',
    'terminate',
    'termination',
    'quit',
    'end',
    'refund',
    'deposit',
  ],
  payment: [
    'payments',
    'invoice',
    'billing',
    'net',
    'fee',
    'charge',
    'cost',
    'price',
  ],
  late: [
    'late',
    'overdue',
    'past',
    'due',
    'interest',
    'finance',
    'charge',
    'apr',
    'penalty',
  ],
  liability: [
    'liability',
    'damage',
    'damages',
    'responsible',
    'responsibility',
    'injury',
    'slip',
    'fall',
    'warranty',
    'warranties',
    'indemnif',
  ],
  dispute: [
    'dispute',
    'arbitration',
    'court',
    'lawsuit',
    'sue',
    'venue',
    'jury',
    'mediation',
  ],
  snow: [
    'snow',
    'ice',
    'plow',
    'plowing',
    'trigger',
    'accumulation',
    'storm',
    'berm',
    'salt',
    'deice',
  ],
  scope: [
    'scope',
    'work',
    'change',
    'order',
    'extras',
    'additional',
    'addendum',
  ],
  mowing: [
    'mowing',
    'mow',
    'lawn',
    'grass',
    'turf',
    'cut',
    'trim',
    'edge',
  ],
  season: [
    'season',
    'term',
    'duration',
    'length',
    'period',
    'year',
    'annual',
  ],
};

/**
 * Load agreement text from Google Docs or cache.
 * @returns {Promise<{text: string, status: string}>}
 */
async function loadAgreement() {
  // Check cache first
  const cached = localStorage.getItem(CACHE_KEY);
  const cachedTime = localStorage.getItem(CACHE_TIME_KEY);

  if (cached && cachedTime && Date.now() - parseInt(cachedTime) < CACHE_DURATION) {
    return { text: cached, status: 'cached' };
  }

  try {
    const url = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/export?format=txt`;
    const response = await fetch(url);

    if (!response.ok) throw new Error('Fetch failed');

    const text = await response.text();
    localStorage.setItem(CACHE_KEY, text);
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());

    return { text, status: 'loaded' };
  } catch {
    if (cached) {
      return { text: cached, status: 'cached' };
    }
    return {
      text: 'Unable to load agreement. Please contact support.',
      status: 'error',
    };
  }
}

/**
 * Normalize text for comparison.
 * @param {string} q
 * @returns {string}
 */
function normalize(q) {
  return (q || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse agreement text into structured chunks by heading.
 * @param {string} text
 * @returns {Array<{heading: string, text: string}>}
 */
function parseAgreement(text) {
  const lines = (text || '').split(/\r?\n/);
  const chunks = [];
  let cur = { heading: 'INTRODUCTION', text: '' };

  function isHeading(t) {
    const s = (t || '').trim();
    if (!s) return false;
    if (/^(ARTICLE|SECTION)\b/i.test(s)) return true;
    if (/^\d+(\.\d+)*\s+/.test(s)) return true;
    if (/^[A-Z0-9][A-Z0-9\s\-:&]{8,70}$/.test(s) && s === s.toUpperCase())
      return true;
    return false;
  }

  for (const line of lines) {
    const t = line.trim();
    if (isHeading(t)) {
      if (cur.text.trim()) chunks.push(cur);
      cur = { heading: t, text: '' };
    } else {
      cur.text += line + '\n';
    }
  }
  if (cur.text.trim()) chunks.push(cur);

  return chunks.length ? chunks : [{ heading: 'AGREEMENT', text: text || '' }];
}

/**
 * Expand search tokens using synonym dictionary.
 * @param {string} question
 * @returns {string[]}
 */
function expandTokens(question) {
  const q = normalize(question);
  const raw = q.split(' ').filter(Boolean);
  const set = new Set(raw);

  for (const [k, arr] of Object.entries(SYNONYMS)) {
    for (const w of raw) {
      if (w === k || arr.includes(w)) {
        set.add(k);
        arr.forEach((x) => set.add(x));
      }
    }
  }

  return Array.from(set)
    .filter((t) => t.length >= 3)
    .slice(0, 30);
}

/**
 * Find best matching chunks for a question.
 * @param {string} agreementText
 * @param {string} question
 * @param {number} top
 * @returns {Array<{heading: string, text: string, score: number}>}
 */
function bestMatches(agreementText, question, top = 3) {
  const chunks = parseAgreement(agreementText);
  const tokens = expandTokens(question);

  const scored = chunks
    .map((c) => {
      const hay = (c.heading + '\n' + c.text).toLowerCase();
      let score = 0;
      for (const t of tokens) {
        const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + safe + '\\b', 'g');
        const m = hay.match(re);
        if (m) score += m.length;
      }
      return { ...c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, top);
}

/**
 * Extract a text excerpt.
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function excerpt(text, limit = 900) {
  const s = (text || '').trim().replace(/\s+/g, ' ');
  return s.length > limit ? s.slice(0, limit) + '...' : s;
}

/**
 * Build table of contents from agreement text.
 * @param {string} text
 * @returns {Array<{id: number, heading: string}>}
 */
function buildTOC(text) {
  const chunks = parseAgreement(text);
  return chunks.map((c, i) => ({ id: i, heading: c.heading }));
}

export {
  GOOGLE_DOC_ID,
  CACHE_DURATION,
  SYNONYMS,
  loadAgreement,
  normalize,
  parseAgreement,
  expandTokens,
  bestMatches,
  excerpt,
  buildTOC,
};
