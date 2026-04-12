/**
 * Music DNA - Audio Analysis Engine v2
 * Uses Web Audio API + essentia.js WASM + TF.js ML models
 * for deep music analysis: BPM, key, mood, genre, danceability, energy, spectral
 */

class AudioAnalyzer {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.essentia = null;
    this.essentiaWASM = null;
    this.models = {};
    this.modelsLoaded = false;
  }

  async init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Init essentia.js WASM
    try {
      this.essentiaWASM = await EssentiaWASM();
      this.essentia = new this.essentiaWASM.EssentiaJS(false);
      this.essentia.arrayToVector = this.essentiaWASM.arrayToVector;
      console.log('Essentia WASM initialized, version:', this.essentia.version);
    } catch (e) {
      console.warn('Essentia WASM failed to load, using fallback analysis:', e);
      this.essentia = null;
    }

    // Load ML models in background (don't block init)
    this._loadModels();
  }

  async _loadModels() {
    const modelNames = ['mood_happy', 'mood_sad', 'mood_aggressive', 'mood_relaxed', 'danceability', 'genre_tzanetakis'];
    const loaded = [];

    for (const name of modelNames) {
      try {
        const modelUrl = `./models/${name}/model.json`;
        const model = new EssentiaModel.TensorflowMusiCNN(tf, modelUrl);
        await model.initialize();
        this.models[name] = model;
        loaded.push(name);
      } catch (e) {
        console.warn(`Failed to load model ${name}:`, e.message);
      }
    }

    this.modelsLoaded = loaded.length > 0;
    console.log(`ML models loaded: ${loaded.join(', ')}`);
  }

  async analyzeFile(file) {
    if (!this.audioContext) await this.init();
    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this._analyze();
  }

  async analyzeArrayBuffer(arrayBuffer, name) {
    if (!this.audioContext) await this.init();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this._analyze();
  }

  async _analyze() {
    const buffer = this.audioBuffer;
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // === DSP analysis (essentia.js or fallback) ===
    const bpmResult = this._detectBPM(channelData, sampleRate);
    const keyResult = this._detectKey(channelData, sampleRate);
    const energy = this._analyzeEnergy(channelData);
    const spectral = this._analyzeSpectrum(channelData, sampleRate);

    // === ML analysis (essentia.js + TF.js models) ===
    let mlMood = { happy: 0, sad: 0, aggressive: 0, relaxed: 0 };
    let mlDanceability = 50;
    let mlGenre = { primary: 'Unknown', scores: {} };

    if (this.modelsLoaded) {
      try {
        const mlResults = await this._runMLModels(channelData, sampleRate);
        mlMood = mlResults.mood;
        mlDanceability = mlResults.danceability;
        mlGenre = mlResults.genre;
      } catch (e) {
        console.warn('ML analysis failed, using DSP fallback:', e.message);
      }
    }

    // === Combine DSP + ML into rich characteristics ===
    const characteristics = this._buildCharacteristics(channelData, sampleRate, spectral, bpmResult, energy, mlMood, mlDanceability);
    const genres = this._buildGenreProfile(bpmResult.bpm, keyResult, energy, characteristics, spectral, mlGenre);
    const moodProfile = this._buildMoodProfile(mlMood, energy, spectral, characteristics);
    const duration = buffer.duration;

    return {
      bpm: bpmResult,
      key: keyResult,
      energy,
      spectral,
      characteristics,
      genres,
      moodProfile,
      mlMood,
      mlDanceability,
      mlGenre,
      duration,
      sampleRate,
      channelData
    };
  }

  // ═══════════════════════════════════════
  // ML MODEL INFERENCE
  // ═══════════════════════════════════════
  async _runMLModels(channelData, sampleRate) {
    // Downsample to 16kHz mono (required by essentia models)
    const audio16k = await this._downsampleTo16k(channelData, sampleRate);

    // Use only a portion for speed (15% of audio, centered)
    const keepRatio = 0.15;
    const keepLen = Math.floor(audio16k.length * keepRatio);
    const startOffset = Math.floor((audio16k.length - keepLen) / 2);
    const audioSlice = audio16k.slice(startOffset, startOffset + keepLen);

    // Extract MusiCNN features (mel spectrogram)
    let features;
    try {
      const extractor = new EssentiaModel.EssentiaTFInputExtractor(this.essentiaWASM, 'musicnn', false);
      features = extractor.computeFrameWise(audioSlice, 256);
      extractor.delete();
      extractor.shutdown();
    } catch (e) {
      console.warn('Feature extraction failed:', e);
      return { mood: { happy: 0, sad: 0, aggressive: 0, relaxed: 0 }, danceability: 50, genre: { primary: 'Unknown', scores: {} } };
    }

    // Run mood models
    const mood = { happy: 0, sad: 0, aggressive: 0, relaxed: 0 };

    // Model output indices: [positive_class, negative_class] — varies per model
    // mood_happy: idx 0 = happy
    // mood_sad: idx 1 = sad
    // mood_aggressive: idx 0 = aggressive
    // mood_relaxed: idx 1 = relaxed
    const moodModels = {
      mood_happy: { key: 'happy', positiveIdx: 0 },
      mood_sad: { key: 'sad', positiveIdx: 1 },
      mood_aggressive: { key: 'aggressive', positiveIdx: 0 },
      mood_relaxed: { key: 'relaxed', positiveIdx: 1 }
    };

    for (const [modelName, config] of Object.entries(moodModels)) {
      if (this.models[modelName]) {
        try {
          const preds = await this.models[modelName].predict(features, true);
          const avg = preds.reduce((s, p) => s + p[config.positiveIdx], 0) / preds.length;
          mood[config.key] = Math.round(avg * 100);
        } catch (e) {
          console.warn(`${modelName} prediction failed:`, e.message);
        }
      }
    }

    // Run danceability model
    let danceability = 50;
    if (this.models.danceability) {
      try {
        const preds = await this.models.danceability.predict(features, true);
        const avg = preds.reduce((s, p) => s + p[0], 0) / preds.length;
        danceability = Math.round(avg * 100);
      } catch (e) {
        console.warn('Danceability prediction failed:', e.message);
      }
    }

    // Run genre model
    const genreLabels = ['blues', 'classical', 'country', 'disco', 'hiphop', 'jazz', 'metal', 'pop', 'reggae', 'rock'];
    let genre = { primary: 'Unknown', scores: {} };
    if (this.models.genre_tzanetakis) {
      try {
        const preds = await this.models.genre_tzanetakis.predict(features, true);
        // Average predictions across batches
        const avgScores = new Array(genreLabels.length).fill(0);
        for (const pred of preds) {
          for (let i = 0; i < pred.length && i < genreLabels.length; i++) {
            avgScores[i] += pred[i] / preds.length;
          }
        }
        const scores = {};
        genreLabels.forEach((label, i) => scores[label] = Math.round(avgScores[i] * 100));
        const maxIdx = avgScores.indexOf(Math.max(...avgScores));
        genre = { primary: genreLabels[maxIdx], scores };
      } catch (e) {
        console.warn('Genre prediction failed:', e.message);
      }
    }

    return { mood, danceability, genre };
  }

  async _downsampleTo16k(channelData, originalSampleRate) {
    if (originalSampleRate === 16000) return channelData;

    const targetSampleRate = 16000;
    const duration = channelData.length / originalSampleRate;
    const offlineCtx = new OfflineAudioContext(1, Math.floor(duration * targetSampleRate), targetSampleRate);

    const sourceBuffer = offlineCtx.createBuffer(1, channelData.length, originalSampleRate);
    sourceBuffer.getChannelData(0).set(channelData);

    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offlineCtx.destination);
    source.start();

    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer.getChannelData(0);
  }

  // ═══════════════════════════════════════
  // MOOD PROFILE (combines ML + DSP)
  // ═══════════════════════════════════════
  _buildMoodProfile(mlMood, energy, spectral, chars) {
    // Pick dominant mood tag for Suno v5 [Mood: X]
    const moods = [
      { tag: 'Joyful', score: mlMood.happy },
      { tag: 'Melancholic', score: mlMood.sad },
      { tag: 'Intense', score: mlMood.aggressive },
      { tag: 'Chill But Focused', score: mlMood.relaxed },
      { tag: 'Haunting', score: Math.max(0, chars.darkness - 30) },
      { tag: 'Triumphant', score: Math.max(0, (energy.normalized - 60) * 1.5) },
      { tag: 'Introspective', score: Math.max(0, (100 - energy.normalized - 30) * 1.2) }
    ];

    moods.sort((a, b) => b.score - a.score);
    const primary = moods[0];
    const secondary = moods[1];

    // Energy tag for Suno v5 [Energy: X]
    let energyTag;
    if (energy.normalized > 75) energyTag = 'High';
    else if (energy.normalized > 55) energyTag = 'Medium-High';
    else if (energy.normalized > 35) energyTag = 'Medium';
    else if (energy.normalized > 20) energyTag = 'Low-Medium';
    else energyTag = 'Low';

    // Texture tag for Suno v5 [Texture: X]
    let textureTag = '';
    if (chars.darkness > 60 && spectral.subBass > 0.5) textureTag = 'Tape-Saturated';
    else if (chars.brightness > 60) textureTag = 'Lo-fi warmth';
    else if (energy.normalized < 40) textureTag = 'Vinyl Hiss';
    else if (chars.hypnotic > 60) textureTag = 'Gentle Sidechain';

    return {
      primary: primary.tag,
      primaryScore: primary.score,
      secondary: secondary.tag,
      secondaryScore: secondary.score,
      energyTag,
      textureTag,
      allMoods: moods
    };
  }

  // ═══════════════════════════════════════
  // DSP ANALYSIS (kept from v1 with improvements)
  // ═══════════════════════════════════════

  _detectBPM(channelData, sampleRate) {
    // Use essentia if available
    if (this.essentia) {
      try {
        const vector = this.essentia.arrayToVector(channelData);
        const result = this.essentia.PercivalBpmEstimator(vector, 1024, 2048, 128, 128, 210, 50, sampleRate);
        let bpm = Math.round(result.bpm);
        if (bpm < 80) bpm *= 2;
        if (bpm > 200) bpm = Math.round(bpm / 2);
        return { bpm, confidence: 85, range: this._getBPMRange(bpm) };
      } catch (e) {
        console.warn('Essentia BPM failed, using fallback:', e.message);
      }
    }

    // Fallback: autocorrelation
    return this._detectBPMFallback(channelData, sampleRate);
  }

  _detectBPMFallback(channelData, sampleRate) {
    const downsampleFactor = 4;
    const downsampled = new Float32Array(Math.floor(channelData.length / downsampleFactor));
    for (let i = 0; i < downsampled.length; i++) downsampled[i] = channelData[i * downsampleFactor];
    const dsSampleRate = sampleRate / downsampleFactor;

    const hopSize = Math.floor(dsSampleRate * 0.01);
    const frameSize = Math.floor(dsSampleRate * 0.02);
    const numFrames = Math.floor((downsampled.length - frameSize) / hopSize);
    const envelope = new Float32Array(numFrames);

    for (let i = 0; i < numFrames; i++) {
      let sum = 0;
      const start = i * hopSize;
      for (let j = 0; j < frameSize; j++) sum += downsampled[start + j] ** 2;
      envelope[i] = Math.sqrt(sum / frameSize);
    }

    const onset = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);

    const envelopeRate = dsSampleRate / hopSize;
    const minLag = Math.floor(envelopeRate * 60 / 200);
    const maxLag = Math.floor(envelopeRate * 60 / 70);
    const autocorr = new Float32Array(maxLag + 1);
    const analysisLen = Math.min(onset.length, Math.floor(envelopeRate * 30));

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, count = 0;
      for (let i = 0; i < analysisLen - lag; i++) { sum += onset[i] * onset[i + lag]; count++; }
      autocorr[lag] = count > 0 ? sum / count : 0;
    }

    let maxVal = 0, bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (autocorr[lag] > maxVal) { maxVal = autocorr[lag]; bestLag = lag; }
    }

    let bpm = Math.round((envelopeRate * 60) / bestLag);
    if (bpm < 80) bpm *= 2;
    if (bpm > 200) bpm = Math.round(bpm / 2);

    const avgCorr = autocorr.reduce((a, b) => a + b, 0) / (maxLag - minLag + 1);
    const confidence = avgCorr > 0 ? Math.min(100, Math.round((maxVal / avgCorr - 1) * 25)) : 50;

    return { bpm, confidence: Math.max(30, Math.min(98, confidence)), range: this._getBPMRange(bpm) };
  }

  _getBPMRange(bpm) {
    if (bpm < 100) return 'Downtempo / Midtempo';
    if (bpm < 120) return 'House lent / Deep';
    if (bpm < 128) return 'House / Tech House';
    if (bpm < 135) return 'Techno';
    if (bpm < 145) return 'Hard Techno';
    if (bpm < 160) return 'Fast Techno / Trance';
    return 'Hardcore / Gabber';
  }

  _detectKey(channelData, sampleRate) {
    // Use essentia if available
    if (this.essentia) {
      try {
        const vector = this.essentia.arrayToVector(channelData);
        const result = this.essentia.KeyExtractor(vector, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'bgate', sampleRate, 0.0001, 440, 'cosine', 'hann');
        const key = result.key;
        const scale = result.scale.charAt(0).toUpperCase() + result.scale.slice(1);
        const fullKey = `${key} ${scale}`;
        return { key, scale, fullKey, camelot: this._getCamelot(fullKey), chroma: [] };
      } catch (e) {
        console.warn('Essentia key detection failed, using fallback:', e.message);
      }
    }

    // Fallback: chromagram
    return this._detectKeyFallback(channelData, sampleRate);
  }

  _getCamelot(fullKey) {
    const camelotMap = {
      'C Major': '8B', 'G Major': '9B', 'D Major': '10B', 'A Major': '11B',
      'E Major': '12B', 'B Major': '1B', 'F# Major': '2B', 'Db Major': '3B',
      'Ab Major': '4B', 'Eb Major': '5B', 'Bb Major': '6B', 'F Major': '7B',
      'A Minor': '8A', 'E Minor': '9A', 'B Minor': '10A', 'F# Minor': '11A',
      'C# Minor': '12A', 'G# Minor': '1A', 'D# Minor': '2A', 'A# Minor': '3A',
      'F Minor': '4A', 'C Minor': '5A', 'G Minor': '6A', 'D Minor': '7A'
    };
    return camelotMap[fullKey] || '?';
  }

  _detectKeyFallback(channelData, sampleRate) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    const fftSize = 8192;
    const numSegments = Math.min(50, Math.floor(channelData.length / fftSize));
    const chroma = new Float32Array(12);

    for (let seg = 0; seg < numSegments; seg++) {
      const startIdx = Math.floor(seg * (channelData.length - fftSize) / numSegments);
      for (let note = 0; note < 12; note++) {
        for (let octave = 2; octave <= 6; octave++) {
          const freq = 440 * Math.pow(2, (note - 9 + (octave - 4) * 12) / 12);
          const binIndex = Math.round(freq * fftSize / sampleRate);
          if (binIndex < fftSize / 2) {
            let realSum = 0, imagSum = 0;
            const w = 2 * Math.PI * binIndex / fftSize;
            const len = Math.min(fftSize, channelData.length - startIdx);
            for (let i = 0; i < len; i++) {
              realSum += channelData[startIdx + i] * Math.cos(w * i);
              imagSum += channelData[startIdx + i] * Math.sin(w * i);
            }
            chroma[note] += Math.sqrt(realSum * realSum + imagSum * imagSum) / len;
          }
        }
      }
    }

    const maxChroma = Math.max(...chroma);
    if (maxChroma > 0) for (let i = 0; i < 12; i++) chroma[i] /= maxChroma;

    let bestKey = 0, bestCorr = -Infinity, bestScale = 'major';
    for (let key = 0; key < 12; key++) {
      let majorCorr = 0, minorCorr = 0;
      for (let i = 0; i < 12; i++) {
        const idx = (i + key) % 12;
        majorCorr += chroma[idx] * majorProfile[i];
        minorCorr += chroma[idx] * minorProfile[i];
      }
      if (majorCorr > bestCorr) { bestCorr = majorCorr; bestKey = key; bestScale = 'Major'; }
      if (minorCorr > bestCorr) { bestCorr = minorCorr; bestKey = key; bestScale = 'Minor'; }
    }

    const keyName = noteNames[bestKey];
    const fullKey = `${keyName} ${bestScale}`;
    return { key: keyName, scale: bestScale, fullKey, camelot: this._getCamelot(fullKey), chroma: Array.from(chroma) };
  }

  _analyzeEnergy(channelData) {
    let rmsSum = 0, peakVal = 0;
    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      rmsSum += channelData[i] * channelData[i];
      if (abs > peakVal) peakVal = abs;
    }
    const rms = Math.sqrt(rmsSum / channelData.length);
    const dbRMS = 20 * Math.log10(rms + 1e-10);
    const dbPeak = 20 * Math.log10(peakVal + 1e-10);
    const energyNorm = Math.max(0, Math.min(100, Math.round((dbRMS + 30) * 3.3)));

    let label;
    if (energyNorm < 30) label = 'Calme / Ambient';
    else if (energyNorm < 50) label = 'Moderee';
    else if (energyNorm < 70) label = 'Energique';
    else if (energyNorm < 85) label = 'Intense';
    else label = 'Tres intense';

    return { rms, dbRMS: Math.round(dbRMS * 10) / 10, dbPeak: Math.round(dbPeak * 10) / 10, normalized: energyNorm, label, dynamicRange: Math.round(dbPeak - dbRMS) };
  }

  _analyzeSpectrum(channelData, sampleRate) {
    const fftSize = 4096;
    const numBands = 64;
    const spectrum = new Float32Array(numBands);
    const numSegments = Math.min(100, Math.floor(channelData.length / fftSize));

    for (let seg = 0; seg < numSegments; seg++) {
      const startIdx = Math.floor(seg * (channelData.length - fftSize) / numSegments);
      for (let band = 0; band < numBands; band++) {
        const freqLow = (band / numBands) * (sampleRate / 2);
        const freqHigh = ((band + 1) / numBands) * (sampleRate / 2);
        const binLow = Math.floor(freqLow * fftSize / sampleRate);
        const binHigh = Math.ceil(freqHigh * fftSize / sampleRate);

        let bandEnergy = 0;
        for (let bin = binLow; bin <= Math.min(binHigh, fftSize / 2 - 1); bin++) {
          const w = 2 * Math.PI * bin / fftSize;
          let real = 0, imag = 0;
          const len = Math.min(fftSize, channelData.length - startIdx);
          const step = Math.max(1, Math.floor(len / 512));
          for (let i = 0; i < len; i += step) {
            real += channelData[startIdx + i] * Math.cos(w * i);
            imag += channelData[startIdx + i] * Math.sin(w * i);
          }
          bandEnergy += (real * real + imag * imag) / (len / step);
        }
        spectrum[band] += bandEnergy / numSegments;
      }
    }

    const maxSpec = Math.max(...spectrum);
    if (maxSpec > 0) for (let i = 0; i < numBands; i++) spectrum[i] /= maxSpec;

    return {
      bands: Array.from(spectrum),
      subBass: this._avgRange(spectrum, 0, 4),
      bass: this._avgRange(spectrum, 4, 10),
      mid: this._avgRange(spectrum, 10, 30),
      high: this._avgRange(spectrum, 30, 64)
    };
  }

  _avgRange(arr, start, end) {
    let sum = 0;
    for (let i = start; i < end && i < arr.length; i++) sum += arr[i];
    return sum / (end - start);
  }

  // ═══════════════════════════════════════
  // COMBINED CHARACTERISTICS (DSP + ML)
  // ═══════════════════════════════════════
  _buildCharacteristics(channelData, sampleRate, spectral, bpmResult, energy, mlMood, mlDanceability) {
    const bassRatio = (spectral.subBass + spectral.bass) / (spectral.mid + spectral.high + 0.01);

    // Use ML danceability if available, otherwise estimate
    const danceability = mlDanceability > 0 ? mlDanceability :
      Math.round(Math.min(100, ((bpmResult.bpm >= 115 && bpmResult.bpm <= 135 ? 50 : 30) + energy.normalized * 0.3 + bpmResult.confidence * 0.2)));

    // Darkness: blend ML mood (aggressive + sad) with spectral analysis
    const mlDarkness = (mlMood.aggressive * 0.5 + mlMood.sad * 0.3 + (100 - mlMood.happy) * 0.2);
    const dspDarkness = Math.min(100, bassRatio * 45 + 20);
    const darkness = Math.round(mlMood.aggressive > 0 ? mlDarkness * 0.6 + dspDarkness * 0.4 : dspDarkness);

    // Complexity from spectral flatness
    const bands = spectral.bands.filter(b => b > 0.01);
    const geoMean = Math.exp(bands.reduce((s, b) => s + Math.log(b), 0) / bands.length);
    const ariMean = bands.reduce((s, b) => s + b, 0) / bands.length;
    const flatness = ariMean > 0 ? geoMean / ariMean : 0;
    const complexity = Math.round(Math.min(100, flatness * 120 + 15));

    const bassWeight = Math.round(Math.min(100, (spectral.subBass + spectral.bass) * 100));
    const brightness = Math.round(Math.min(100, (spectral.mid + spectral.high * 1.5) * 80));

    // Hypnotic: blend ML relaxed with DSP regularity
    const mlHypnotic = mlMood.relaxed * 0.3;
    const dspHypnotic = bpmResult.confidence * 0.4 + (100 - complexity) * 0.3 + darkness * 0.3;
    const hypnotic = Math.round(mlMood.relaxed > 0 ? mlHypnotic * 0.4 + dspHypnotic * 0.6 : dspHypnotic);

    return { danceability, darkness, complexity, bassWeight, brightness, hypnotic };
  }

  _buildGenreProfile(bpm, keyResult, energy, chars, spectral, mlGenre) {
    const tags = [];
    const genres = [];

    // ML genre if available
    if (mlGenre.primary !== 'Unknown') {
      genres.push(mlGenre.primary.charAt(0).toUpperCase() + mlGenre.primary.slice(1));
    }

    // BPM-based electronic sub-genres
    if (bpm >= 85 && bpm <= 115) { genres.push('Midtempo Bass'); tags.push('midtempo'); }
    if (bpm >= 118 && bpm <= 125) { genres.push('Tech House'); tags.push('groovy'); }
    if (bpm >= 125 && bpm <= 138) { genres.push('Techno'); tags.push('driving'); }
    if (bpm >= 138 && bpm <= 150) { genres.push('Hard Techno'); tags.push('fast', 'intense'); }
    if (bpm >= 140 && bpm <= 150) genres.push('Trance');

    // ML genre scores for secondary tags
    if (mlGenre.scores) {
      const sortedGenres = Object.entries(mlGenre.scores)
        .filter(([_, score]) => score > 15)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      for (const [g, _] of sortedGenres) {
        const capitalized = g.charAt(0).toUpperCase() + g.slice(1);
        if (!genres.includes(capitalized)) genres.push(capitalized);
      }
    }

    // Character-based tags
    if (chars.darkness > 65) tags.push('dark', 'sombre');
    if (chars.darkness < 40) tags.push('bright', 'melodic');
    if (chars.hypnotic > 65) tags.push('hypnotic', 'repetitive');
    if (chars.bassWeight > 70) tags.push('heavy bass', 'sub-heavy');
    if (chars.complexity > 65) tags.push('complex', 'layered');
    if (chars.complexity < 35) tags.push('minimal');
    if (chars.danceability > 70) tags.push('danceable');
    if (energy.normalized > 75) tags.push('high energy', 'powerful');
    if (energy.normalized < 35) tags.push('atmospheric', 'ambient');
    if (keyResult.scale === 'Minor') tags.push('minor key');
    if (keyResult.scale === 'Major') tags.push('major key');
    if (spectral.subBass > 0.6) tags.push('deep sub-bass');
    if (spectral.high > 0.5) tags.push('crispy highs');

    return { primary: [...new Set(genres)].slice(0, 4), tags: [...new Set(tags)] };
  }

  // ═══════════════════════════════════════
  // SUNO v5 PROMPT GENERATION
  // ═══════════════════════════════════════

  generateSunoPrompt(analysis) {
    const { bpm, key, energy, characteristics, genres, moodProfile, mlMood, mlDanceability } = analysis;
    const parts = [];

    // GENRE (max 2 for v5)
    if (genres.primary.length > 0) {
      parts.push(genres.primary.slice(0, 2).join(', '));
    }

    // BPM + Key
    parts.push(`${bpm.bpm} BPM`);
    parts.push(key.fullKey);

    // MOOD from ML (much more precise than DSP-only)
    if (moodProfile) {
      parts.push(moodProfile.primary.toLowerCase());
      if (moodProfile.secondaryScore > 25) {
        parts.push(moodProfile.secondary.toLowerCase());
      }
    }

    // ENERGY descriptor
    if (energy.normalized > 75) parts.push('high energy, driving');
    else if (energy.normalized > 50) parts.push('moderate energy');
    else if (energy.normalized > 30) parts.push('chill');
    else parts.push('ambient, atmospheric');

    // CHARACTER (max 3 for v5 clarity)
    const descriptors = [];
    if (characteristics.bassWeight > 65) descriptors.push('heavy sub-bass');
    if (characteristics.brightness > 60) descriptors.push('crispy hi-hats');
    if (characteristics.complexity < 40) descriptors.push('minimal');
    if (characteristics.complexity > 65) descriptors.push('complex layers');
    if (characteristics.danceability > 70) descriptors.push('groovy');
    if (characteristics.hypnotic > 60 && characteristics.complexity < 50) descriptors.push('repetitive patterns');
    if (descriptors.length) parts.push(descriptors.slice(0, 3).join(', '));

    // PRODUCTION texture from mood analysis
    if (moodProfile?.textureTag) parts.push(moodProfile.textureTag.toLowerCase());
    if (characteristics.darkness > 55) parts.push('industrial textures');

    parts.push('clean mix');

    let result = parts.join(', ').replace(/,\s*,/g, ',').trim();

    if (result.length > 200) {
      const allParts = result.split(',').map(s => s.trim());
      let trimmed = '';
      for (const p of allParts) {
        if ((trimmed + ', ' + p).length > 200) break;
        trimmed = trimmed ? trimmed + ', ' + p : p;
      }
      result = trimmed;
    }

    return result;
  }

  generateSunoTips(analysis) {
    const tips = [];
    const { bpm, key, characteristics, genres, energy, moodProfile, mlMood, mlDanceability, mlGenre } = analysis;

    tips.push(`🎵 Suno v5: max 2 genres dans le Style Prompt (au-dela, resultats generiques)`);
    tips.push(`🎹 Tonalite "${key.fullKey}" — garde cette cle pour un mood coherent`);
    tips.push(`⏱ BPM ${bpm.bpm} — ajuste +/- 5 BPM pour varier sans changer le genre`);

    // ML-powered tips
    if (moodProfile) {
      tips.push(`🎭 Mood detecte: ${moodProfile.primary} (${moodProfile.primaryScore}%) → utilise [Mood: ${moodProfile.primary}] dans les Lyrics`);
      if (moodProfile.textureTag) {
        tips.push(`🎚 Texture suggeree: [Texture: ${moodProfile.textureTag}]`);
      }
      tips.push(`⚡ Energie: [Energy: ${moodProfile.energyTag}]`);
    }

    if (mlMood) {
      if (mlMood.aggressive > 40) tips.push('🔥 Mood agressif detecte: "dark, intense, driving" dans le Style');
      if (mlMood.relaxed > 40) tips.push('🌊 Mood relaxed detecte: "chill, atmospheric, smooth" dans le Style');
      if (mlMood.sad > 40) tips.push('💧 Mood melancolique detecte: [Mood: Somber] ou [Mood: Melancholic]');
      if (mlMood.happy > 40) tips.push('☀️ Mood joyeux detecte: [Mood: Joyful] ou [Mood: Uplifting]');
    }

    if (mlDanceability > 60) {
      tips.push(`💃 Danceability: ${mlDanceability}% — morceau tres dansant, garde le groove !`);
    }

    if (mlGenre?.primary && mlGenre.primary !== 'Unknown') {
      const top3 = Object.entries(mlGenre.scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([g, s]) => `${g} (${s}%)`);
      tips.push(`🎶 Genres ML: ${top3.join(', ')}`);
    }

    tips.push('📝 v5 prefere les prompts narratifs — decris une scene plutot que des tags !');
    tips.push('🔇 Pour instrumental: mets [Instrumental] en premiere ligne des Lyrics');
    tips.push('✂️ Regle: 2-3 instruments max par section pour un meilleur rendu');

    return tips;
  }
}

window.AudioAnalyzer = AudioAnalyzer;
