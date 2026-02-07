/**
 * Freshwater Vault - Analytics Module
 *
 * Client-side event tracking with local storage
 * and server-side sync.
 */

import { generateSessionId } from './utils.js';

const MAX_LOCAL_EVENTS = 500;

const analytics = {
  sessionId: null,

  /**
   * Initialize analytics session.
   */
  init() {
    this.sessionId =
      sessionStorage.getItem('fw_session') || generateSessionId();
    sessionStorage.setItem('fw_session', this.sessionId);
    this.track('page_view', { path: window.location.pathname });
  },

  /**
   * Track an analytics event.
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  track(event, data = {}) {
    const payload = {
      event,
      ...data,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    };

    // Store locally
    const stored = JSON.parse(localStorage.getItem('fw_analytics') || '[]');
    stored.push(payload);
    if (stored.length > MAX_LOCAL_EVENTS) {
      stored.splice(0, stored.length - MAX_LOCAL_EVENTS);
    }
    localStorage.setItem('fw_analytics', JSON.stringify(stored));

    // Sync to server (fire-and-forget)
    this._sync(payload);
  },

  /**
   * Sync event to serverless analytics function.
   * @param {Object} payload
   * @private
   */
  async _sync(payload) {
    try {
      await fetch('/.netlify/functions/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Silently fail - data is stored locally
    }
  },

  /**
   * Get local analytics summary.
   * @returns {Object}
   */
  getSummary() {
    const events = JSON.parse(localStorage.getItem('fw_analytics') || '[]');
    return {
      totalEvents: events.length,
      pageViews: events.filter((e) => e.event === 'page_view').length,
      searches: events.filter((e) => e.event === 'search').length,
      aiQueries: events.filter((e) => e.event === 'ai_query').length,
      uniqueSessions: new Set(events.map((e) => e.sessionId)).size,
      topSearches: this._getTopItems(
        events
          .filter((e) => e.event === 'search')
          .map((e) => e.query)
          .filter(Boolean),
        5
      ),
    };
  },

  /**
   * Get top items from an array by frequency.
   * @param {string[]} arr
   * @param {number} limit
   * @returns {Array<{term: string, count: number}>}
   * @private
   */
  _getTopItems(arr, limit = 5) {
    const counts = {};
    arr.forEach((item) => {
      if (item) counts[item] = (counts[item] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term, count]) => ({ term, count }));
  },

  /**
   * Clear all local analytics data.
   */
  clear() {
    localStorage.removeItem('fw_analytics');
  },
};

export { analytics };
