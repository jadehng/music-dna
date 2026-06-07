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

// Pure-JS fallback extractor (no binary needed) — used on Netlify Lambda where
// yt-dlp isn't installed. Lazy-required so a missing module never breaks yt-dlp path.
let ytdl = null;
function getYtdl() {
  if (ytdl === null) {
    try { ytdl = require('@distube/ytdl-core'); } catch (e) { ytdl = false; }
  }
  return ytdl;
}

// Build an authenticated agent from cookies stored in the YOUTUBE_COOKIES env var.
// YouTube blocks datacenter IPs (Netlify/AWS) with "Sign in to confirm you're not
// a bot"; presenting a logged-in account's cookies makes requests look authenticated
// and defeats that check. The env var holds the JSON array exported by a browser
// cookie extension (e.g. "EditThisCookie" / "Get cookies.txt" → JSON). Cached across
// warm invocations. Returns null if not configured (callers then run cookie-less).
let cachedAgent;
function getAgent(lib) {
  if (cachedAgent !== undefined) return cachedAgent;
  cachedAgent = null;
  const raw = process.env.YOUTUBE_COOKIES;
  if (raw && typeof lib.createAgent === 'function') {
    try {
      const cookies = JSON.parse(raw);
      if (Array.isArray(cookies) && cookies.length) {
        cachedAgent = lib.createAgent(cookies);
      }
    } catch (e) {
      console.warn('YOUTUBE_COOKIES is set but not valid JSON cookie array:', e.message);
    }
  }
  return cachedAgent;
}

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

// Fallback extraction with @distube/ytdl-core (pure JS, works in serverless).
// Streams the lowest audio-only format and caps the buffer at 5MB — enough for
// BPM/key/spectral analysis. No ffmpeg / binary required.
async function extractWithYtdlCore(url) {
  const lib = getYtdl();
  if (!lib) throw new Error('ytdl-core not available');

  const agent = getAgent(lib);
  const reqOpts = agent ? { agent } : {};

  const info = await lib.getInfo(url, reqOpts);
  const title = (info.videoDetails && info.videoDetails.title) || 'YouTube Track';
  const format = lib.chooseFormat(info.formats, { quality: 'lowestaudio', filter: 'audioonly' });
  const container = (format && format.container) || 'webm';
  const mimeMap = { webm: 'audio/webm', m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', opus: 'audio/ogg', ogg: 'audio/ogg' };
  const mimeType = mimeMap[container] || 'audio/webm';

  const CAP = 5 * 1024 * 1024;
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } };
    const stream = lib.downloadFromInfo(info, { format, highWaterMark: 1 << 20, ...reqOpts });
    stream.on('data', (c) => {
      if (done) return;
      chunks.push(c);
      size += c.length;
      if (size >= CAP) { try { stream.destroy(); } catch (e) {} finish(); }
    });
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });

  const out = buffer.length > CAP ? buffer.slice(0, CAP) : buffer;
  return { buffer: out, title, mimeType };
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
    // Prefer yt-dlp (best reliability, used in local `netlify dev` on Mac).
    // On Netlify's Lambda yt-dlp isn't installed ("command not found"), so fall
    // back to the pure-JS @distube/ytdl-core path.
    let extracted;
    try {
      extracted = await extractWithYtDlp(normalizedUrl);
    } catch (ytDlpErr) {
      console.warn('yt-dlp unavailable/failed, falling back to ytdl-core:', ytDlpErr.message);
      extracted = await extractWithYtdlCore(normalizedUrl);
    }
    const { buffer, title, mimeType } = extracted;

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
    console.error('YouTube extraction error:', error.message);
    if (error.stderr) console.error('stderr:', error.stderr);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Extraction failed: ' + (error.stderr || error.message || '').split('\n')[0],
        hint: /sign in|not a bot|confirm/i.test(error.message || '')
          ? 'YouTube demande une connexion (anti-bot). Configure les cookies YOUTUBE_COOKIES sur Netlify, ou télécharge le MP3 et utilise l\'upload de fichier.'
          : 'YouTube bloque parfois les serveurs (datacenter). Réessaie, ou télécharge le MP3 et utilise l\'upload de fichier.'
      })
    };
  }
};
