/**
 * Freshwater Vault - Main Application Module
 *
 * Core application logic including state management,
 * routing, and initialization.
 */

import { sanitize, debounce, generateSessionId } from './utils.js';
import { loadAgreement, parseAgreement, bestMatches, excerpt } from './docs.js';
import { analytics } from './analytics.js';

// Application state
const state = {
  view: sessionStorage.getItem('fw_view') || 'landing',
  tab: sessionStorage.getItem('fw_tab') || 'dashboard',
  mode: 'quick',
  darkMode: (() => {
    const saved = localStorage.getItem('fw_dark');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  })(),
  agreementText: '',
  agreementStatus: 'loading',
  chatHistory: [],
  isTyping: false,
};

// State subscribers
const subscribers = new Set();

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function setState(updates) {
  Object.assign(state, updates);
  subscribers.forEach((fn) => fn(state));
}

function getState() {
  return { ...state };
}

// Initialize application
async function init() {
  analytics.init();
  applyDarkMode(state.darkMode);
  registerServiceWorker();
  setupKeyboardShortcuts();

  const agreement = await loadAgreement();
  setState({
    agreementText: agreement.text,
    agreementStatus: agreement.status,
  });
}

function applyDarkMode(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('fw_dark', dark);
}

function toggleDarkMode() {
  const newMode = !state.darkMode;
  setState({ darkMode: newMode });
  applyDarkMode(newMode);
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {
      // Service worker registration failed silently
    }
  }
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    switch (e.key) {
      case '/':
        e.preventDefault();
        document.querySelector('[data-chat-input]')?.focus();
        break;
      case 'Escape':
        // Close any open modals
        document.dispatchEvent(new CustomEvent('vault:close-modals'));
        break;
      case 'd':
      case 'D':
        toggleDarkMode();
        break;
      case '1':
        setState({ view: 'dashboard', tab: 'dashboard' });
        break;
      case '2':
        setState({ view: 'dashboard', tab: 'chat' });
        break;
      case '?':
        document.dispatchEvent(new CustomEvent('vault:show-shortcuts'));
        break;
    }
  });
}

// Chat handler
async function handleChat(question, mode) {
  if (!question.trim()) return null;

  analytics.track('search', { query: question, mode });

  const hits = bestMatches(state.agreementText, question, 3);

  if (!hits.length) {
    return {
      role: 'ai',
      text: "I couldn't locate that in the agreement text. Try keywords like: cancellation, late fee, liability, arbitration, scope, snow, mowing.",
    };
  }

  if (mode === 'quick') {
    const best = hits[0];
    return {
      role: 'ai',
      text: `Here you go.\n\nSOURCE: ${best.heading}\n\n"${excerpt(best.text)}"\n\n(Informational only \u2014 the signed agreement controls.)`,
    };
  }

  // AI Explain mode
  analytics.track('ai_query', { query: question });

  try {
    const response = await fetch('/.netlify/functions/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        excerpts: hits.map((h) => ({
          heading: h.heading,
          text: excerpt(h.text, 1200),
        })),
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI unavailable');

    return { role: 'ai', text: data.answer };
  } catch {
    return {
      role: 'ai',
      text: 'AI Explain is unavailable right now. Use Quick mode or contact Freshwater support.',
    };
  }
}

export {
  state,
  setState,
  getState,
  subscribe,
  init,
  toggleDarkMode,
  handleChat,
};
