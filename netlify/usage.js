/**
 * Lightweight unique-user tracking via Netlify Blobs.
 *
 * Purpose: the YouTube extractor uses a single shared Google account's cookies
 * (YOUTUBE_COOKIES) for every visitor. That's acceptable at tiny scale but risks
 * rate-limiting / flagging of the account as traffic grows. We count distinct
 * people who actually trigger an extraction (the ones using the shared account)
 * so a scheduled reminder can alert the owner to remove the shared cookies once
 * usage crosses USER_THRESHOLD.
 *
 * Privacy: we never store raw IPs — only a salted SHA-256 prefix, enough to
 * dedupe but not to identify.
 */

const crypto = require('crypto');

const STORE_NAME = 'usage';
const KEY = 'unique-users';
const USER_THRESHOLD = 3;

function getStore() {
  // Lazy require so a missing module never breaks extraction.
  const { getStore } = require('@netlify/blobs');
  return getStore(STORE_NAME);
}

function hashIp(ip) {
  const salt = process.env.USAGE_SALT || 'music-dna';
  return crypto.createHash('sha256').update(salt + ':' + ip).digest('hex').slice(0, 16);
}

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';
}

// Record a visitor; best-effort, never throws. Returns the updated unique count
// (or null if tracking is unavailable).
async function recordUser(event) {
  try {
    const store = getStore();
    const id = hashIp(clientIp(event));
    const existing = (await store.get(KEY, { type: 'json' })) || { ids: [] };
    if (!existing.ids.includes(id)) {
      existing.ids.push(id);
      await store.setJSON(KEY, existing);
    }
    return existing.ids.length;
  } catch (e) {
    console.warn('usage tracking unavailable:', e.message);
    return null;
  }
}

// Read current stats without mutating.
async function getStats() {
  try {
    const store = getStore();
    const existing = (await store.get(KEY, { type: 'json' })) || { ids: [] };
    const uniqueUsers = existing.ids.length;
    return { uniqueUsers, threshold: USER_THRESHOLD, exceeded: uniqueUsers > USER_THRESHOLD };
  } catch (e) {
    return { uniqueUsers: 0, threshold: USER_THRESHOLD, exceeded: false, error: e.message };
  }
}

module.exports = { recordUser, getStats, USER_THRESHOLD };
