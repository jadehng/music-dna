/**
 * Music DNA - Main Application
 * Handles UI, file upload, YouTube extraction, multi-track analysis
 * Main tabs: Pre-prod (analyze & prompt) / Post-prod (edit & export)
 */

const analyzer = new AudioAnalyzer();
const studio = new PromptStudio();
const editor = new AudioEditor();
let analysisResults = [];

// Init modules when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  studio.init();
  editor.init();
});

// ─── MAIN TABS: Pre-prod / Post-prod ───
document.querySelectorAll('.main-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.main-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`main-${tab.dataset.main}`).classList.remove('hidden');
  });
});

// ─── DOM Elements ───
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const youtubeUrl = document.getElementById('youtubeUrl');
const analyzeYtBtn = document.getElementById('analyzeYtBtn');
const loadingSection = document.getElementById('loadingSection');
const loadingText = document.getElementById('loadingText');
const resultsSection = document.getElementById('resultsSection');

// ─── Sub Tab Switching (upload/youtube) ───
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

// ─── File Upload ───
browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => {
  if (e.target !== browseBtn) fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length) handleFiles(files);
});

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
  if (files.length) handleFiles(files);
});

// ─── YouTube Handler ───
analyzeYtBtn.addEventListener('click', () => handleYouTube());
youtubeUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleYouTube(); });

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

async function handleYouTube() {
  const url = youtubeUrl.value.trim();
  if (!url) return;

  const videoId = extractYouTubeId(url);
  if (!videoId) { showToast('URL YouTube invalide'); return; }
  // Normalize to a canonical watch URL so the backend + yt-dlp always get a clean link.
  const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

  showLoading('Extraction audio YouTube...');

  try {
    const response = await fetch(`/.netlify/functions/youtube-audio?url=${encodeURIComponent(normalizedUrl)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur extraction YouTube');
    }

    setLoadingText('Decodage audio...');
    const arrayBuffer = await response.arrayBuffer();
    const title = response.headers.get('X-Video-Title') || `YouTube - ${videoId}`;

    setLoadingText('Analyse en cours...');
    const result = await analyzer.analyzeArrayBuffer(arrayBuffer, title);
    result.name = decodeURIComponent(title);
    analysisResults = [result];
    displayResults();
  } catch (error) {
    console.error('YouTube error:', error);
    hideLoading();
    showToast('Erreur: ' + error.message + ' - Essaie avec un fichier MP3');
  }
}

// ─── Suno Handler ───
const sunoUrlInput = document.getElementById('sunoUrl');
const analyzeSunoBtn = document.getElementById('analyzeSunoBtn');
const downloadSunoBtn = document.getElementById('downloadSunoBtn');
let lastSunoBlob = null;
let lastSunoTitle = '';

if (analyzeSunoBtn) {
  analyzeSunoBtn.addEventListener('click', () => handleSuno());
  sunoUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSuno(); });
}

async function handleSuno() {
  const url = sunoUrlInput.value.trim();
  if (!url) return;

  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = url.match(uuidRegex);
  if (!match) { showToast('URL Suno invalide — colle un lien suno.com/song/...'); return; }

  showLoading('Extraction audio Suno...');

  try {
    const response = await fetch(`/.netlify/functions/suno-audio?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur extraction Suno');
    }

    setLoadingText('Decodage audio...');
    const arrayBuffer = await response.arrayBuffer();
    const clipId = response.headers.get('X-Clip-Id') || match[0];
    const rawTitle = response.headers.get('X-Song-Title');
    const title = rawTitle ? decodeURIComponent(rawTitle) : `Suno - ${clipId.substring(0, 8)}`;

    // Store blob for download
    lastSunoBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    lastSunoTitle = title;
    if (downloadSunoBtn) downloadSunoBtn.style.display = 'inline-block';

    setLoadingText('Analyse en cours...');
    const result = await analyzer.analyzeArrayBuffer(arrayBuffer, title);
    result.name = title;
    analysisResults = [result];
    displayResults();
  } catch (error) {
    console.error('Suno error:', error);
    hideLoading();
    showToast('Erreur: ' + error.message);
  }
}

