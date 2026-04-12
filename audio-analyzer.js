/**
 * Music DNA - Audio Analysis Engine
 * Uses Web Audio API for BPM, key, energy, spectral analysis
 */

class AudioAnalyzer {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
  }

  async init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
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

  _analyze() {
    const buffer = this.audioBuffer;
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const bpmResult = this._detectBPM(channelData, sampleRate);
    const keyResult = this._detectKey(channelData, sampleRate);
    const energy = this._analyzeEnergy(channelData);
    const spectral = this._analyzeSpectrum(channelData, sampleRate);
    const characteristics = this._analyzeCharacteristics(channelData, sampleRate, spectral, bpmResult, energy);
    const genres = this._detectGenre(bpmResult.bpm, keyResult, energy, characteristics, spectral);
    const duration = buffer.duration;

    return {
      bpm: bpmResult,
      key: keyResult,
      energy,
      spectral,
      characteristics,
      genres,
      duration,
      sampleRate,
      channelData
    };
  }

  // ─── BPM Detection (Onset + Autocorrelation) ───
  _detectBPM(channelData, sampleRate) {
    // Downsample for performance
    const downsampleFactor = 4;
    const downsampled = new Float32Array(Math.floor(channelData.length / downsampleFactor));
    for (let i = 0; i < downsampled.length; i++) {
      downsampled[i] = channelData[i * downsampleFactor];
    }
    const dsSampleRate = sampleRate / downsampleFactor;

    // Low-pass energy envelope
    const hopSize = Math.floor(dsSampleRate * 0.01); // 10ms hops
    const frameSize = Math.floor(dsSampleRate * 0.02); // 20ms frames
    const numFrames = Math.floor((downsampled.length - frameSize) / hopSize);
    const envelope = new Float32Array(numFrames);

    for (let i = 0; i < numFrames; i++) {
      let sum = 0;
      const start = i * hopSize;
      for (let j = 0; j < frameSize; j++) {
        sum += downsampled[start + j] ** 2;
      }
      envelope[i] = Math.sqrt(sum / frameSize);
    }

    // Onset detection (spectral flux approximation via envelope diff)
    const onset = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) {
      onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
    }

    // Autocorrelation on onset signal
    const envelopeRate = dsSampleRate / hopSize;
    const minBPM = 70;
    const maxBPM = 200;
    const minLag = Math.floor(envelopeRate * 60 / maxBPM);
    const maxLag = Math.floor(envelopeRate * 60 / minBPM);
    const autocorr = new Float32Array(maxLag + 1);

    const analysisLen = Math.min(onset.length, Math.floor(envelopeRate * 30)); // max 30s

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < analysisLen - lag; i++) {
        sum += onset[i] * onset[i + lag];
        count++;
      }
      autocorr[lag] = count > 0 ? sum / count : 0;
    }

    // Find peak
    let maxVal = 0;
    let bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (autocorr[lag] > maxVal) {
        maxVal = autocorr[lag];
        bestLag = lag;
      }
    }

    let bpm = Math.round((envelopeRate * 60) / bestLag);

    // Check for half/double time
    const halfLag = bestLag * 2;
    const doubleLag = Math.floor(bestLag / 2);

    if (doubleLag >= minLag && autocorr[doubleLag] > maxVal * 0.85) {
      const doubleBpm = Math.round((envelopeRate * 60) / doubleLag);
      if (doubleBpm >= 115 && doubleBpm <= 160) {
        bpm = doubleBpm;
      }
    }

    // Normalize BPM to common range
    if (bpm < 80) bpm *= 2;
    if (bpm > 200) bpm = Math.round(bpm / 2);

    // Confidence based on autocorrelation peak strength
    const avgCorr = autocorr.reduce((a, b) => a + b, 0) / (maxLag - minLag + 1);
    const confidence = avgCorr > 0 ? Math.min(100, Math.round((maxVal / avgCorr - 1) * 25)) : 50;

    return {
      bpm,
      confidence: Math.max(30, Math.min(98, confidence)),
      range: this._getBPMRange(bpm)
    };
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

  // ─── Key Detection (Chromagram) ───
  _detectKey(channelData, sampleRate) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Krumhansl-Kessler profiles
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    // Compute chromagram using FFT
    const fftSize = 8192;
    const numSegments = Math.min(50, Math.floor(channelData.length / fftSize));
    const chroma = new Float32Array(12);

    const offlineCtx = new OfflineAudioContext(1, fftSize, sampleRate);

    for (let seg = 0; seg < numSegments; seg++) {
      const startIdx = Math.floor(seg * (channelData.length - fftSize) / numSegments);

      // Simple DFT for chroma bins
      for (let note = 0; note < 12; note++) {
        for (let octave = 2; octave <= 6; octave++) {
          const freq = 440 * Math.pow(2, (note - 9 + (octave - 4) * 12) / 12);
          const binIndex = Math.round(freq * fftSize / sampleRate);

          if (binIndex < fftSize / 2) {
            // Goertzel-like magnitude estimation
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

    // Normalize chroma
    const maxChroma = Math.max(...chroma);
    if (maxChroma > 0) {
      for (let i = 0; i < 12; i++) chroma[i] /= maxChroma;
    }

    // Correlate with key profiles
    let bestKey = 0, bestCorr = -Infinity, bestScale = 'major';

    for (let key = 0; key < 12; key++) {
      let majorCorr = 0, minorCorr = 0;
      for (let i = 0; i < 12; i++) {
        const idx = (i + key) % 12;
        majorCorr += chroma[idx] * majorProfile[i];
        minorCorr += chroma[idx] * minorProfile[i];
      }

      if (majorCorr > bestCorr) {
        bestCorr = majorCorr;
        bestKey = key;
        bestScale = 'Major';
      }
      if (minorCorr > bestCorr) {
        bestCorr = minorCorr;
        bestKey = key;
        bestScale = 'Minor';
      }
    }

    // Camelot wheel mapping
    const camelotMap = {
      'C Major': '8B', 'G Major': '9B', 'D Major': '10B', 'A Major': '11B',
      'E Major': '12B', 'B Major': '1B', 'F# Major': '2B', 'Db Major': '3B',
      'Ab Major': '4B', 'Eb Major': '5B', 'Bb Major': '6B', 'F Major': '7B',
      'A Minor': '8A', 'E Minor': '9A', 'B Minor': '10A', 'F# Minor': '11A',
      'C# Minor': '12A', 'G# Minor': '1A', 'D# Minor': '2A', 'A# Minor': '3A',
      'F Minor': '4A', 'C Minor': '5A', 'G Minor': '6A', 'D Minor': '7A'
    };

    const keyName = noteNames[bestKey];
    const fullKey = `${keyName} ${bestScale}`;
    const camelot = camelotMap[fullKey] || '?';

    return {
      key: keyName,
      scale: bestScale,
      fullKey,
      camelot,
      chroma: Array.from(chroma)
    };
  }

  // ─── Energy Analysis ───
  _analyzeEnergy(channelData) {
    let rmsSum = 0;
    let peakVal = 0;

    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      rmsSum += channelData[i] * channelData[i];
      if (abs > peakVal) peakVal = abs;
    }

    const rms = Math.sqrt(rmsSum / channelData.length);
    const dbRMS = 20 * Math.log10(rms + 1e-10);
    const dbPeak = 20 * Math.log10(peakVal + 1e-10);

    // Normalize energy to 0-100
    const energyNorm = Math.max(0, Math.min(100, Math.round((dbRMS + 30) * 3.3)));

    let label;
    if (energyNorm < 30) label = 'Calme / Ambient';
    else if (energyNorm < 50) label = 'Moderee';
    else if (energyNorm < 70) label = 'Energique';
    else if (energyNorm < 85) label = 'Intense';
    else label = 'Tres intense';

    // Dynamic range
    const dynamicRange = Math.round(dbPeak - dbRMS);

    return {
      rms,
      dbRMS: Math.round(dbRMS * 10) / 10,
      dbPeak: Math.round(dbPeak * 10) / 10,
      normalized: energyNorm,
      label,
      dynamicRange
    };
  }

  // ─── Spectral Analysis ───
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

          // Subsample for speed
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

    // Normalize
    const maxSpec = Math.max(...spectrum);
    if (maxSpec > 0) {
      for (let i = 0; i < numBands; i++) spectrum[i] /= maxSpec;
    }

    // Sub-bass, bass, mid, high ratios
    const subBass = this._avgRange(spectrum, 0, 4);   // ~0-350Hz
    const bass = this._avgRange(spectrum, 4, 10);      // ~350-1kHz
    const mid = this._avgRange(spectrum, 10, 30);      // ~1k-5kHz
    const high = this._avgRange(spectrum, 30, 64);     // ~5k+

    return {
      bands: Array.from(spectrum),
      subBass,
      bass,
      mid,
      high
    };
  }

  _avgRange(arr, start, end) {
    let sum = 0;
    for (let i = start; i < end && i < arr.length; i++) sum += arr[i];
    return sum / (end - start);
  }

  // ─── Characteristics ───
  _analyzeCharacteristics(channelData, sampleRate, spectral, bpmResult, energy) {
    // Danceability: based on BPM regularity and energy
    const bpmFactor = bpmResult.bpm >= 115 && bpmResult.bpm <= 135 ? 1 :
                      bpmResult.bpm >= 100 && bpmResult.bpm <= 150 ? 0.7 : 0.4;
    const danceability = Math.round(Math.min(100,
      (bpmFactor * 50 + energy.normalized * 0.3 + bpmResult.confidence * 0.2)));

    // Darkness: more sub-bass/bass vs high
    const bassRatio = (spectral.subBass + spectral.bass) / (spectral.mid + spectral.high + 0.01);
    const darkness = Math.round(Math.min(100, bassRatio * 45 + 20));

    // Complexity: spectral flatness approximation
    const bands = spectral.bands.filter(b => b > 0.01);
    const geoMean = Math.exp(bands.reduce((s, b) => s + Math.log(b), 0) / bands.length);
    const ariMean = bands.reduce((s, b) => s + b, 0) / bands.length;
    const flatness = ariMean > 0 ? geoMean / ariMean : 0;
    const complexity = Math.round(Math.min(100, flatness * 120 + 15));

    // Bass weight
    const bassWeight = Math.round(Math.min(100, (spectral.subBass + spectral.bass) * 100));

    // Brightness
    const brightness = Math.round(Math.min(100, (spectral.mid + spectral.high * 1.5) * 80));

    // Hypnotic: high BPM regularity + moderate complexity + repetition
    const hypnotic = Math.round(Math.min(100,
      bpmResult.confidence * 0.4 + (100 - complexity) * 0.3 + darkness * 0.3));

    return { danceability, darkness, complexity, bassWeight, brightness, hypnotic };
  }

  // ─── Genre Detection ───
  _detectGenre(bpm, keyResult, energy, chars, spectral) {
    const tags = [];
    const genres = [];

    // BPM-based
    if (bpm >= 85 && bpm <= 115) {
      genres.push('Midtempo Bass', 'Dark Electro');
      tags.push('midtempo');
    }
    if (bpm >= 118 && bpm <= 125) {
      genres.push('Tech House', 'Deep House');
      tags.push('groovy');
    }
    if (bpm >= 125 && bpm <= 138) {
      genres.push('Techno', 'Minimal Techno');
      tags.push('driving');
    }
    if (bpm >= 138 && bpm <= 150) {
      genres.push('Hard Techno', 'Industrial');
      tags.push('fast', 'intense');
    }
    if (bpm >= 140 && bpm <= 150) {
      genres.push('Trance');
    }

    // Character-based
    if (chars.darkness > 65) tags.push('dark', 'sombre');
    if (chars.darkness < 40) tags.push('bright', 'melodic');
    if (chars.hypnotic > 65) tags.push('hypnotic', 'repetitive');
    if (chars.bassWeight > 70) tags.push('heavy bass', 'sub-heavy');
    if (chars.complexity > 65) tags.push('complex', 'layered');
    if (chars.complexity < 35) tags.push('minimal');
    if (chars.danceability > 70) tags.push('danceable');
    if (energy.normalized > 75) tags.push('high energy', 'powerful');
    if (energy.normalized < 35) tags.push('atmospheric', 'ambient');

    // Key-based
    if (keyResult.scale === 'Minor') tags.push('minor key', 'melancholic');
    if (keyResult.scale === 'Major') tags.push('major key', 'uplifting');

    // Spectral-based
    if (spectral.subBass > 0.6) tags.push('deep sub-bass');
    if (spectral.high > 0.5) tags.push('crispy highs');

    return {
      primary: genres.slice(0, 3),
      tags: [...new Set(tags)]
    };
  }

  // ─── Suno Prompt Generation ───
  /**
   * Generate Suno v5 Style Prompt from analysis
   * v5 rules: max 2 genres, genre first, ~200 chars max,
   * comma-separated, narrative > tag lists
   */
  generateSunoPrompt(analysis) {
    const { bpm, key, energy, characteristics, genres } = analysis;
    const parts = [];

    // GENRE (max 2 — v5 punishes genre overload)
    if (genres.primary.length > 0) {
      parts.push(genres.primary.slice(0, 2).join(', '));
    }

    // BPM + Key
    parts.push(`${bpm.bpm} BPM`);
    parts.push(`${key.fullKey}`);

    // MOOD (v5 Mood tags: pick the most fitting one)
    if (characteristics.darkness > 65) parts.push('dark, haunting');
    else if (characteristics.hypnotic > 65) parts.push('hypnotic, introspective');
    else if (energy.normalized > 75) parts.push('high energy, driving');
    else if (energy.normalized > 50) parts.push('moderate energy, groovy');
    else if (energy.normalized > 30) parts.push('chill, atmospheric');
    else parts.push('ambient, ethereal');

    // CHARACTER descriptors (max 3 for v5 clarity)
    const descriptors = [];
    if (characteristics.bassWeight > 65) descriptors.push('heavy sub-bass');
    if (characteristics.brightness > 60) descriptors.push('crispy hi-hats');
    if (characteristics.complexity < 40) descriptors.push('minimal');
    if (characteristics.complexity > 65) descriptors.push('complex layers');
    if (characteristics.danceability > 70 && !descriptors.includes('groovy')) descriptors.push('groovy');
    if (characteristics.hypnotic > 60 && characteristics.complexity < 50) descriptors.push('repetitive patterns');

    if (descriptors.length) parts.push(descriptors.slice(0, 3).join(', '));

    // PRODUCTION TEXTURE (v5 responds well to production tags)
    if (characteristics.darkness > 55) parts.push('industrial textures');
    else if (energy.dynamicRange > 15) parts.push('dynamic builds');
    else if (characteristics.hypnotic > 55) parts.push('hypnotic loops');

    // Clean mix hint (v5 feature — reduces artifacts)
    parts.push('clean mix');

    const result = parts.join(', ');

    // Enforce 200 char limit
    if (result.length > 200) {
      const allParts = result.split(',').map(s => s.trim());
      let trimmed = '';
      for (const p of allParts) {
        if ((trimmed + ', ' + p).length > 200) break;
        trimmed = trimmed ? trimmed + ', ' + p : p;
      }
      return trimmed;
    }

    return result;
  }

  /**
   * Generate Suno v5 tips — updated for v5/v5.5 metatags system
   */
  generateSunoTips(analysis) {
    const tips = [];
    const { bpm, key, characteristics, genres, energy } = analysis;

    tips.push(`🎵 Suno v5: max 2 genres dans le Style Prompt (au-dela, resultats generiques)`);
    tips.push(`🎹 Tonalite "${key.fullKey}" — garde cette cle pour un mood coherent`);
    tips.push(`⏱ BPM ${bpm.bpm} — ajuste +/- 5 BPM pour varier sans changer le genre`);

    if (characteristics.darkness > 60) {
      tips.push('🌑 Tags Mood: [Mood: Haunting] ou [Mood: Somber] dans les Lyrics pour le cote sombre');
    }
    if (characteristics.hypnotic > 60) {
      tips.push('🌀 Tags: [Structure: seamless loop] + [Texture: Gentle Sidechain] pour l\'hypnose');
    }
    if (characteristics.bassWeight > 60) {
      tips.push('🔊 Instruments: [Instrument: 808] ou [Instrument: Reese Bass] pour les basses');
    }
    if (energy.normalized > 70) {
      tips.push('⚡ Energie: [Energy: High] + "driving rhythm, relentless" dans le Style');
    }
    if (energy.normalized < 40) {
      tips.push('🌊 Ambiance: [Energy: Low] + [Texture: Lo-fi warmth] pour le cote ambient');
    }

    // Genre-specific v5 tips
    if (genres.primary.some(g => /minimal/i.test(g))) {
      tips.push('🎛 Minimal: [Instrument: Soft Drums, Acid 303] + [Texture: Tape-Saturated]');
    }
    if (genres.primary.some(g => /midtempo|bass/i.test(g))) {
      tips.push('🖤 Midtempo: [Instrument: 808, Reese Bass] + [Mood: Haunting]');
    }

    tips.push('📝 v5 prefere les prompts narratifs aux listes de tags — decris une scene !');
    tips.push('🎚 Utilise [Energy: Low→High] pour un build progressif dans les Lyrics');
    tips.push('🔇 Pour instrumental: mets [Instrumental] en premiere ligne des Lyrics');
    tips.push('✂️ Regle des 2-3 instruments max par section pour un meilleur rendu');

    return tips;
  }
}

// Export
window.AudioAnalyzer = AudioAnalyzer;
