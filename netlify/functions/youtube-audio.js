/**
 * YouTube audio extraction via yt-dlp (most reliable method).
 * Falls back to @distube/ytdl-core if yt-dlp is not available.
 *
 * yt-dlp is maintained actively and keeps up with YouTube's frequent API changes,
 * whereas ytdl-core is regularly broken by YouTube.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);

// Robust YouTube video-ID extraction. Accepts every common form: watch?v=,
// youtu.be/, /shorts/, /embed/, /live/, /v/, music.youtube.com, m.youtube.com,
// youtube-nocookie.com, bare 11-char IDs, and any query-param order.
function extractYouTubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1, 12);
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:embed|shorts|live|v|e)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

// Try to find yt-dlp in common install locations
function findYtDlp() {
  const candidates = [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp' // fallback to PATH
  ];
  for (const c of candidates) {
    if (c.startsWith('/')) {
      try { if (fs.existsSync(c)) return c; } catch (e) {}
    }
  }
  return 'yt-dlp';
}

async function extractWithYtDlp(url) {
  const ytdlp = findYtDlp();
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString('hex');
  const outFile = path.join(tmpDir, `music-dna-${id}.%(ext)s`);

  // Get title first
  let title = 'YouTube Track';
  try {
    const { stdout } = await execAsync(
      `"${ytdlp}" --get-title --no-warnings "${url}"`,
      { timeout: 20000 }
    );
    title = stdout.trim() || title;
  } catch (e) {
    // Ignore, keep default title
  }

  // Download the smallest audio-only format for fastest extraction.
  // We pick "worstaudio" because we only need enough signal for BPM/key/spectral analysis.
  // No trimming (--download-sections requires ffmpeg seeking which is slow).
  const cmd = `"${ytdlp}" -f "worstaudio[filesize<8M]/worstaudio/bestaudio[filesize<8M]" --no-warnings --no-playlist --no-check-certificate -o "${outFile}" "${url}"`;

  await execAsync(cmd, { timeout: 25000, maxBuffer: 50 * 1024 * 1024 });

  // Find the downloaded file (extension varies: .webm, .m4a, .mp3, .opus)
  const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`music-dna-${id}.`));
  if (files.length === 0) {
    throw new Error('yt-dlp downloaded no file');
  }

  const filePath = path.join(tmpDir, files[0]);
  const fullBuffer = fs.readFileSync(filePath);
  // Cap at 5MB — enough for ~30-60s of audio analysis, keeps the base64 response small
  const buffer = fullBuffer.length > 5 * 1024 * 1024
    ? fullBuffer.slice(0, 5 * 1024 * 1024)
    : fullBuffer;
  const ext = path.extname(filePath).slice(1);
  const mimeMap = {
    webm: 'audio/webm',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    opus: 'audio/ogg',
    ogg: 'audio/ogg'
  };
  const mimeType = mimeMap[ext] || 'audio/webm';

  // Cleanup
  try { fs.unlinkSync(filePath); } catch (e) {}

  return { buffer, title, mimeType };
}

exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  // Validate + normalize: accept all common YouTube URL forms (watch, youtu.be,
  // shorts, embed, live, /v/, music./m. subdomains, nocookie), not just watch?v=.
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid YouTube URL' })
    };
  }
  const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const { buffer, title, mimeType } = await extractWithYtDlp(normalizedUrl);

    // Safety cap: if file is huge, trim to first 10MB
    const capped = buffer.length > 10 * 1024 * 1024
      ? buffer.slice(0, 10 * 1024 * 1024)
      : buffer;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': mimeType,
        'X-Video-Title': encodeURIComponent(title),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Video-Title'
      },
      body: capped.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('yt-dlp extraction error:', error.message);
    console.error('stderr:', error.stderr);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Extraction failed: ' + (error.stderr || error.message).split('\n')[0],
        hint: 'Verifie que yt-dlp est installe (brew install yt-dlp). Sinon, telecharge le MP3 manuellement.'
      })
    };
  }
};
