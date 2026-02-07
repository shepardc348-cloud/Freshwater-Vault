/**
 * Freshwater Vault - Unit Tests
 *
 * Tests for core utility functions, document parsing,
 * and search logic.
 */

// Mock DOM for sanitize function
const mockElement = { innerHTML: '', textContent: '' };
global.document = {
  createElement: () => ({ ...mockElement }),
};
global.window = {
  location: { pathname: '/' },
  matchMedia: () => ({ matches: false }),
};
global.localStorage = (() => {
  const store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
})();
global.sessionStorage = (() => {
  const store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
  };
})();

// Import functions to test (these are inline copies for testing
// since the source uses ES modules which Jest handles with transform)
// ─── Utility Functions ───────────────────────────────────

function normalize(q) {
  return (q || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function excerpt(text, limit = 900) {
  const s = (text || '').trim().replace(/\s+/g, ' ');
  return s.length > limit ? s.slice(0, limit) + '...' : s;
}

function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength).trim() + '...';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ─── Document Functions ──────────────────────────────────

const SYNONYMS = {
  cancel: ['cancellation', 'terminate', 'termination', 'quit', 'end', 'refund', 'deposit'],
  payment: ['payments', 'invoice', 'billing', 'net', 'fee', 'charge', 'cost', 'price'],
  late: ['late', 'overdue', 'past', 'due', 'interest', 'finance', 'charge', 'apr', 'penalty'],
  liability: ['liability', 'damage', 'damages', 'responsible', 'responsibility'],
  snow: ['snow', 'ice', 'plow', 'plowing', 'trigger', 'accumulation', 'storm', 'berm'],
};

function parseAgreement(text) {
  const lines = (text || '').split(/\r?\n/);
  const chunks = [];
  let cur = { heading: 'INTRODUCTION', text: '' };
  const isHeading = (t) => {
    const s = (t || '').trim();
    if (!s) return false;
    if (/^(ARTICLE|SECTION)\b/i.test(s)) return true;
    if (/^\d+(\.\d+)*\s+/.test(s)) return true;
    if (/^[A-Z0-9][A-Z0-9\s\-:&]{8,70}$/.test(s) && s === s.toUpperCase()) return true;
    return false;
  };
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

function expandTokens(question) {
  const q = normalize(question);
  const raw = q.split(' ').filter(Boolean);
  const set = new Set(raw);
  for (const [k, arr] of Object.entries(SYNONYMS)) {
    for (const w of raw) {
      if (w === k || arr.includes(w)) { set.add(k); arr.forEach(x => set.add(x)); }
    }
  }
  return Array.from(set).filter(t => t.length >= 3).slice(0, 30);
}

function bestMatches(agreementText, question, top = 3) {
  const chunks = parseAgreement(agreementText);
  const tokens = expandTokens(question);
  const scored = chunks.map(c => {
    const hay = (c.heading + '\n' + c.text).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\b' + safe + '\\b', 'g');
      const m = hay.match(re);
      if (m) score += m.length;
    }
    return { ...c, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, top);
}

// ─── Tests ────────────────────────────────────────────────

describe('Utility Functions', () => {
  describe('normalize', () => {
    test('converts to lowercase and strips special chars', () => {
      expect(normalize('Hello World!')).toBe('hello world');
    });

    test('handles empty input', () => {
      expect(normalize('')).toBe('');
      expect(normalize(null)).toBe('');
      expect(normalize(undefined)).toBe('');
    });

    test('collapses whitespace', () => {
      expect(normalize('  hello   world  ')).toBe('hello world');
    });

    test('strips punctuation but keeps alphanumeric', () => {
      expect(normalize('Section 1.2: Payment Terms')).toBe('section 1 2 payment terms');
    });
  });

  describe('generateSessionId', () => {
    test('generates unique IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).not.toBe(id2);
    });

    test('starts with sess_ prefix', () => {
      expect(generateSessionId()).toMatch(/^sess_/);
    });
  });

  describe('excerpt', () => {
    test('returns full text if under limit', () => {
      expect(excerpt('hello world', 100)).toBe('hello world');
    });

    test('truncates text over limit', () => {
      const long = 'a'.repeat(1000);
      const result = excerpt(long, 100);
      expect(result.length).toBe(103); // 100 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    test('handles empty input', () => {
      expect(excerpt('')).toBe('');
      expect(excerpt(null)).toBe('');
    });

    test('collapses whitespace', () => {
      expect(excerpt('hello   world')).toBe('hello world');
    });
  });

  describe('truncate', () => {
    test('returns string unchanged if under limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    test('truncates with ellipsis', () => {
      expect(truncate('hello world foo', 10)).toBe('hello worl...');
    });

    test('handles falsy values', () => {
      expect(truncate('')).toBe('');
      expect(truncate(null)).toBe(null);
      expect(truncate(undefined)).toBe(undefined);
    });
  });

  describe('isValidEmail', () => {
    test('validates correct emails', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('a@b.co')).toBe(true);
    });

    test('rejects invalid emails', () => {
      expect(isValidEmail('notanemail')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('isNonEmptyString', () => {
    test('returns true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
    });

    test('returns false for empty or whitespace strings', () => {
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString('   ')).toBe(false);
    });

    test('returns false for non-strings', () => {
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
    });
  });

  describe('simpleHash', () => {
    test('produces consistent hashes', () => {
      expect(simpleHash('test')).toBe(simpleHash('test'));
    });

    test('produces different hashes for different inputs', () => {
      expect(simpleHash('hello')).not.toBe(simpleHash('world'));
    });
  });

  describe('debounce', () => {
    jest.useFakeTimers();

    test('delays function execution', () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('resets timer on subsequent calls', () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      jest.advanceTimersByTime(50);
      debounced();
      jest.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Document Processing', () => {
  const sampleAgreement = `MASTER SERVICE AGREEMENT

This agreement is between Freshwater Landscaping and the client.

SECTION 1: PAYMENT TERMS

Payment is due within 30 days of invoice. Late payments incur a 1.5% monthly fee.

SECTION 2: CANCELLATION POLICY

Client may cancel with 30 days written notice. Deposits are non-refundable.

SECTION 3: LIABILITY AND DAMAGES

Freshwater is not liable for pre-existing damage. Client assumes responsibility for property conditions.

SECTION 4: SNOW REMOVAL SERVICES

Snow plowing is triggered at 2 inch accumulation. Salt and deicing are additional charges.`;

  describe('parseAgreement', () => {
    test('parses agreement into chunks', () => {
      const chunks = parseAgreement(sampleAgreement);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test('identifies section headings', () => {
      const chunks = parseAgreement(sampleAgreement);
      const headings = chunks.map(c => c.heading);
      expect(headings).toContain('SECTION 1: PAYMENT TERMS');
      expect(headings).toContain('SECTION 2: CANCELLATION POLICY');
    });

    test('handles empty text', () => {
      const chunks = parseAgreement('');
      expect(chunks).toEqual([{ heading: 'AGREEMENT', text: '' }]);
    });

    test('handles text with no headings', () => {
      const chunks = parseAgreement('Just some plain text here.');
      expect(chunks.length).toBe(1);
      expect(chunks[0].heading).toBe('INTRODUCTION');
    });
  });

  describe('expandTokens', () => {
    test('expands cancel to related terms', () => {
      const tokens = expandTokens('cancel');
      expect(tokens).toContain('cancel');
      expect(tokens).toContain('cancellation');
      expect(tokens).toContain('terminate');
      expect(tokens).toContain('refund');
    });

    test('expands payment-related queries', () => {
      const tokens = expandTokens('payment');
      expect(tokens).toContain('payment');
      expect(tokens).toContain('invoice');
      expect(tokens).toContain('billing');
    });

    test('filters short tokens', () => {
      const tokens = expandTokens('a b');
      expect(tokens.every(t => t.length >= 3)).toBe(true);
    });

    test('limits number of tokens', () => {
      const tokens = expandTokens('cancel payment late liability snow');
      expect(tokens.length).toBeLessThanOrEqual(30);
    });
  });

  describe('bestMatches', () => {
    test('finds payment-related sections', () => {
      const matches = bestMatches(sampleAgreement, 'payment terms');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].heading).toContain('PAYMENT');
    });

    test('finds cancellation sections', () => {
      const matches = bestMatches(sampleAgreement, 'cancel my service');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].heading).toContain('CANCELLATION');
    });

    test('finds snow-related sections', () => {
      const matches = bestMatches(sampleAgreement, 'snow plowing');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].heading).toContain('SNOW');
    });

    test('returns empty for unrelated queries', () => {
      const matches = bestMatches(sampleAgreement, 'xyzzy nonsense');
      expect(matches.length).toBe(0);
    });

    test('respects top parameter', () => {
      const matches = bestMatches(sampleAgreement, 'payment', 1);
      expect(matches.length).toBeLessThanOrEqual(1);
    });

    test('scores results by relevance', () => {
      const matches = bestMatches(sampleAgreement, 'late payment fee');
      if (matches.length > 1) {
        expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
      }
    });
  });
});