if (downloadSunoBtn) {
  downloadSunoBtn.addEventListener('click', () => {
    if (!lastSunoBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(lastSunoBlob);
    a.download = `${lastSunoTitle}.mp3`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ─── Multi-File Handler ───
async function handleFiles(files) {
  showLoading(`Analyse de ${files.length} fichier(s)...`);
  analysisResults = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setLoadingText(`Analyse: ${file.name} (${i + 1}/${files.length})`);
    try {
      const result = await analyzer.analyzeFile(file);
      result.name = file.name.replace(/\.[^.]+$/, '');
      result.file = file;
      analysisResults.push(result);
    } catch (err) {
      console.error(`Error analyzing ${file.name}:`, err);
      showToast(`Erreur avec ${file.name}`);
    }
  }

  if (analysisResults.length > 0) {
    displayResults();
  } else {
    hideLoading();
  }
}

// ─── Display Results ───
function displayResults() {
  hideLoading();
  resultsSection.classList.remove('hidden');

  if (analysisResults.length > 1) {
    displayMultiResults();
  } else {
    displaySingleResult(analysisResults[0]);
  }

  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function displaySingleResult(result) {
  const { bpm, key, energy, characteristics, genres, duration, channelData } = result;

  document.getElementById('trackName').textContent = result.name;

  if (result.file) {
    document.getElementById('audioPlayer').src = URL.createObjectURL(result.file);
  }

  document.getElementById('bpmValue').textContent = bpm.bpm;
  document.getElementById('bpmConfidence').textContent = `${bpm.confidence}% confiance - ${bpm.range}`;
  document.getElementById('keyValue').textContent = key.fullKey;
  document.getElementById('keyScale').textContent = `Camelot: ${key.camelot}`;
  document.getElementById('energyValue').textContent = `${energy.normalized}%`;
  document.getElementById('energyLabel').textContent = energy.label;
  document.getElementById('durationValue').textContent = formatDuration(duration);
  document.getElementById('durationSub').textContent = `${Math.round(duration)}s`;

  setBar('dance', characteristics.danceability);
  setBar('dark', characteristics.darkness);
  setBar('complex', characteristics.complexity);
  setBar('bass', characteristics.bassWeight);
  setBar('bright', characteristics.brightness);
  setBar('hypno', characteristics.hypnotic);

  drawWaveform(channelData);
  drawSpectrum(result.spectral.bands);

  // Genre tags
  const tagsContainer = document.getElementById('genreTags');
  tagsContainer.innerHTML = '';
  genres.primary.forEach(g => { tagsContainer.innerHTML += `<span class="tag">${g}</span>`; });
  genres.tags.forEach(t => { tagsContainer.innerHTML += `<span class="tag secondary">${t}</span>`; });

  // Suno prompt
  const prompt = analyzer.generateSunoPrompt(result);
  document.getElementById('sunoPrompt').textContent = prompt;

  const tips = analyzer.generateSunoTips(result);
  document.getElementById('sunoTips').innerHTML = tips.map(t => `<li>${t}</li>`).join('');

  document.getElementById('copyPromptBtn').onclick = () => {
    navigator.clipboard.writeText(prompt);
    showToast('Prompt copie !');
  };

  document.getElementById('regenerateBtn').onclick = () => {
    document.getElementById('sunoPrompt').textContent = analyzer.generateSunoPrompt(result);
  };

  // Feed to Prompt Studio
  studio.setAnalysisData(result);

  // ── Phase 3: Stem analysis button (optional, on demand)
  _wireLayerAnalysis(result);
}

// ═══════════════════════════════════════════════════════
// STEM PLAYER — OfflineAudioContext pre-rendering
//
// Each stem is isolated by rendering the source AudioBuffer
// through N cascaded BiquadFilters in an OfflineAudioContext
// (faster than real-time, no CPU budget on playback).
//
// Cascading N identical filters multiplies the rolloff:
//   1 stage = 12 dB/oct  →  6 stages = 72 dB/oct (≈ brick wall)
//
// Rendered buffers are cached per-stem so the first click
// takes ~1-2 s (render) and subsequent clicks are instant.
// Cache is cleared whenever a new track is loaded.
// ═══════════════════════════════════════════════════════
const StemPlayer = {
  ctx: null,          // AudioContext for playback
  sourceNode: null,   // current playing source
  activeStemId: null,
  cache: {},          // stemId → rendered AudioBuffer

  // Per-stem filter specs.
  // loCut = highpass cutoff (Hz), hiCut = lowpass cutoff (Hz)
  // stages = how many identical filters to cascade on EACH side
  // gain   = makeup gain after filtering (bandpass attenuates level)
  BANDS: {
    kick_sub:    { loCut: null, hiCut: 150,   stages: 6, gain: 5.0 },
    bass_line:   { loCut: 80,  hiCut: 400,   stages: 6, gain: 4.5 },
    pads_chords: { loCut: 300, hiCut: 3500,  stages: 5, gain: 3.5 },
    lead_melody: { loCut: 1500,hiCut: 10000, stages: 5, gain: 4.0 },
    hihats_air:  { loCut: 6000,hiCut: null,  stages: 6, gain: 6.0 },
  },

  // ── Offline render of a single stem ──────────────────
  async renderStem(stemId) {
    if (this.cache[stemId]) return this.cache[stemId];

    const src = analyzer.audioBuffer;
    if (!src) throw new Error('No audioBuffer on analyzer');

    const cfg    = this.BANDS[stemId];
    const ch     = src.numberOfChannels;
    const len    = src.length;
    const rate   = src.sampleRate;

    const offCtx = new OfflineAudioContext(ch, len, rate);

    // Source node
    const srcNode = offCtx.createBufferSource();
    srcNode.buffer = src;

    // Build filter chain: all LP stages first, then all HP stages.
    // This order minimises numerical instability.
    const nodes = [srcNode];

    if (cfg.hiCut) {
      for (let i = 0; i < cfg.stages; i++) {
        const f = offCtx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cfg.hiCut;
        f.Q.value = 0.707; // Butterworth — maximally flat passband
        nodes.push(f);
      }
    }
    if (cfg.loCut) {
      for (let i = 0; i < cfg.stages; i++) {
        const f = offCtx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = cfg.loCut;
        f.Q.value = 0.707;
        nodes.push(f);
      }
    }

    // Makeup gain
    const gainNode = offCtx.createGain();
    gainNode.gain.value = cfg.gain;
    nodes.push(gainNode);
    nodes.push(offCtx.destination);

    // Wire chain
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i].connect(nodes[i + 1]);
    }

    srcNode.start();
    const rendered = await offCtx.startRendering();
    this.cache[stemId] = rendered;
    return rendered;
  },

  // ── Play a stem (renders on first call, instant on repeat) ──
  async play(stemId, onStart, onEnd) {
    this.stop();

    // AudioContext for playback — created on first user gesture
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const buffer = await this.renderStem(stemId);

    // In case stop() was called while we were rendering
    if (this.activeStemId !== null && this.activeStemId !== stemId) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    source.onended = () => {
      if (this.activeStemId === stemId) {
        this.activeStemId = null;
        this.sourceNode = null;
      }
      if (onEnd) onEnd();
    };

    source.start();
    this.sourceNode = source;
    this.activeStemId = stemId;
    if (onStart) onStart();
  },

  stop() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (e) {}
      this.sourceNode = null;
    }
    this.activeStemId = null;
  },

  isPlaying(stemId) { return this.activeStemId === stemId; },

  // Call when a new track is loaded — clears rendered buffers
  reset() {
    this.stop();
    this.cache = {};
  },
};

