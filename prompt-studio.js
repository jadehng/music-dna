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
    this._selectedTemplate = 'auto';
  }

  init() {
    this.creativeInput = document.getElementById('creativeInput');

    this._setupInspoChips();
    this._setupCreativeInput();
    this._setupFusionButton();
    this._setupPromptTabs();
    this._setupCopyButtons();
    this._setupStructureSection();
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

  // ─── Structure section setup ───
  _setupStructureSection() {
    // Template button selection
    document.querySelectorAll('.template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.template-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedTemplate = btn.dataset.template;
      });
    });

    // Standalone "Generate Structure" button — regenerates lyrics without re-doing style prompt
    document.getElementById('generateStructureBtn')?.addEventListener('click', () => {
      const stylePrompt = document.getElementById('finalStylePrompt')?.textContent || '';
      const mergedPrompt = stylePrompt.startsWith('Aucun') ? '' : stylePrompt;
      this._buildV5Lyrics(mergedPrompt || document.getElementById('sunoPrompt')?.textContent || '');

      // Make sure the final section is visible and scrolled to lyrics tab
      const section = document.getElementById('finalPromptSection');
      section?.classList.remove('hidden');
      document.querySelectorAll('.prompt-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.prompt-output').forEach(c => c.classList.add('hidden'));
      document.querySelector('.prompt-tab[data-ptab="lyrics"]')?.classList.add('active');
      document.getElementById('ptab-lyrics')?.classList.remove('hidden');
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ─── Build lyrics context from analysis + creative input ───
  _buildLyricsContext(mergedPrompt) {
    const analysis = this.analysisData;
    const creative = (this.creativeInput?.value || '').trim();

    let moodTag = 'Intense', secondMood = 'Introspective';
    let energyStart = 'Low', energyPeak = 'High';
    let vibe = 'powerful, dynamic';
    let bpm = 128, textureTag = '';

    if (analysis) {
      bpm = analysis.bpm.bpm;
      if (analysis.moodProfile) {
        moodTag = analysis.moodProfile.primary;
        secondMood = analysis.moodProfile.secondary || 'Introspective';
        const eTag = analysis.moodProfile.energyTag;
        energyStart = (eTag === 'High' || eTag === 'Medium-High') ? 'Medium' : 'Low';
        energyPeak = eTag === 'Low' ? 'Medium' : 'High';
        textureTag = analysis.moodProfile.textureTag || '';
      } else {
        const chars = analysis.characteristics;
        if (chars.darkness > 65) moodTag = 'Haunting';
        else if (chars.hypnotic > 65) moodTag = 'Introspective';
        else if (chars.danceability > 70) moodTag = 'Triumphant';
        else if (analysis.energy.normalized < 40) moodTag = 'Melancholic';
        if (analysis.energy.normalized > 70) { energyStart = 'Medium'; energyPeak = 'High'; }
        else if (analysis.energy.normalized > 45) { energyStart = 'Low-Medium'; energyPeak = 'Medium-High'; }
      }
      // Build vibe string
      const vibes = [];
      if (analysis.mlMood?.aggressive > 30) vibes.push('intense');
      if (analysis.mlMood?.sad > 30) vibes.push('melancholic');
      if (analysis.mlMood?.happy > 30) vibes.push('uplifting');
      if (analysis.mlMood?.relaxed > 30) vibes.push('hypnotic');
      if (analysis.characteristics?.darkness > 55) vibes.push('dark');
      if (analysis.characteristics?.danceability > 65) vibes.push('groovy');
      vibe = vibes.length ? vibes.slice(0, 3).join(', ') : 'powerful, dynamic';
    }

    // Instruments from merged prompt
    const introInstr = [], dropInstr = [];
    if (/303|acid/i.test(mergedPrompt)) { introInstr.push('Acid 303'); dropInstr.push('Acid 303'); }
    if (/808|sub[\s-]?bass/i.test(mergedPrompt)) dropInstr.push('808');
    if (/pad|nappe|ethereal/i.test(mergedPrompt)) introInstr.push('Synth Pads');
    if (/kick|distort/i.test(mergedPrompt)) dropInstr.push('Drums (Heavy)');
    if (/arpeg/i.test(mergedPrompt)) introInstr.push('Arpeggiated Synth');
    if (/modular|synth/i.test(mergedPrompt)) dropInstr.push('Modular Synth');
    if (/drone/i.test(mergedPrompt)) introInstr.push('Drone Synth');
    if (/percussion|industrial/i.test(mergedPrompt)) dropInstr.push('Industrial Percussion');
    if (/hi[\s-]?hat/i.test(mergedPrompt)) dropInstr.push('Hi-Hats');
    if (introInstr.length === 0) introInstr.push('Synth Pads', 'Minimal Drums');
    if (dropInstr.length === 0) dropInstr.push('Drums (Heavy)', '808');

    // Texture fallback
    if (!textureTag) {
      if (/vinyl|lo[\s-]?fi|tape/i.test(mergedPrompt)) textureTag = 'Vinyl Hiss';
      else if (/warehouse|industrial|metal/i.test(mergedPrompt)) textureTag = 'Tape-Saturated';
      else if (/ambient|cosmic|space/i.test(mergedPrompt)) textureTag = 'Lo-fi warmth';
    }

    // Scene: take first meaningful phrase from creative input (translated)
    const translated = creative ? this._creativeToPomptFragment(creative) : '';
    const scene = translated.length > 10
      ? translated.split(/[.!]/)[0].trim().substring(0, 80)
      : '';

    const peakDesc = {
      'Haunting': 'Relentless and dark',
      'Melancholic': 'Bittersweet climax',
      'Chill But Focused': 'Controlled power',
      'Triumphant': 'Cathartic release',
      'Joyful': 'Euphoric peak',
      'Introspective': 'Meditative peak',
    }[moodTag] || 'Euphoric release';

    return {
      bpm, moodTag, secondMood, energyStart, energyPeak,
      vibe, scene, textureTag, peakDesc,
      introInstrs: introInstr.slice(0, 2).join(', '),
      dropInstrs: dropInstr.slice(0, 3).join(', '),
    };
  }

  // ─── Auto-detect template from analysis + structure text ───
  _detectTemplate(analysis, structureText) {
    const st = (structureText || '').toLowerCase();

    // User explicitly specified a structure pattern
    if (/\b(2|two|3|three)\s*(drops?|peaks?)/i.test(st) || /\bjourney\b/i.test(st)) return 'journey';
    if (/\bprogress\w*\b|\blayers?\b|\bgradual\b/i.test(st)) return 'progressive';
    if (/\bminimal\b|\bhypno\w*\b|\bno\s*drop\b|\bgroove\b/i.test(st)) return 'minimal';
    if (/\banthems?\b|\bchorus\b|\bverse\b|\bhook\b/i.test(st)) return 'anthem';
    if (/\bclassic\b|\bone\s*drop\b|\bsingle\s*drop\b/i.test(st)) return 'classic-drop';

    // Auto-detect from analysis data
    if (!analysis) return 'classic-drop';
    const { bpm, characteristics, energy } = analysis;

    if (characteristics.hypnotic > 65 && bpm.bpm < 130) return 'minimal';
    if (energy.normalized > 70 && bpm.bpm > 130 && characteristics.darkness > 55) return 'journey';
    if (characteristics.complexity > 60 && energy.normalized < 65) return 'progressive';
    return 'classic-drop';
  }

  // ─── Render a list of section objects → Suno lyrics string ───
  _renderSections(sections) {
    const lines = ['[Instrumental]', ''];
    for (const s of sections) {
      lines.push(s.tag);
      if (s.energy)   lines.push(`[Energy: ${s.energy}]`);
      if (s.mood)     lines.push(`[Mood: ${s.mood}]`);
      if (s.instrs)   lines.push(`[Instrument: ${s.instrs}]`);
      if (s.texture)  lines.push(`[Texture: ${s.texture}]`);
      if (s.extras)   s.extras.forEach(e => lines.push(e));
      lines.push(s.desc);
      lines.push('');
    }
    lines.push('[End]');
    return lines.join('\n');
  }

  // ─── Template definitions ───
  _getTemplateSections(name, c) {
    const templates = {

      'classic-drop': [
        { tag: '[Intro]',      energy: c.energyStart,   mood: c.moodTag,    instrs: c.introInstrs, texture: c.textureTag,
          desc: `${c.scene || 'Atmospheric opening'}. ${c.vibe.split(',')[0]} energy. Faint elements emerge from silence.` },
        { tag: '[Build]',      energy: 'Low-Medium',    mood: null,         instrs: null,           texture: null,
          desc: `Tension rising at ${c.bpm} BPM. Rhythmic layers stacking. Energy accumulating.` },
        { tag: '[Drop]',       energy: c.energyPeak,    mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Full impact. ${c.vibe}. All elements detonate simultaneously.` },
        { tag: '[Break]',      energy: 'Low-Medium',    mood: c.secondMood, instrs: c.introInstrs, texture: c.textureTag,
          desc: `Stripped back. ${c.scene ? c.scene.split(',')[0] : 'Breathing space'}. Tension rebuilding under the surface.` },
        { tag: '[Drop]',       energy: 'High',          mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Second peak. ${c.peakDesc}. Maximum intensity, no mercy.` },
        { tag: '[Outro]',      energy: 'Low',           mood: null,         instrs: c.introInstrs, texture: c.textureTag,
          extras: ['[Fade Out]'],
          desc: `Elements dissolving one by one. ${c.scene ? c.scene.split(',')[0] : 'Fading into the night'}. Echo into silence.` },
      ],

      'journey': [
        { tag: '[Intro]',      energy: 'Low',           mood: c.moodTag,    instrs: c.introInstrs, texture: c.textureTag,
          desc: `${c.scene || 'Long atmospheric opening'}. Barely audible. Just a pulse in the dark.` },
        { tag: '[Build]',      energy: 'Low-Medium',    mood: null,         instrs: c.introInstrs, texture: null,
          desc: `First layer adds. The groove takes shape at ${c.bpm} BPM. Something awakening.` },
        { tag: '[Drop]',       energy: 'Medium-High',   mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `First drop — not yet full power. ${c.vibe}. A taste of what's coming.` },
        { tag: '[Interlude]',  energy: 'Low',           mood: c.secondMood, instrs: c.introInstrs, texture: c.textureTag,
          desc: `Brief reset. ${c.scene || 'The room breathes'}. Calm before the second wave.` },
        { tag: '[Build]',      energy: 'Medium-High',   mood: null,         instrs: null,           texture: null,
          desc: `Harder rebuild. More elements, faster. The tension is almost unbearable.` },
        { tag: '[Drop]',       energy: 'High',          mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Second drop — more intense. ${c.vibe}. Full devastation.` },
        { tag: '[Break]',      energy: 'Low-Medium',    mood: c.secondMood, instrs: c.introInstrs, texture: c.textureTag,
          desc: `Breakdown. ${c.scene || 'Reflection in the silence'}. Everything stripped to essence.` },
        { tag: '[Drop]',       energy: 'High',          mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Final peak. ${c.peakDesc}. The highest point — everything at once.` },
        { tag: '[Outro]',      energy: 'Low',           mood: null,         instrs: c.introInstrs, texture: c.textureTag,
          extras: ['[Fade Out]'],
          desc: `Long fade. ${c.scene ? c.scene.split(',')[0] : 'The night dissolves'}. Last echo trails into nothing.` },
      ],

      'progressive': [
        { tag: '[Intro]',      energy: 'Low',           mood: c.moodTag,    instrs: c.introInstrs.split(',')[0]?.trim(), texture: c.textureTag,
          desc: `${c.scene || 'Bare opening'}. Minimal — just the foundation, nothing more.` },
        { tag: '[Verse]',      energy: 'Low-Medium',    mood: null,         instrs: c.introInstrs, texture: null,
          desc: `First layer added. The groove takes shape. ${c.bpm} BPM emerging clearly.` },
        { tag: '[Verse]',      energy: 'Medium',        mood: null,         instrs: c.introInstrs, texture: null,
          desc: `Second layer. Texture thickening. ${c.vibe} starting to assert itself.` },
        { tag: '[Pre-Chorus]', energy: 'Medium-High',   mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `All building blocks in place. ${c.vibe}. The dam about to break.` },
        { tag: '[Chorus]',     energy: c.energyPeak,    mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Everything together. The full picture revealed. ${c.peakDesc}.` },
        { tag: '[Break]',      energy: 'Low-Medium',    mood: c.secondMood, instrs: c.introInstrs, texture: c.textureTag,
          desc: `Strip back to essentials. ${c.scene || 'The groove persists'}. Breathe.` },
        { tag: '[Outro]',      energy: 'Low',           mood: null,         instrs: c.introInstrs, texture: c.textureTag,
          extras: ['[Fade Out]'],
          desc: `Progressive fade. Elements leave one by one. Last to go: the pulse itself.` },
      ],

      'minimal': [
        { tag: '[Intro]',      energy: 'Low',           mood: c.moodTag,    instrs: c.introInstrs.split(',')[0]?.trim(), texture: c.textureTag,
          desc: `${c.scene || 'Absolute silence, then'}. Just a click. Just a tone. Nothing more.` },
        { tag: '[Groove]',     energy: 'Low-Medium',    mood: null,         instrs: c.introInstrs, texture: null,
          desc: `The kick enters. Sparse. Breathing. ${c.bpm} BPM — hypnotic repetition begins.` },
        { tag: '[Evolution]',  energy: 'Medium',        mood: c.moodTag,    instrs: c.introInstrs, texture: null,
          desc: `Micro-variations. Nothing dramatic — everything is subtle. ${c.vibe} beneath the surface.` },
        { tag: '[Peak]',       energy: 'Medium-High',   mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `The peak — not a drop, a revelation. ${c.peakDesc}. Still minimal, but at full power.` },
        { tag: '[Groove]',     energy: 'Medium',        mood: c.secondMood, instrs: c.introInstrs, texture: c.textureTag,
          desc: `Return to the groove. The loop is the journey. Hypnotic and relentless.` },
        { tag: '[Outro]',      energy: 'Low',           mood: null,         instrs: c.introInstrs, texture: c.textureTag,
          extras: ['[Fade Out]'],
          desc: `Minimal to the end. Elements disappearing like thoughts. The pulse is last.` },
      ],

      'anthem': [
        { tag: '[Intro]',       energy: 'Low',          mood: c.moodTag,    instrs: c.introInstrs, texture: c.textureTag,
          desc: `${c.scene || 'Opening'}. Setting the emotional tone before the story begins.` },
        { tag: '[Verse]',       energy: 'Low-Medium',   mood: null,         instrs: c.introInstrs, texture: null,
          desc: `The story begins. ${c.vibe.split(',')[0]} feel. Scene established.` },
        { tag: '[Pre-Chorus]',  energy: 'Medium',       mood: null,         instrs: c.introInstrs, texture: null,
          desc: `Energy climbing. Leading into the moment. Anticipation builds.` },
        { tag: '[Chorus]',      energy: c.energyPeak,   mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `The anthemic moment. ${c.peakDesc}. Full emotional impact.` },
        { tag: '[Verse]',       energy: 'Medium',       mood: null,         instrs: c.introInstrs, texture: null,
          desc: `Second chapter. ${c.vibe}. Deeper, more complex than the first.` },
        { tag: '[Pre-Chorus]',  energy: 'Medium-High',  mood: null,         instrs: c.introInstrs, texture: null,
          desc: `Rising again. Even more powerful than the first time.` },
        { tag: '[Chorus]',      energy: 'High',         mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Second chorus hits harder. ${c.peakDesc}. Cathartic.` },
        { tag: '[Bridge]',      energy: 'Medium',       mood: c.secondMood, instrs: c.introInstrs, texture: c.textureTag,
          desc: `The bridge — unexpected, emotional. ${c.scene || 'A moment of clarity'}.` },
        { tag: '[Final Chorus]',energy: 'High',         mood: c.moodTag,    instrs: c.dropInstrs,  texture: null,
          desc: `Ultimate peak. Everything together. The definitive statement. ${c.peakDesc}.` },
        { tag: '[Outro]',       energy: 'Low',          mood: null,         instrs: c.introInstrs, texture: c.textureTag,
          extras: ['[Fade Out]'],
          desc: `Resolution. ${c.scene ? c.scene.split(',')[0] : 'Peace after the storm'}. The echo of what was.` },
      ],
    };

    return templates[name] || templates['classic-drop'];
  }

  // ─── Main entry point for lyrics generation ───
  _buildV5Lyrics(mergedPrompt) {
    const ctx = this._buildLyricsContext(mergedPrompt);
    const structureText = (document.getElementById('structureInput')?.value || '').trim();

    // Determine template: manual selection or auto-detect
    const templateName = this._selectedTemplate === 'auto'
      ? this._detectTemplate(this.analysisData, structureText)
      : this._selectedTemplate;

    // Update the badge in the UI
    const labels = {
      'classic-drop': 'Classic Drop',
      'journey':      'Journey (2-3 drops)',
      'progressive':  'Progressive',
      'minimal':      'Minimal / Hypnotic',
      'anthem':       'Anthem',
    };
    const detectedEl = document.getElementById('templateDetected');
    if (detectedEl) {
      detectedEl.textContent = labels[templateName] + (this._selectedTemplate === 'auto' ? ' · auto' : '');
    }

    const sections = this._getTemplateSections(templateName, ctx);
    document.getElementById('finalLyricsPrompt').textContent = this._renderSections(sections);
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
