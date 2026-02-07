// Netlify Function: POST /.netlify/functions/ask
// Uses server-side env var: GEMINI_API_KEY (never exposed to browser)

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { question, excerpts } = await req.json().catch(() => ({}));
    if (!question || !Array.isArray(excerpts) || excerpts.length === 0) {
      return new Response(JSON.stringify({ error: "Missing question/excerpts" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Server not configured (missing GEMINI_API_KEY)" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gemini REST endpoint (v1beta). You can swap models as desired.
    const endpoint =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" +
      encodeURIComponent(apiKey);

    const context = excerpts
      .map((x, i) => `SOURCE ${i + 1}: ${x.heading}\n${x.text}`)
      .join("\n\n---\n\n");

    const prompt = `
You are a contract assistant for Freshwater Landscaping.
Answer the user's question in plain English, and cite which SOURCE number(s) you used.
Rules:
- Be clear this is informational only and the signed agreement controls.
- If the excerpt does not contain enough info, say so and suggest what to search.

USER QUESTION:
${question}

EXCERPTS:
${context}
`.trim();

    const geminiBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
    };

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    const data = await r.json().catch(() => ({}));

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join("") || "";

    if (!r.ok || !text) {
      return new Response(
        JSON.stringify({
          error: "Gemini error",
          details: data,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ answer: text }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