/**
 * Wire up the "Analyser les couches" button for a given analysis result.
 * Creates a fresh handler each time a track is loaded.
 */
function _wireLayerAnalysis(result) {
  const btn = document.getElementById('analyzeLayersBtn');
  const stemResults = document.getElementById('stemResults');
  const stemGrid = document.getElementById('stemGrid');
  if (!btn || !stemResults || !stemGrid) return;

  // Reset: hide results, stop any playback, clear grid
  StemPlayer.reset();
  stemResults.classList.add('hidden');
  stemGrid.innerHTML = '';
  btn.disabled = false;
  btn.innerHTML = '<span>🔬</span> Analyser les couches';

  btn.onclick = () => {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Analyse en cours…';

    setTimeout(() => {
      try {
        const stems = analyzer.generateStemAnalysis(result);
        stemGrid.innerHTML = stems.map(stem => _renderStemCard(stem)).join('');

        // Wire copy buttons
        stemGrid.querySelectorAll('[data-copy-stem]').forEach(copyBtn => {
          copyBtn.addEventListener('click', () => {
            const stemId = copyBtn.dataset.copyStem;
            const target = stems.find(s => s.id === stemId);
            if (!target) return;
            navigator.clipboard.writeText(target.prompt).then(() => {
              copyBtn.textContent = '✓ Copie !';
              setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000);
            });
          });
        });

        // Wire play buttons (async — first click renders offline, subsequent instant)
        stemGrid.querySelectorAll('[data-play-stem]').forEach(playBtn => {
          playBtn.addEventListener('click', async () => {
            const stemId = playBtn.dataset.playStem;

            if (StemPlayer.isPlaying(stemId)) {
              // Toggle off — stop playback
              StemPlayer.stop();
              _resetAllPlayBtns(stemGrid);
              return;
            }

            // Stop whatever was playing, reset all buttons
            StemPlayer.stop();
            _resetAllPlayBtns(stemGrid);

            // Show loading state if not yet cached
            const isCached = !!StemPlayer.cache[stemId];
            if (!isCached) {
              playBtn.innerHTML = '⏳ Rendu…';
              playBtn.disabled = true;
            }

            try {
              await StemPlayer.play(
                stemId,
                // onStart — called once buffer is ready and playing
                () => {
                  playBtn.innerHTML = '⏹ Stop';
                  playBtn.classList.add('playing');
                  playBtn.disabled = false;
                },
                // onEnd — natural end of track
                () => {
                  playBtn.innerHTML = '▶ Écouter';
                  playBtn.classList.remove('playing');
                  playBtn.disabled = false;
                }
              );
            } catch (err) {
              console.error('Stem render/play error:', err);
              playBtn.innerHTML = '▶ Écouter';
              playBtn.disabled = false;
              showToast('Erreur lecture couche');
            }
          });
        });

        stemResults.classList.remove('hidden');
        btn.innerHTML = '<span>✓</span> Couches analysées';
      } catch (err) {
        console.error('Stem analysis error:', err);
        btn.disabled = false;
        btn.innerHTML = '<span>🔬</span> Analyser les couches';
        showToast('Erreur analyse couches');
      }
    }, 50);
  };
}

