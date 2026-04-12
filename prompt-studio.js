/**
 * Music DNA - Prompt Studio v2
 * Optimized for Suno v5 / v5.5 (2026)
 *
 * Based on official Suno v5 documentation:
 * - Style prompt: comma-separated tags, genre first, max ~200 chars
 * - Lyrics: metatags [Section], [Mood:], [Energy:], [Instrument:], [Vocal Style:], etc.
 * - Max 2 genres (v5 punishes genre overload)
 * - Narrative blueprint format for lyrics
 * - Mood/Energy/Texture/Production tags as v5 directives
 */

class PromptStudio {
  constructor() {
    this.analysisData = null;
    this.creativeInput = null;
    this.debounceTimer = null;
    this.injectedChips = [];
  }

  init() {
    this.creativeInput = document.getElementById('creativeInput');

    this._setupInspoChips();
    this._setupCreativeInput();
    this._setupFusionButton();
    this._setupPromptTabs();
    this._setupCopyButtons();
  }

  setAnalysisData(data) {
    this.analysisData = data;
    const hint = document.getElementById('fusionHint');
    if (hint && data) {
      hint.textContent = `Analyse prete (${data.bpm.bpm} BPM, ${data.key.fullKey}). Ecris ta vision puis clique Fusionner !`;
    }
  }

