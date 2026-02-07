// Rate limiting store (in-memory, resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 20; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

// Response cache
const responseCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getClientIP(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (record.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((record.windowStart + RATE_WINDOW - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}

function getCacheKey(question, excerpts) {
  const normalized = question.toLowerCase().trim();
  const excerptKey = excerpts.map((e) => e.heading).join('|');
  return `${normalized}::${excerptKey}`;
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').slice(0, 2000);
}

export default async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  // Rate limiting
  const clientIP = getClientIP(req);
  const rateCheck = checkRateLimit(clientIP);

  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({
        error: `Rate limit exceeded. Try again in ${rateCheck.resetIn}s.`,
        resetIn: rateCheck.resetIn,
      }),
      {
        status: 429,
        headers: {
          ...headers,
          'Retry-After': String(rateCheck.resetIn),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const question = sanitizeInput(body.question);
    const excerpts = Array.isArray(body.excerpts) ? body.excerpts : [];

    if (!question || excerpts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing question or excerpts' }),
        { status: 400, headers }
      );
    }

    // Sanitize excerpts
    const cleanExcerpts = excerpts.slice(0, 5).map((e) => ({
      heading: sanitizeInput(e.heading || ''),
      text: sanitizeInput(e.text || '').slice(0, 1500),
    }));

    // Check cache
    const cacheKey = getCacheKey(question, cleanExcerpts);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return new Response(
        JSON.stringify({ answer: cached.answer, cached: true }),
        {
          status: 200,
          headers: { ...headers, 'X-RateLimit-Remaining': String(rateCheck.remaining) },
        }
      );
    }

    // Verify API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Server not configured (missing GEMINI_API_KEY)' }),
        { status: 500, headers }
      );
    }

    // Build prompt
    const context = cleanExcerpts
      .map((x, i) => `SOURCE ${i + 1}: ${x.heading}\n${x.text}`)
      .join('\n\n---\n\n');

    const prompt = `You are a contract assistant for Freshwater Landscaping.
Answer the user's question in plain English, and cite which SOURCE number(s) you used.
Rules:
- Be clear this is informational only and the signed agreement controls.
- If the excerpt does not contain enough info, say so and suggest what to search.
- Keep answers concise and helpful.
- Do not make up terms or conditions not present in the sources.

USER QUESTION: ${question}

EXCERPTS:
${context}`.trim();

    // Call Gemini API
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 600,
        topP: 0.8,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    };

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    const data = await r.json().catch(() => ({}));
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join('') || '';

    if (!r.ok || !text) {
      return new Response(
        JSON.stringify({ error: 'Gemini error', details: data?.error?.message || 'Unknown' }),
        { status: 502, headers }
      );
    }

    // Cache the response
    responseCache.set(cacheKey, { answer: text, timestamp: Date.now() });

    // Clean old cache entries
    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [key, val] of responseCache) {
        if (now - val.timestamp > CACHE_TTL) responseCache.delete(key);
      }
    }

    return new Response(
      JSON.stringify({ answer: text }),
      {
        status: 200,
        headers: { ...headers, 'X-RateLimit-Remaining': String(rateCheck.remaining) },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Unknown error' }),
      { status: 500, headers }
    );
  }
};