function _resetAllPlayBtns(container) {
  container.querySelectorAll('[data-play-stem]').forEach(b => {
    b.innerHTML = '▶ Écouter';
    b.classList.remove('playing');
  });
}

/**
 * Render a single stem card as an HTML string.
 */
function _renderStemCard(stem) {
  const presenceClass = {
    'Strong':  'stem-presence--strong',
    'Present': 'stem-presence--present',
    'Subtle':  'stem-presence--subtle',
  }[stem.presence] || '';

  const energyColor = stem.energy > 60 ? '#8b5cf6' : stem.energy > 30 ? '#06b6d4' : '#6b7280';

  return `
    <div class="stem-card">
      <div class="stem-card-header">
        <span class="stem-icon">${stem.icon}</span>
        <div class="stem-card-title">
          <strong>${stem.name}</strong>
          <span class="stem-presence ${presenceClass}">${stem.presence}</span>
        </div>
      </div>

      <div class="stem-energy-wrap">
        <div class="stem-energy-bar">
          <div class="stem-energy-fill" style="width:${stem.energy}%;background:${energyColor};"></div>
        </div>
        <span class="stem-energy-label">${stem.energy}%</span>
      </div>

      <div class="stem-tags">
        ${stem.tags.map(t => `<span class="stem-tag">${t}</span>`).join('')}
      </div>

      <div class="stem-prompt-box">
        <div class="stem-prompt-text">${stem.prompt}</div>
      </div>

      <div class="stem-card-actions">
        <button class="btn btn-outline stem-play-btn" data-play-stem="${stem.id}">▶ Écouter</button>
        <button class="btn btn-outline stem-copy-btn" data-copy-stem="${stem.id}">Copier</button>
      </div>
    </div>
  `;
}

function displayMultiResults() {
  displaySingleResult(analysisResults[0]);
  document.getElementById('trackName').textContent = `${analysisResults.length} morceaux analyses`;

  const combined = generateCombinedPrompt();
  document.getElementById('sunoPrompt').textContent = combined;

  document.getElementById('copyPromptBtn').onclick = () => {
    navigator.clipboard.writeText(combined);
    showToast('Prompt combine copie !');
  };

  addTrackSelector();
}

function addTrackSelector() {
  const existing = document.getElementById('trackSelector');
  if (existing) existing.remove();

  const selector = document.createElement('div');
  selector.id = 'trackSelector';
  selector.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;';

  analysisResults.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = `btn ${i === 0 ? 'btn-primary' : 'btn-outline'}`;
    btn.textContent = r.name;
    btn.style.fontSize = '0.82rem';
    btn.onclick = () => {
      displaySingleResult(r);
      selector.querySelectorAll('button').forEach(b => b.className = 'btn btn-outline');
      btn.className = 'btn btn-primary';
      document.getElementById('sunoPrompt').textContent = generateCombinedPrompt();
    };
    selector.appendChild(btn);
  });

  document.querySelector('.section-title').after(selector);
}

