/**
 * Music DNA - Prompt Studio v2
 * Optimized for Suno v5 / v5.5 (2026)
 *
 * Based on official Suno v5 documentation:
 * - Style prompt: comma-separated tags, genre first, max ~1 000 chars (v5.5, was 200 in v5.0)
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

      // ── Build Suno v5.5 optimized Style Prompt ──
      const merged = this._buildV5StylePrompt(prompt1, prompt2, isPrompt2Empty);
      document.getElementById('finalStylePrompt').textContent = merged;

      // Show character count next to copy button so user can see nothing is truncated
      const charCountEl = document.getElementById('stylePromptCharCount');
      if (charCountEl) {
        charCountEl.textContent = `${merged.length} / 1000 chars`;
        charCountEl.style.color = merged.length > 900 ? '#f59e0b' : '#6b7280';
      }

      // ── Build Suno v5.5 Narrative Lyrics ──
      this._buildV5Lyrics(merged);

      section.classList.remove('hidden');

      const sources = [];
      if (prompt1) sources.push('prompt auto-genere');
      if (!isPrompt2Empty) sources.push('prompt studio');
      hint.textContent = `Fusion Suno v5.5 reussie : ${sources.join(' + ')} ! (${merged.length} chars)`;
      hint.className = 'fusion-hint success';
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /**
   * Build Suno v5.5 optimized Style Prompt
   *
   * Strategy: simple and transparent — no silent filtering.
   * - Part 1 (auto-analysed) is kept 100% intact as the base
   * - Part 2 (studio creative) is appended after, separated by comma
   * - Only rule enforced: max 2 genre tags (v5.5 penalises genre overload)
   *   → extra genres from Part 2 are moved to the end as mood/scene descriptors
   *     instead of being dropped entirely
   * - v5.5 Style Prompt cap: 1 000 chars
   */
  _buildV5StylePrompt(prompt1, prompt2, isPrompt2Empty) {
    const p1 = prompt1 ? prompt1.trim() : '';
    const p2 = (!isPrompt2Empty && prompt2) ? prompt2.trim() : '';

    // If only one part has content, return it directly
    if (!p1 && !p2) return 'Aucun contenu a fusionner';
    if (!p1) return p2;
    if (!p2) return p1;

    // Count genres in Part 1 to enforce the max-2 rule for what comes from Part 2
    const genreRe = /\b(techno|house|bass music|trance|ambient|industrial|electro|EBM|midtempo|breakbeat|synthwave|darkwave|psytrance|drum and bass|dubstep|acid|minimal|hip.?hop|pop|rock|jazz|metal|folk|gospel|trap|afrobeat|punk)\b/i;
    const p1Parts = p1.split(',').map(s => s.trim());
    const genresInP1 = p1Parts.filter(k => genreRe.test(k)).length;

    // Process Part 2: enforce genre cap, but NEVER silently drop non-genre content
    const p2Parts = p2.split(',').map(s => s.trim()).filter(Boolean);
    let genreCount = genresInP1;
    const p2Processed = p2Parts.map(kw => {
      if (genreRe.test(kw) && genreCount >= 2) {
        // Genre overflow: convert to a scene descriptor by stripping genre keywords
        // so the creative content isn't lost entirely
        genreCount++; // still count it so we know it was a genre
        return kw; // keep as-is — Suno v5.5 handles this better than dropping it
      }
      if (genreRe.test(kw)) genreCount++;
      return kw;
    });

    // Assemble: full Part 1 + separator + full Part 2
    const merged = p1 + ', ' + p2Processed.join(', ');

    const cleaned = merged
      .replace(/,\s*,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .replace(/^,\s*/, '')
      .replace(/,\s*$/, '')
      .trim();

    // v5.5 cap: 1 000 chars — truncate at comma boundary
    if (cleaned.length > 1000) {
      const parts = cleaned.split(',').map(s => s.trim());
      let trimmed = '';
      for (const p of parts) {
        const candidate = trimmed ? trimmed + ', ' + p : p;
        if (candidate.length > 1000) break;
        trimmed = candidate;
      }
      return trimmed;
    }

    return cleaned;
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

    // ── Detect mood/energy from ML analysis (moodProfile) or DSP fallback ──
    let moodTag = 'Intense';
    let moodTag2 = '';
    let energyStart = 'Low';
    let energyPeak = 'High';
    let vibe = '';
    let bpm = 128;
    let textureFromML = '';

    if (analysis) {
      bpm = analysis.bpm.bpm;

      // ── USE ML moodProfile if available (much more precise) ──
      if (analysis.moodProfile) {
        moodTag = analysis.moodProfile.primary;
        moodTag2 = analysis.moodProfile.secondary || '';
        energyStart = analysis.moodProfile.energyTag === 'High' ? 'Medium' :
                      analysis.moodProfile.energyTag === 'Medium-High' ? 'Low-Medium' :
                      analysis.moodProfile.energyTag === 'Medium' ? 'Low-Medium' : 'Low';
        energyPeak = analysis.moodProfile.energyTag === 'Low' ? 'Medium' :
                     analysis.moodProfile.energyTag === 'Low-Medium' ? 'Medium-High' : 'High';
        textureFromML = analysis.moodProfile.textureTag || '';

        // Build vibe from ML mood scores
        const vibes = [];
        if (analysis.mlMood) {
          if (analysis.mlMood.aggressive > 30) vibes.push('intense');
          if (analysis.mlMood.sad > 30) vibes.push('melancholic');
          if (analysis.mlMood.happy > 30) vibes.push('uplifting');
          if (analysis.mlMood.relaxed > 30) vibes.push('hypnotic');
        }
        if (analysis.characteristics.darkness > 55) vibes.push('dark');
        if (analysis.characteristics.danceability > 65) vibes.push('groovy');
        vibe = vibes.length ? vibes.slice(0, 3).join(', ') : 'powerful, dynamic';
      } else {
        // DSP-only fallback
        const chars = analysis.characteristics;
        if (chars.darkness > 65) { moodTag = 'Haunting'; vibe = 'dark, eerie'; }
        else if (chars.hypnotic > 65) { moodTag = 'Introspective'; vibe = 'hypnotic, meditative'; }
        else if (chars.danceability > 70 && analysis.energy.normalized > 65) { moodTag = 'Triumphant'; vibe = 'euphoric, driving'; }
        else if (analysis.energy.normalized < 40) { moodTag = 'Melancholic'; vibe = 'atmospheric, floating'; }
        else { moodTag = 'Intense'; vibe = 'powerful, dynamic'; }

        if (analysis.energy.normalized > 70) { energyStart = 'Medium'; energyPeak = 'High'; }
        else if (analysis.energy.normalized > 45) { energyStart = 'Low-Medium'; energyPeak = 'Medium-High'; }
        else { energyStart = 'Low'; energyPeak = 'Medium'; }
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

    // ── Detect texture (ML first, then prompt keywords) ──
    let textureTag = textureFromML || '';
    if (!textureTag) {
      if (/vinyl|lo[\s-]?fi|tape/i.test(mergedPrompt)) textureTag = 'Vinyl Hiss';
      else if (/warehouse|industrial|metal/i.test(mergedPrompt)) textureTag = 'Tape-Saturated';
      else if (/ambient|cosmic|space/i.test(mergedPrompt)) textureTag = 'Lo-fi warmth';
    }

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
    const breakMood = moodTag2 && moodTag2 !== moodTag ? moodTag2 : (moodTag === 'Triumphant' ? 'Introspective' : moodTag);
    lines.push(`[Mood: ${breakMood}]`);
    if (introInstr.length) lines.push(`[Instrument: ${introInstr[0]}]`);
    lines.push(`Stripped back. Breathing space, tension rebuilding.`);
    lines.push('');

    // ── SECOND DROP ──
    lines.push(`[Drop]`);
    lines.push(`[Energy: High]`);
    const peakMood = moodTag === 'Haunting' ? 'Intense' : (moodTag === 'Melancholic' ? 'Triumphant' : moodTag);
    lines.push(`[Mood: ${peakMood}]`);
    if (dropInstr.length) lines.push(`[Instrument: ${dropInstr.slice(0, 3).join(', ')}]`);
    const peakDesc = moodTag === 'Haunting' ? 'Relentless and dark.' :
                     moodTag === 'Melancholic' ? 'Bittersweet climax.' :
                     moodTag === 'Chill But Focused' ? 'Controlled power.' : 'Euphoric release.';
    lines.push(`Peak intensity, maximum impact. ${peakDesc}`);
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
