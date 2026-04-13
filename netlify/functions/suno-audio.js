/**
 * Suno audio extraction — downloads MP3 via CDN using curl.
 *
 * Key insight: Cloudflare blocks Node.js TLS fingerprint on Suno's CDN.
 * Must use curl subprocess (like youtube-audio.js uses yt-dlp).
 * Pattern: https://cdn1.suno.ai/{clipId}.mp3 with browser-like headers.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractSunoAudio(clipId) {
  const tmpFile = path.join(os.tmpdir(), `suno-${crypto.randomBytes(6).toString('hex')}.mp3`);

  // Try cdn1 first, then cdn2
  for (const cdn of ['cdn1.suno.ai', 'cdn2.suno.ai']) {
    const url = `https://${cdn}/${clipId}.mp3`;

    const cmd = [
      'curl',
      '--silent',
      '--location',
      '--max-redirs', '5',
      '--max-time', '20',
      '--fail',
      '--compressed',
      '--http2',
      '-H', `"User-Agent: ${UA}"`,
      '-H', '"Accept: audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.8"',
      '-H', '"Accept-Language: en-US,en;q=0.9"',
      '-H', '"Origin: https://suno.com"',
      '-H', '"Referer: https://suno.com/"',
      '-H', '"sec-ch-ua: \\"Google Chrome\\";v=\\"131\\", \\"Chromium\\";v=\\"131\\""',
      '-H', '"sec-ch-ua-mobile: ?0"',
      '-H', '"sec-ch-ua-platform: \\"Windows\\""',
      '-H', '"Sec-Fetch-Dest: empty"',
      '-H', '"Sec-Fetch-Mode: cors"',
      '-H', '"Sec-Fetch-Site: cross-site"',
      '-o', `"${tmpFile}"`,
      `"${url}"`
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: 25000 });

      if (fs.existsSync(tmpFile)) {
        const stat = fs.statSync(tmpFile);
        if (stat.size > 1000) {
          // Check it's actually audio, not XML error
          const head = fs.readFileSync(tmpFile, { encoding: null, flag: 'r' }).slice(0, 10);
          if (head[0] === 0x3C) {
            // XML error response, try next CDN
            fs.unlinkSync(tmpFile);
            continue;
          }
          return { buffer: fs.readFileSync(tmpFile), cdn };
        }
        fs.unlinkSync(tmpFile);
      }
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      continue;
    }
  }

  throw new Error('Audio not found on Suno CDN. Song may be private or deleted.');
}

exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  // Extract clip UUID from Suno URL
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = url.match(uuidPattern);

  if (!match) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Invalid Suno URL — could not find clip ID',
        hint: 'Colle un lien comme https://suno.com/song/da6d4a83-...'
      })
    };
  }

  const clipId = match[0];

  try {
    const { buffer } = await extractSunoAudio(clipId);

    // Cap at 10MB
    const capped = buffer.length > 10 * 1024 * 1024
      ? buffer.slice(0, 10 * 1024 * 1024)
      : buffer;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Clip-Id': clipId,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Clip-Id'
      },
      body: capped.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Suno extraction error:', error.message);
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: error.message,
        hint: 'Verifie que le lien est correct et que le morceau est public.'
      })
    };
  }
};