function generateCombinedPrompt() {
  if (analysisResults.length === 1) return analyzer.generateSunoPrompt(analysisResults[0]);

  const avgBPM = Math.round(analysisResults.reduce((s, r) => s + r.bpm.bpm, 0) / analysisResults.length);
  const avgChars = {};
  ['danceability', 'darkness', 'complexity', 'bassWeight', 'brightness', 'hypnotic'].forEach(c => {
    avgChars[c] = Math.round(analysisResults.reduce((s, r) => s + r.characteristics[c], 0) / analysisResults.length);
  });
  const avgEnergy = Math.round(analysisResults.reduce((s, r) => s + r.energy.normalized, 0) / analysisResults.length);
  const allGenres = [...new Set(analysisResults.flatMap(r => r.genres.primary))];
  const keys = analysisResults.map(r => r.key.fullKey);
  const keyMode = keys.sort((a, b) => keys.filter(v => v === a).length - keys.filter(v => v === b).length).pop();

  const parts = [];
  const scene = getScene(avgChars, avgEnergy, avgBPM);
  if (scene) parts.push(scene);
  if (allGenres.length) parts.push(allGenres.slice(0, 2).join(', '));
  parts.push(`${avgBPM} BPM`, keyMode);

  const moods = [];
  if (avgChars.darkness > 55) moods.push('dark');
  if (avgChars.hypnotic > 55) moods.push('hypnotic');
  if (avgChars.danceability > 65) moods.push('groovy');
  if (avgEnergy > 70) moods.push('high energy');
  else if (avgEnergy > 45) moods.push('moderate energy');
  else moods.push('atmospheric');
  if (moods.length) parts.push(moods.join(', '));

  const prod = [];
  if (avgChars.bassWeight > 60) prod.push('heavy sub-bass');
  if (avgChars.brightness > 55) prod.push('crispy percussion');
  if (avgChars.complexity < 40) prod.push('minimal arrangement');
  if (prod.length) parts.push(prod.join(', '));

  parts.push('with builds and drops');
  return parts.join(', ');
}

function getScene(chars, energy, bpm) {
  if (chars.darkness > 65 && energy > 65) return 'Underground warehouse rave';
  if (chars.darkness > 60 && chars.hypnotic > 60) return 'Dark underground club';
  if (chars.hypnotic > 65 && bpm > 125) return 'Late night techno set';
  if (energy > 75 && bpm > 130) return 'Peak time festival stage';
  if (chars.darkness > 55 && bpm < 115) return 'Dark basement session';
  if (energy < 40) return 'After-hours ambient session';
  if (chars.danceability > 70) return 'Club dance floor';
  return 'Electronic music session';
}

// ─── Visualization ───
function drawWaveform(channelData) {
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const step = Math.ceil(channelData.length / width);
  const amp = height / 2;

  for (let i = 0; i < width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = channelData[(i * step) + j] || 0;
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctx.fillStyle = `rgba(139, 92, 246, ${0.4 + Math.abs(max - min) * 0.6})`;
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }
}

function drawSpectrum(bands) {
  const canvas = document.getElementById('spectrumCanvas');
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const barWidth = width / bands.length;
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, '#8b5cf6');
  gradient.addColorStop(0.5, '#06b6d4');
  gradient.addColorStop(1, '#f43f5e');

  bands.forEach((val, i) => {
    ctx.fillStyle = gradient;
    ctx.fillRect(i * barWidth + 1, height - val * height * 0.9, barWidth - 2, val * height * 0.9);
  });

  ctx.fillStyle = '#7a7a8e';
  ctx.font = '10px "Space Grotesk"';
  ctx.fillText('Sub', 5, height - 5);
  ctx.fillText('Bass', width * 0.15, height - 5);
  ctx.fillText('Mid', width * 0.4, height - 5);
  ctx.fillText('High', width * 0.7, height - 5);
}

// ─── Helpers ───
function setBar(id, value) {
  const bar = document.getElementById(`${id}Bar`);
  const val = document.getElementById(`${id}Value`);
  if (bar) bar.style.width = `${value}%`;
  if (val) val.textContent = `${value}%`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showLoading(text) {
  loadingSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  loadingText.textContent = text;
}

function setLoadingText(text) { loadingText.textContent = text; }
function hideLoading() { loadingSection.classList.add('hidden'); }

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
