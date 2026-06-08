/**
 * Usage stats endpoint — returns the number of distinct people who have
 * triggered a YouTube extraction (i.e. used the shared YouTube account).
 * Polled by a scheduled reminder so the owner knows when to remove the shared
 * cookies. Public but only exposes an aggregate count, never identities.
 */
const { getStats } = require('../usage.js');

exports.handler = async () => {
  const stats = await getStats();
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(stats)
  };
};