  // ─── Inspiration chips ───
  _setupInspoChips() {
    document.querySelectorAll('.inspo-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.dataset.text;
        const textarea = this.creativeInput;
        const current = textarea.value.trim();

        if (current) {
          textarea.value = /[.,;!?]$/.test(current) ? current + ' ' + text : current + ', ' + text;
        } else {
          textarea.value = text.charAt(0).toUpperCase() + text.slice(1);
        }

        if (!this.injectedChips.includes(text)) {
          this.injectedChips.push(text);
        }

        chip.classList.add('injected');
        setTimeout(() => chip.classList.remove('injected'), 600);

        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        this._updateStudioPreview();
      });
    });
  }

  // ─── Creative text input ───
  _setupCreativeInput() {
    this.creativeInput.addEventListener('input', () => {
      this._updateStudioPreview();
    });
  }

  _updateStudioPreview() {
    const creative = (this.creativeInput?.value || '').trim();
    const preview = document.getElementById('studioPromptPreview');
    if (!preview) return;

    if (creative) {
      preview.textContent = this._creativeToPomptFragment(creative);
    } else if (this.injectedChips.length > 0) {
      preview.textContent = this.injectedChips.join(', ');
    } else {
      preview.textContent = 'Ecris ta vision ci-dessus ou clique des inspirations...';
    }
  }

  // ═══════════════════════════════════════════════════
  // FUSION: Card 1 (auto) + Card 2 (studio) → Final
  // ═══════════════════════════════════════════════════
  _setupFusionButton() {
    const btn = document.getElementById('fusionBtn');
    const hint = document.getElementById('fusionHint');
    const section = document.getElementById('finalPromptSection');

    btn.addEventListener('click', () => {
      const prompt1 = (document.getElementById('sunoPrompt')?.textContent || '').trim();
      const prompt2 = (document.getElementById('studioPromptPreview')?.textContent || '').trim();
      const isPrompt2Empty = !prompt2 || prompt2.startsWith('Ecris ta vision');

      if (!prompt1 && isPrompt2Empty) {
        hint.textContent = 'Rien a fusionner ! Analyse un morceau et/ou ecris ta vision.';
        hint.className = 'fusion-hint';
        return;
      }

      btn.classList.add('fusing');
      setTimeout(() => btn.classList.remove('fusing'), 600);

      // ── Build Suno v5 optimized Style Prompt ──
      const merged = this._buildV5StylePrompt(prompt1, prompt2, isPrompt2Empty);
      document.getElementById('finalStylePrompt').textContent = merged;

      // ── Build Suno v5 Narrative Lyrics ──
      this._buildV5Lyrics(merged);

      section.classList.remove('hidden');

      const sources = [];
      if (prompt1) sources.push('prompt auto-genere');
      if (!isPrompt2Empty) sources.push('prompt studio');
      hint.textContent = `Fusion Suno v5 reussie : ${sources.join(' + ')} !`;
      hint.className = 'fusion-hint success';
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /**
   * Build Suno v5 optimized Style Prompt
   * Rules from v5 doc:
   * - Max 2 genres (v5 punishes genre overload)
   * - Genre first, most important signal
   * - Comma-separated descriptors
   * - Be specific but not overloaded: 5-10 tags
   * - Avoid contradictions
   * - Place important keywords at beginning AND end
   */
  _buildV5StylePrompt(prompt1, prompt2, isPrompt2Empty) {
    const keywords1 = prompt1 ? prompt1.split(',').map(s => s.trim()).filter(Boolean) : [];
    const keywords2 = (!isPrompt2Empty && prompt2) ? prompt2.split(',').map(s => s.trim()).filter(Boolean) : [];

    // Deduplicate
    const lowerPool = keywords1.join(' ').toLowerCase();
    const uniqueFrom2 = keywords2.filter(kw => {
      const words = kw.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.length === 0 || !words.every(w => lowerPool.includes(w));
    });

    // Categorize everything
    const genres = [];
    const moods = [];
    const instruments = [];
    const textures = [];
    const tech = [];
    const other = [];

    const genreRe = /techno|house|bass|trance|ambient|industrial|electro|EBM|midtempo|breakbeat|synthwave|darkwave|psytrance|drum\s*and\s*bass|dubstep|acid|minimal|hip[\s-]?hop|pop|rock|jazz|R&B|metal|folk|gospel|trap|afrobeat|punk/i;
    const moodRe = /dark|hypnotic|driving|atmospheric|brutal|euphoric|melancholic|menacing|cosmic|ethereal|raw|intense|deep|underground|futuristic|tribal|nocturnal|uplifting|chill|dreamy|nostalgic|joyful|somber|triumphant|haunting|groovy/i;
    const instrRe = /303|808|modular|kicks?|pads?|glitch|percussion|hi[\s-]?hats?|vocal|arpeg|drone|riser|piano|guitar|synth|strings?|brass|bass|organ|rhodes|trumpet|drums?|saxophone/i;
    const texRe = /tape|vinyl|lo[\s-]?fi|sidechain|reverb|delay|saturation|distort|cinematic|metallic|strobe|fog|warehouse|club|festival|desert|forest|basement|Berlin|Tokyo/i;
    const techRe = /BPM|Major|Minor|key of/i;

    const allKw = [...keywords1, ...uniqueFrom2];

    for (const kw of allKw) {
      if (techRe.test(kw)) tech.push(kw);
      else if (genreRe.test(kw)) genres.push(kw);
      else if (moodRe.test(kw)) moods.push(kw);
      else if (instrRe.test(kw)) instruments.push(kw);
      else if (texRe.test(kw)) textures.push(kw);
      else other.push(kw);
    }

    // v5 RULE: max 2 genres
    const finalParts = [];
    if (genres.length) finalParts.push(...genres.slice(0, 2));
    if (tech.length) finalParts.push(...tech);
    if (moods.length) finalParts.push(...moods.slice(0, 3));
    if (instruments.length) finalParts.push(...instruments.slice(0, 3));
    if (textures.length) finalParts.push(...textures.slice(0, 2));
    if (other.length) finalParts.push(...other.slice(0, 2));

    let merged = finalParts.join(', ')
      .replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').replace(/^,\s*/, '').replace(/,\s*$/, '').trim();

    // v5: style prompt ideally under ~200 chars
    if (merged.length > 200) {
      const parts = merged.split(',').map(s => s.trim());
      let trimmed = '';
      for (const p of parts) {
        if ((trimmed + ', ' + p).length > 200) break;
        trimmed = trimmed ? trimmed + ', ' + p : p;
      }
      merged = trimmed;
    }

    return merged || 'Aucun contenu a fusionner';
  }

  /**
   * Build Suno v5 Narrative Blueprint Lyrics
   *
   * v5 format uses section-aware directives:
   * [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Drop], [Outro]
   * + [Mood: X], [Energy: X], [Instrument: X], [Texture: X]
   * + Descriptive scene text per section
   */
  _buildV5Lyrics(mergedPrompt) {
    const analysis = this.analysisData;
    const creative = (this.creativeInput?.value || '').trim();
    const lines = [];

    // ── Detect mood/energy from analysis ──
    let moodTag = 'Intense';
    let energyStart = 'Low';
    let energyPeak = 'High';
    let vibe = '';
    let bpm = 128;

    if (analysis) {
      bpm = analysis.bpm.bpm;
      const chars = analysis.characteristics;

      if (chars.darkness > 65) {
        moodTag = 'Haunting';
        vibe = 'dark, eerie';
      } else if (chars.hypnotic > 65) {
        moodTag = 'Introspective';
        vibe = 'hypnotic, meditative';
      } else if (chars.danceability > 70 && analysis.energy.normalized > 65) {
        moodTag = 'Triumphant';
        vibe = 'euphoric, driving';
      } else if (analysis.energy.normalized < 40) {
        moodTag = 'Melancholic';
        vibe = 'atmospheric, floating';
      } else {
        moodTag = 'Intense';
        vibe = 'powerful, dynamic';
      }

      // Energy curve
      if (analysis.energy.normalized > 70) {
        energyStart = 'Medium';
        energyPeak = 'High';
      } else if (analysis.energy.normalized > 45) {
        energyStart = 'Low-Medium';
        energyPeak = 'Medium-High';
      } else {
        energyStart = 'Low';
        energyPeak = 'Medium';
      }
    }

    // ── Detect instruments from merged prompt ──
    const introInstr = [];
    const dropInstr = [];

    if (/303|acid/i.test(mergedPrompt)) { introInstr.push('Acid 303'); dropInstr.push('Acid 303'); }
    if (/808|sub[\s-]?bass/i.test(mergedPrompt)) dropInstr.push('808');
    if (/pad|nappe|ethereal/i.test(mergedPrompt)) introInstr.push('Synth Pads');
    if (/kick|distort/i.test(mergedPrompt)) dropInstr.push('Drums (Heavy)');
    if (/arpeg/i.test(mergedPrompt)) { introInstr.push('Arpeggiated Synth'); }
    if (/modular|synth/i.test(mergedPrompt)) dropInstr.push('Modular Synth');
    if (/piano/i.test(mergedPrompt)) introInstr.push('Piano');
    if (/guitar/i.test(mergedPrompt)) dropInstr.push('Electric Guitar (Distorted)');
    if (/hi[\s-]?hat/i.test(mergedPrompt)) dropInstr.push('Hi-Hats');
    if (/drone/i.test(mergedPrompt)) introInstr.push('Drone Synth');
    if (/percussion|industrial/i.test(mergedPrompt)) dropInstr.push('Industrial Percussion');

    // Defaults if nothing detected
    if (introInstr.length === 0) introInstr.push('Synth Pads', 'Soft Drums');
    if (dropInstr.length === 0) dropInstr.push('Drums (Heavy)', '808');

    // ── Detect texture ──
    let textureTag = '';
    if (/vinyl|lo[\s-]?fi|tape/i.test(mergedPrompt)) textureTag = 'Vinyl Hiss';
    else if (/warehouse|industrial|metal/i.test(mergedPrompt)) textureTag = 'Tape-Saturated';
    else if (/ambient|cosmic|space/i.test(mergedPrompt)) textureTag = 'Lo-fi warmth';

    // ── Detect scene from creative text for narrative descriptions ──
    const translated = creative ? this._creativeToPomptFragment(creative) : '';
    const sceneHint = translated.length > 15 ? translated.substring(0, 60) : vibe;

    // ═══════════════════════════════════════════
    // BUILD SUNO v5 NARRATIVE BLUEPRINT
    // ═══════════════════════════════════════════
    lines.push('[Instrumental]');
    lines.push('');

    // ── INTRO ──
    lines.push(`[Intro]`);
    lines.push(`[Mood: ${moodTag}]`);
    lines.push(`[Energy: ${energyStart}]`);
    if (introInstr.length) lines.push(`[Instrument: ${introInstr.slice(0, 2).join(', ')}]`);
    if (textureTag) lines.push(`[Texture: ${textureTag}]`);
    lines.push(`Ambient opening, ${sceneHint || 'setting the scene'}. Faint elements slowly fade in.`);
    lines.push('');

    // ── BUILD ──
    lines.push(`[Pre-Chorus]`);
    lines.push(`[Energy: ${energyStart === 'Low' ? 'Low-Medium' : 'Medium'}]`);
    lines.push(`Beat builds with layered elements, rhythmic hi-hats at ${bpm} BPM.`);
    lines.push('');

    // ── DROP / PEAK ──
    lines.push(`[Drop]`);
    lines.push(`[Energy: ${energyPeak}]`);
    lines.push(`[Mood: ${moodTag === 'Haunting' ? 'Intense' : moodTag}]`);
    if (dropInstr.length) lines.push(`[Instrument: ${dropInstr.slice(0, 3).join(', ')}]`);
    lines.push(`Full intensity, ${vibe || 'driving groove'}. All elements hit.`);
    lines.push('');

    // ── BREAKDOWN ──
    lines.push(`[Break]`);
    lines.push(`[Energy: Low-Medium]`);
    lines.push(`[Mood: ${moodTag === 'Triumphant' ? 'Introspective' : moodTag}]`);
    if (introInstr.length) lines.push(`[Instrument: ${introInstr[0]}]`);
    lines.push(`Stripped back. Breathing space, tension rebuilding.`);
    lines.push('');

    // ── SECOND DROP ──
    lines.push(`[Drop]`);
    lines.push(`[Energy: High]`);
    lines.push(`[Mood: Triumphant]`);
    if (dropInstr.length) lines.push(`[Instrument: ${dropInstr.slice(0, 3).join(', ')}]`);
    lines.push(`Peak intensity, maximum impact. ${moodTag === 'Haunting' ? 'Relentless and dark.' : 'Euphoric release.'}`);
    lines.push('');

    // ── OUTRO ──
    lines.push(`[Outro]`);
    lines.push(`[Energy: Low]`);
    lines.push(`[Fade Out]`);
    if (introInstr.length) lines.push(`[Instrument: ${introInstr[0]}]`);
    lines.push(`Elements removing one by one. Echoing into silence.`);
    lines.push('');
    lines.push('[End]');

    document.getElementById('finalLyricsPrompt').textContent = lines.join('\n');
  }

  // ─── Prompt tabs ───
  _setupPromptTabs() {
    document.querySelectorAll('.prompt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.prompt-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.prompt-output').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`ptab-${tab.dataset.ptab}`).classList.remove('hidden');
      });
    });
  }

  // ─── Copy buttons ───
  _setupCopyButtons() {
    document.getElementById('copyFinalInline')?.addEventListener('click', () => {
      const text = document.getElementById('finalStylePrompt').textContent;
      navigator.clipboard.writeText(text);
      this._toast('Style prompt copie !');
    });

    document.getElementById('copyLyricsBtn')?.addEventListener('click', () => {
      const text = document.getElementById('finalLyricsPrompt').textContent;
      navigator.clipboard.writeText(text);
      this._toast('Lyrics copie !');
    });
  }

  /**
   * Convert French creative text → English Suno-friendly fragment
   * Suno v5 works best with English + natural language (no phonetic hacks needed)
   */
  _creativeToPomptFragment(text) {
    const translations = [
      [/\bwarehouse\s*abandon[née]*/gi, 'abandoned warehouse'],
      [/\bbasses?\s*lourdes?\b/gi, 'heavy bass'],
      [/\bfait\s*vibrer\b/gi, 'vibrating'],
      [/\bbrouillard\b/gi, 'fog'],
      [/\btension\s*monte\b/gi, 'rising tension'],
      [/\btension\s*croissante\b/gi, 'rising tension'],
      [/\bprogressivement\b/gi, 'progressively'],
      [/\bsons?\s*acid\b/gi, 'acid sounds'],
      [/\btextures?\s*m[ée]talliques?\b/gi, 'metallic textures'],
      [/\bse\s*m[ée]langent\b/gi, 'blending together'],
      [/\bbrutal\s*et\s*lib[ée]rateur\b/gi, 'brutal and cathartic'],
      [/\bsombre\b/gi, 'dark'],
      [/\bsombres?\b/gi, 'dark'],
      [/\bnoir\s*total\b/gi, 'pitch black'],
      [/\blumiere\b/gi, 'light'],
      [/\bstroboscop\w*/gi, 'strobe lights'],
      [/\bb[ée]ton\s*brut\b/gi, 'raw concrete'],
      [/\bsyst[eè]me\s*son\b/gi, 'sound system'],
      [/\bfoule\s*immense\b/gi, 'massive crowd'],
      [/\byeux\s*ferm[ée]s\b/gi, 'eyes closed'],
      [/\bintimiste\b/gi, 'intimate'],
      [/\bvoyage\s*nocturne\b/gi, 'nocturnal journey'],
      [/\bville\s*abandon[née]*e?\b/gi, 'abandoned city'],
      [/\bsans\s*piti[ée]\b/gi, 'merciless'],
      [/\bintensit[ée]\s*maximale\b/gi, 'maximum intensity'],
      [/\b[ée]nergie\s*brute\b/gi, 'raw energy'],
      [/\bnappes?\b/gi, 'pads'],
      [/\b[ée]th[ée]r[ée]al\w*/gi, 'ethereal'],
      [/\bpercussions?\s*industriell\w*/gi, 'industrial percussion'],
      [/\bmurmures?\b/gi, 'whispers'],
      [/\bcroustillants?\b/gi, 'crispy'],
      [/\bnum[ée]riques?\b/gi, 'digital'],
      [/\bprofondeur\b/gi, 'depth'],
      [/\bcommence\s*doucement\b/gi, 'starts slowly'],
      [/\ble\s*drop\s*est\b/gi, 'the drop is'],
      [/\bm[ée]lange\s*de\b/gi, 'blend of'],
      [/\bon\s*commence\b/gi, 'starting with'],
      [/\bpuis\b/gi, 'then'],
      [/\bavec\s*des\b/gi, 'with'],
      [/\bdans\s*un\b/gi, 'in a'],
      [/\bdans\s*une\b/gi, 'in a'],
      [/\bà\b/gi, 'in'],
      [/\bet\b/gi, 'and'],
      [/\bqui\b/gi, 'that'],
      [/\bl['']ambiance\s*est\b/gi, 'the atmosphere is'],
      [/\ble\s*sol\b/gi, 'the floor'],
      // Additional v5.5 era translations
      [/\bmontée?\b/gi, 'rising'],
      [/\bdescente\b/gi, 'descent'],
      [/\bexplosion\b/gi, 'explosion'],
      [/\blib[ée]ration\b/gi, 'release'],
      [/\boppressant\b/gi, 'oppressive'],
      [/\bclaustrophob\w*/gi, 'claustrophobic'],
      [/\bcosmique\b/gi, 'cosmic'],
      [/\bspirituel\w*/gi, 'spiritual'],
      [/\bm[ée]ditatif\w*/gi, 'meditative'],
      [/\bpr[ée]dateur\b/gi, 'predatory'],
      [/\brelentless\b/gi, 'relentless'],
      [/\bimpitoyable\b/gi, 'merciless'],
      [/\bm[ée]lancolique\b/gi, 'melancholic'],
      [/\beuphori\w*/gi, 'euphoric'],
      [/\btribale?\b/gi, 'tribal'],
      [/\borganique\b/gi, 'organic'],
      [/\blever\s*du?\s*soleil\b/gi, 'sunrise'],
      [/\bcoucher\s*du?\s*soleil\b/gi, 'sunset'],
      [/\bnuit\b/gi, 'night'],
      [/\bfeu\b/gi, 'fire'],
      [/\bglace\b/gi, 'ice'],
      [/\bpluie\b/gi, 'rain'],
      [/\borage\b/gi, 'thunderstorm'],
      [/\bvent\b/gi, 'wind'],
      [/\bfor[eê]t\b/gi, 'forest'],
      [/\bd[ée]sert\b/gi, 'desert'],
      [/\boc[ée]an\b/gi, 'ocean'],
      [/\bespace\b/gi, 'space'],
      [/\b[ée]toiles?\b/gi, 'stars'],
      [/\blune\b/gi, 'moon'],
      [/\bsecr[eè]te?\b/gi, 'secret'],
      [/\bill[ée]gale?\b/gi, 'illegal'],
      [/\blibert[ée]\b/gi, 'freedom'],
      [/\brebelle\b/gi, 'rebel'],
      [/\bdangereu\w*/gi, 'dangerous'],
      [/\bmyst[ée]rieu\w*/gi, 'mysterious'],
      [/\bpuissant\w*/gi, 'powerful'],
      [/\bmagique\b/gi, 'magical'],
      [/\bhypnotisant\w*/gi, 'hypnotizing'],
      [/\benvo[uû]tant\w*/gi, 'mesmerizing'],
      [/\benvahissant\w*/gi, 'overwhelming'],
      [/\bgroove\b/gi, 'groove'],
      [/\brythme\b/gi, 'rhythm'],
      [/\bm[ée]lodie\b/gi, 'melody'],
      [/\baccord\w*/gi, 'chords'],
      [/\bboucle\b/gi, 'loop'],
      [/\br[ée]p[ée]titi\w*/gi, 'repetitive'],
    ];

    let result = text;
    for (const [pattern, replacement] of translations) {
      result = result.replace(pattern, replacement);
    }

    result = result.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.');
    return result.trim();
  }

  _toast(msg) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }
}

window.PromptStudio = PromptStudio;
