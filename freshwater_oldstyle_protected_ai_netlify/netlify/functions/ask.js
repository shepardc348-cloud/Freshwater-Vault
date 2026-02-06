const rateLimit = new Map();

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const now = Date.now();
    const hourAgo = now - 3600000;

    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, []);
    }

    const requests = rateLimit.get(ip).filter(time => time > hourAgo);

    if (requests.length >= 20) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({
                error: 'Rate limit exceeded. Please try again in an hour or contact support at 612-999-8067.'
            })
        };
    }

    requests.push(now);
    rateLimit.set(ip, requests);

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid request format' })
        };
    }

    const { question, excerpts } = body;

    if (!question || !excerpts || !Array.isArray(excerpts)) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing question or excerpts' })
        };
    }

    if (!process.env.GEMINI_API_KEY) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Missing GEMINI_API_KEY in Netlify environment variables.' })
        };
    }

    const context = excerpts.map(e => `## ${e.heading}\n${e.text}`).join('\n\n');

    const systemPrompt = `You are a helpful legal assistant for Freshwater Landscaping LLC.

CRITICAL RULES:
- You are NOT a lawyer. Provide informational explanations only.
- Answer ONLY using the provided agreement excerpts below.
- If the answer isn't in the excerpts, say "I don't see that specific information in the provided sections. Try searching for keywords like [suggest 2-3 keywords]."
- NEVER invent or assume contract terms.
- Keep answers under 600 characters.
- Use bullet points for clarity.
- Cite the source heading.

AGREEMENT EXCERPTS:
${context}

USER QUESTION: ${question}

Provide a clear, plain-English explanation with key implications in bullets. Always cite the source heading.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 500
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error('Gemini API error');
        }

        const data = await response.json();
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate response.';

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ answer })
        };

    } catch (error) {
        console.error('Gemini error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'AI service temporarily unavailable. Please try Quick Answer mode or contact 612-999-8067.'
            })
        };
    }
};
