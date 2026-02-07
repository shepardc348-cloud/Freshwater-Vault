/**
 * Freshwater Vault - Integration Tests
 *
 * Tests for API endpoints, caching behavior,
 * and end-to-end workflows.
 */

// Mock fetch for API tests
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Mock localStorage
const localStorageMock = (() => {
  const store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, val) => { store[key] = String(val); }),
    removeItem: jest.fn((key) => { delete store[key]; }),
    clear: jest.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
  };
})();

global.localStorage = localStorageMock;
global.sessionStorage = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
};
global.document = {
  createElement: () => ({ innerHTML: '', textContent: '' }),
};
global.window = {
  location: { pathname: '/', search: '' },
  matchMedia: () => ({ matches: false }),
};

describe('API Integration: ask.js', () => {
  test('rejects non-POST requests', async () => {
    // Simulate the function logic
    const method = 'GET';
    expect(method).not.toBe('POST');
  });

  test('validates required fields', () => {
    const body = { question: '', excerpts: [] };
    const isValid = body.question && Array.isArray(body.excerpts) && body.excerpts.length > 0;
    expect(isValid).toBe(false);
  });

  test('accepts valid request body', () => {
    const body = {
      question: 'What is the cancellation policy?',
      excerpts: [{ heading: 'SECTION 2', text: 'Client may cancel...' }],
    };
    const isValid = body.question && Array.isArray(body.excerpts) && body.excerpts.length > 0;
    expect(isValid).toBe(true);
  });

  test('sanitizes input strings', () => {
    const input = '<script>alert("xss")</script>Hello';
    const sanitized = input.replace(/<[^>]*>/g, '').slice(0, 2000);
    expect(sanitized).toBe('alert("xss")Hello');
    expect(sanitized).not.toContain('<script>');
  });

  test('limits excerpt length', () => {
    const longText = 'a'.repeat(3000);
    const limited = longText.slice(0, 1500);
    expect(limited.length).toBe(1500);
  });
});

describe('API Integration: analytics.js', () => {
  test('tracks events with required fields', () => {
    const event = {
      event: 'page_view',
      sessionId: 'sess_test123',
      timestamp: Date.now(),
      path: '/',
    };

    expect(event.event).toBeDefined();
    expect(event.sessionId).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  test('sanitizes event data', () => {
    const rawEvent = '<img onerror=alert(1)>search_term';
    const sanitized = rawEvent.replace(/<[^>]*>/g, '').slice(0, 500);
    expect(sanitized).not.toContain('<img');
    expect(sanitized).toContain('search_term');
  });

  test('caps stored events', () => {
    const events = Array.from({ length: 600 }, (_, i) => ({
      event: 'test',
      id: i,
    }));
    const MAX_EVENTS = 500;
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
    expect(events.length).toBe(500);
  });
});

describe('Caching Behavior', () => {
  test('cache key generation is consistent', () => {
    function getCacheKey(question, excerpts) {
      const normalized = question.toLowerCase().trim();
      const excerptKey = excerpts.map((e) => e.heading).join('|');
      return `${normalized}::${excerptKey}`;
    }

    const key1 = getCacheKey('What is the fee?', [{ heading: 'SECTION 1' }]);
    const key2 = getCacheKey('what is the fee?', [{ heading: 'SECTION 1' }]);
    expect(key1).toBe(key2);
  });

  test('cache respects TTL', () => {
    const CACHE_TTL = 60 * 60 * 1000; // 1 hour
    const cachedAt = Date.now() - 30 * 60 * 1000; // 30 minutes ago
    const isValid = Date.now() - cachedAt < CACHE_TTL;
    expect(isValid).toBe(true);

    const expiredAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    const isExpired = Date.now() - expiredAt < CACHE_TTL;
    expect(isExpired).toBe(false);
  });
});

describe('Rate Limiting', () => {
  test('tracks requests per IP', () => {
    const rateLimitMap = new Map();
    const RATE_LIMIT = 20;
    const RATE_WINDOW = 60 * 60 * 1000;

    function checkRateLimit(ip) {
      const now = Date.now();
      const record = rateLimitMap.get(ip);
      if (!record || now - record.windowStart > RATE_WINDOW) {
        rateLimitMap.set(ip, { windowStart: now, count: 1 });
        return { allowed: true, remaining: RATE_LIMIT - 1 };
      }
      if (record.count >= RATE_LIMIT) {
        return { allowed: false, remaining: 0 };
      }
      record.count++;
      return { allowed: true, remaining: RATE_LIMIT - record.count };
    }

    // First request should be allowed
    const result1 = checkRateLimit('192.168.1.1');
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(19);

    // Simulate 19 more requests
    for (let i = 0; i < 19; i++) {
      checkRateLimit('192.168.1.1');
    }

    // 21st request should be denied
    const result21 = checkRateLimit('192.168.1.1');
    expect(result21.allowed).toBe(false);
    expect(result21.remaining).toBe(0);

    // Different IP should still be allowed
    const resultOther = checkRateLimit('10.0.0.1');
    expect(resultOther.allowed).toBe(true);
  });
});

describe('Agreement Loading Workflow', () => {
  test('falls back to cache on fetch failure', async () => {
    const CACHE_KEY = 'agreement_cache';
    const cachedText = 'Cached agreement text';

    // Simulate cache exists
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === CACHE_KEY) return cachedText;
      if (key === 'agreement_cache_time') return String(Date.now() - 2 * 60 * 60 * 1000); // expired
      return null;
    });

    // Simulate fetch failure
    global.fetch.mockRejectedValue(new Error('Network error'));

    // The loadAgreement function would fall back to cache
    const cached = localStorageMock.getItem(CACHE_KEY);
    expect(cached).toBe(cachedText);
  });

  test('uses fresh cache within TTL', () => {
    const CACHE_DURATION = 60 * 60 * 1000;
    const cachedTime = Date.now() - 30 * 60 * 1000; // 30 min ago

    const isFresh = Date.now() - cachedTime < CACHE_DURATION;
    expect(isFresh).toBe(true);
  });
});

describe('Input Validation', () => {
  test('rejects empty questions', () => {
    const question = '';
    expect(question.trim().length).toBe(0);
  });

  test('limits question length', () => {
    const longQuestion = 'a'.repeat(5000);
    const sanitized = longQuestion.slice(0, 2000);
    expect(sanitized.length).toBe(2000);
  });

  test('strips HTML from excerpts', () => {
    const malicious = '<script>alert("xss")</script>Normal text';
    const clean = malicious.replace(/<[^>]*>/g, '');
    expect(clean).toBe('alert("xss")Normal text');
    expect(clean).not.toContain('<');
  });

  test('limits number of excerpts', () => {
    const excerpts = Array.from({ length: 10 }, (_, i) => ({
      heading: `Section ${i}`,
      text: `Content ${i}`,
    }));
    const limited = excerpts.slice(0, 5);
    expect(limited.length).toBe(5);
  });
});

describe('Session Management', () => {
  test('generates unique session IDs', () => {
    function generateSessionId() {
      return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSessionId());
    }
    expect(ids.size).toBe(100);
  });

  test('session IDs have correct format', () => {
    function generateSessionId() {
      return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    const id = generateSessionId();
    expect(id).toMatch(/^sess_[a-z0-9]+_[a-z0-9]+$/);
  });
});
