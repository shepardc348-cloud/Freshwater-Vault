# Freshwater Vault

Client portal for Freshwater Landscaping LLC. Clients can view their agreements, search for specific clauses, and get AI-powered explanations of contract terms.

## Features

- **Live Document Sync** - Agreements load from Google Docs, so edits are reflected instantly
- **Quick Search** - Free local keyword search with synonym expansion
- **AI Explain** - Plain-English explanations powered by Gemini (server-side, key not exposed)
- **Dark/Light Mode** - Toggle with the D key or button
- **Mobile Responsive** - Works on phones, tablets, and desktops
- **Offline Support** - PWA with service worker caching
- **Keyboard Shortcuts** - Press ? to see all shortcuts

## Setup

### 1. Deploy to Netlify

**Option A: Drag & Drop**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the `freshwater-vault` folder onto the page
3. Done!

**Option B: Connect GitHub**
1. Push this repo to GitHub
2. In Netlify, click "Add new site" > "Import an existing project"
3. Select your GitHub repo
4. Deploy settings are auto-configured via `netlify.toml`

### 2. Set Environment Variables

In Netlify dashboard > Site settings > Environment variables, add:

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for AI Explain |
| `SENDGRID_API_KEY` | SendGrid key for email notifications (optional) |
| `ANALYTICS_KEY` | Secret key for admin analytics dashboard |

### 3. Google Docs Setup

Your agreements must be shared as "Anyone with the link can view":
1. Open the Google Doc
2. Click Share > General access > "Anyone with the link"
3. Set to "Viewer"
4. Copy the Doc ID from the URL

Current Doc ID: `1lRhOh_Ji2jWlI7BUEo32GGskDAqFEmQp`

## Project Structure

```
freshwater-vault/
  index.html              # Main app (React + Tailwind, single file)
  netlify.toml             # Netlify config, security headers
  manifest.json            # PWA manifest
  sw.js                    # Service worker for offline support
  package.json             # Dependencies (Jest for testing)
  netlify/functions/
    ask.js                 # AI chat endpoint (Gemini)
    analytics.js           # Event tracking endpoint
    notify.js              # Email notification endpoint
  src/css/
    main.css               # Core styles, print styles
    themes.css             # Dark/light theme variables
  src/js/
    app.js                 # Application logic
    docs.js                # Document parsing and search
    analytics.js           # Client-side analytics
    utils.js               # Shared utilities
  tests/
    unit.test.js           # Unit tests
    integration.test.js    # Integration tests
  .github/workflows/
    test.yml               # Run tests on push/PR
    deploy.yml             # Auto-deploy to Netlify
```

## Adding New Documents

To add a new legal document:

1. Create or upload it to Google Docs
2. Share it with "Anyone with the link" > Viewer
3. Copy the Doc ID from the URL
4. Add a new entry in the `clientDocs` array in `index.html`

## Running Tests

```bash
npm install
npm test
```

## Support

Freshwater Landscaping LLC
- Phone: 612-999-8067
- Email: freshwaterlandscaping@gmail.com
