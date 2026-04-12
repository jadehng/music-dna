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

async function handleYouTube() {
  const url = youtubeUrl.value.trim();
  if (!url) return;

  const ytRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;
  const match = url.match(ytRegex);
  if (!match) { showToast('URL YouTube invalide'); return; }

  showLoading('Extraction audio YouTube...');

  try {
    const response = await fetch(`/.netlify/functions/youtube-audio?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur extraction YouTube');
    }

    setLoadingText('Decodage audio...');
    const arrayBuffer = await response.arrayBuffer();
    const title = response.headers.get('X-Video-Title') || `YouTube - ${match[1]}`;

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
