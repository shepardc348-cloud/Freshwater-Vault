// In-memory analytics store (resets on cold start)
// For production, use a database like Supabase, PlanetScale, or Netlify Blobs
const analyticsStore = [];
const MAX_EVENTS = 10000;

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').slice(0, 500);
}

export default async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // POST: Track an event
  if (req.method === 'POST') {
    try {
      const body = await req.json().catch(() => ({}));

      const event = {
        event: sanitizeInput(body.event || 'unknown'),
        sessionId: sanitizeInput(body.sessionId || ''),
        timestamp: Date.now(),
        path: sanitizeInput(body.path || ''),
        query: sanitizeInput(body.query || ''),
        mode: sanitizeInput(body.mode || ''),
        userAgent: req.headers.get('user-agent')?.slice(0, 200) || '',
        ip:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          'unknown',
      };

      analyticsStore.push(event);

      // Cap stored events
      if (analyticsStore.length > MAX_EVENTS) {
        analyticsStore.splice(0, analyticsStore.length - MAX_EVENTS);
      }

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err?.message || 'Unknown error' }),
        { status: 500, headers }
      );
    }
  }

  // GET: Retrieve analytics (admin only)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    const adminKey = process.env.ANALYTICS_KEY || 'SECRET';

    if (key !== adminKey) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers }
      );
    }

    const now = Date.now();
    const last24h = analyticsStore.filter(
      (e) => now - e.timestamp < 24 * 60 * 60 * 1000
    );
    const last7d = analyticsStore.filter(
      (e) => now - e.timestamp < 7 * 24 * 60 * 60 * 1000
    );

    // Aggregate metrics
    const metrics = {
      total_events: analyticsStore.length,
      last_24h: {
        events: last24h.length,
        page_views: last24h.filter((e) => e.event === 'page_view').length,
        searches: last24h.filter((e) => e.event === 'search').length,
        ai_queries: last24h.filter((e) => e.event === 'ai_query').length,
        unique_sessions: new Set(last24h.map((e) => e.sessionId)).size,
      },
      last_7d: {
        events: last7d.length,
        page_views: last7d.filter((e) => e.event === 'page_view').length,
        searches: last7d.filter((e) => e.event === 'search').length,
        ai_queries: last7d.filter((e) => e.event === 'ai_query').length,
        unique_sessions: new Set(last7d.map((e) => e.sessionId)).size,
      },
      top_searches: getTopItems(
        last7d.filter((e) => e.event === 'search').map((e) => e.query),
        10
      ),
      recent_events: last24h.slice(-20).reverse(),
    };

    return new Response(JSON.stringify(metrics, null, 2), {
      status: 200,
      headers,
    });
  }

  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { status: 405, headers }
  );
};

function getTopItems(arr, limit = 10) {
  const counts = {};
  arr.forEach((item) => {
    if (item) counts[item] = (counts[item] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}
