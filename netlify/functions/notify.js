function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').slice(0, 1000);
}

export default async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { to, subject, message, type } = body;

    if (!to || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, message' }),
        { status: 400, headers }
      );
    }

    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (!sendgridKey) {
      // Log notification locally if SendGrid not configured
      console.log('[notify] No SENDGRID_API_KEY configured. Notification:', {
        to: sanitizeInput(to),
        subject: sanitizeInput(subject),
        type: sanitizeInput(type || 'general'),
        timestamp: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          ok: true,
          note: 'Notification logged (SendGrid not configured)',
        }),
        { status: 200, headers }
      );
    }

    const fromEmail =
      process.env.SENDGRID_FROM_EMAIL || 'notifications@freshwatervault.com';

    const emailBody = {
      personalizations: [
        {
          to: [{ email: sanitizeInput(to) }],
          subject: sanitizeInput(subject),
        },
      ],
      from: { email: fromEmail, name: 'Freshwater Vault' },
      content: [
        {
          type: 'text/html',
          value: buildEmailHTML(
            sanitizeInput(subject),
            sanitizeInput(message),
            sanitizeInput(type || 'general')
          ),
        },
      ],
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sendgridKey}`,
      },
      body: JSON.stringify(emailBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return new Response(
        JSON.stringify({ error: 'SendGrid error', details: errorText }),
        { status: 502, headers }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: 'Notification sent' }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Unknown error' }),
      { status: 500, headers }
    );
  }
};

function buildEmailHTML(subject, message, type) {
  const colors = {
    general: '#06b6d4',
    alert: '#ef4444',
    success: '#10b981',
    info: '#3b82f6',
  };
  const color = colors[type] || colors.general;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:${color};padding:24px 32px;">
        <h1 style="margin:0;color:white;font-size:20px;font-weight:700;">Freshwater Vault</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px;">${subject}</h2>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">${message}</p>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Freshwater Landscaping LLC | Secure Client Portal</p>
      </div>
    </div>
  </div>
</body>
</html>`.trim();
}
