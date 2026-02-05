// netlify/functions/ask.js
// Protected Gemini proxy (keeps API key OFF the browser).
// Add GEMINI_API_KEY in Netlify -> Site settings -> Environment variables.

const https = require("https");

const rateLimit = new Map();

function getIp(headers) {
  const xf = headers["x-forwarded-for"];
  if (xf) return xf.split(",")[0].trim();
  return headers["client-ip"] || headers["x-real-ip"] || "unknown";
}

async function doFetch(url, options) {
  if (typeof fetch === "function") {
    return fetch(url, options);
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: options?.method || "GET",
        headers: options?.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => data,
            json: async () => {
              try {
                return JSON.parse(data);
              } catch (error) {
                error.message = `Failed to parse JSON response: ${error.message}`;
                throw error;
              }
            },
          });
        });
      }
    );

    req.on("error", reject);
    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  // Basic IP rate limit
  const ip = getIp(event.headers || {});
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 min
  const maxReq = 12; // adjust: 12 requests / 10 minutes / IP

  const recent = (rateLimit.get(ip) || []).filter((t) => t > now - windowMs);
  if (recent.length >= maxReq) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }) };
  }
  recent.push(now);
  rateLimit.set(ip, recent);

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const question = String(body.question || "").trim();
  const excerpts = Array.isArray(body.excerpts) ? body.excerpts : [];
  if (!question || excerpts.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing question or excerpts" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server not configured (missing GEMINI_API_KEY)" }) };
  }

  const context = excerpts.slice(0, 3).map((e, i) => {
    const heading = String(e.heading || "").slice(0, 220);
    const text = String(e.text || "").slice(0, 1600);
    return `EXCERPT ${i + 1}\nHEADING: ${heading}\nTEXT: ${text}`;
  }).join("\n\n");

  const prompt = `You are a careful, helpful contract explainer for Freshwater Landscaping LLC.

RULES (non-negotiable):
- Informational only; not legal advice.
- Answer ONLY using the excerpts provided below.
- If the excerpts do not contain the answer, say you cannot locate it and suggest 2-3 keywords to search.
- Do NOT invent or assume contract terms.
- Keep it concise. Use short paragraphs and bullets when helpful.
- End with: "Source: <HEADING>" using the best matching heading from the excerpts.

USER QUESTION:
${question}

EXCERPTS:
${context}

Write the explanation now.`;

  try {
    const r = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
        }),
      }
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Gemini API error", detail: errText.slice(0, 300) }) };
    }

    const data = await r.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response from the excerpts provided.";
    return { statusCode: 200, headers, body: JSON.stringify({ answer }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "AI service unavailable" }) };
  }
};
