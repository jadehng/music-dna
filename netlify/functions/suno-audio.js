/**
 * Suno audio extraction — two-step process:
 * 1. Call studio-api-prod.suno.com/api/clip/{id} to get the audio_url (public, no auth)
 * 2. Download the MP3 from the CDN URL returned by the API
 */

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`API returned ${res.statusCode}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from API')); }
      });
    }).on('error', reject);
  });
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://suno.com/'
      }
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`CDN returned ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  // Extract clip UUID — supports both full URLs and short links
  let clipId;
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const uuidMatch = url.match(uuidPattern);

  if (uuidMatch) {
    clipId = uuidMatch[0];
  } else if (url.includes('suno.com/s/')) {
    // Short URL — resolve redirect to get UUID
    try {
      const redirectUrl = await new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.headers.location) {
            const locMatch = res.headers.location.match(uuidPattern);
            if (locMatch) return resolve(locMatch[0]);
          }
          reject(new Error('Could not resolve short URL'));
        }).on('error', reject);
      });
      clipId = redirectUrl;
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Could not resolve short Suno URL', hint: e.message })
      };
    }
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Invalid Suno URL',
        hint: 'Colle un lien comme https://suno.com/song/... ou https://suno.com/s/...'
      })
    };
  }

  try {
    // Step 1: Get clip metadata from public API
    const clipData = await fetchJSON(`https://studio-api-prod.suno.com/api/clip/${clipId}`);

    if (!clipData.audio_url) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No audio URL found',
          hint: 'Le morceau est peut-etre prive ou supprime.'
        })
      };
    }

    const title = clipData.title || `Suno - ${clipId.substring(0, 8)}`;
    const audioUrl = clipData.audio_url;

    // Step 2: Download the MP3 from CDN
    const buffer = await downloadBuffer(audioUrl);

    // Cap at 10MB
    const capped = buffer.length > 10 * 1024 * 1024
      ? buffer.slice(0, 10 * 1024 * 1024)
      : buffer;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Clip-Id': clipId,
        'X-Song-Title': encodeURIComponent(title),
        'X-Duration': String(clipData.metadata?.duration || 0),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Clip-Id, X-Song-Title, X-Duration'
      },
      body: capped.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Suno extraction error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Extraction failed: ' + error.message,
        hint: 'Verifie que le lien est correct et que le morceau est public.'
      })
    };
  }
};
