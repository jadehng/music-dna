# Music DNA

Complete web app for music production workflow with Suno AI. Analyze reference tracks, build optimized prompts, and edit/mix audio — all in the browser.

## Features

### Pre-prod: Analyze & Prompt

- **Audio analysis** — Upload MP3/WAV/FLAC or paste a YouTube URL to extract:
  - BPM (essentia.js PercivalBpmEstimator + autocorrelation fallback)
  - Key & scale (essentia.js KeyExtractor + chromagram fallback)
  - Energy, spectral profile, bass weight, brightness, complexity
  - **ML mood detection** — happy, sad, aggressive, relaxed (MusiCNN models via TensorFlow.js)
  - **ML danceability** scoring
  - **ML genre classification** (blues, classical, country, disco, hiphop, jazz, metal, pop, reggae, rock)

- **Prompt Studio** — Build Suno v5/v5.5 optimized prompts:
  - Auto-generated prompt from analysis (genre, BPM, key, mood, energy, texture)
  - Creative vision textarea with French-to-English translation
  - 80+ inspiration chips (scenes, ambiances, sounds, genres, Suno v5 metatags)
  - Fusion engine: merges auto-analysis + creative input into final Style Prompt
  - **Suno v5 Lyrics generator** with metatags: `[Mood:]`, `[Energy:]`, `[Instrument:]`, `[Texture:]`, `[Fade Out]`, `[Drop]`, `[Break]`
  - Respects Suno v5 rules: max 2 genres, ~200 char style limit, narrative blueprint format

### Post-prod: Edit, Mix & Export

- **Multi-track editor** — Import audio files (MP3, WAV, FLAC) or video files (MP4, MOV, MKV, AVI, WebM — audio extracted automatically)
- **Per-track controls:**
  - Volume slider (0–150%) + mute toggle
  - Trim handles (drag to cut start/end)
  - Click-to-seek playhead
  - Drag-to-select regions (cut, duplicate)
  - Drag-to-reorder tracks
- **Dialogue/music isolation** (stereo tracks):
  - "Voix" button — extracts center channel (dialogue, vocals)
  - "Musique" button — removes center, keeps sides (background music)
- **Two mix modes:**
  - **Sequence** — tracks play one after another (with crossfade/gap controls)
  - **Superposition** — tracks play simultaneously with per-track time offset ("Debut a" field to place a clip at any point in the mix)
- **Export** — MP3 (128–320 kbps) or WAV, with global fade-in/fade-out

## Tech Stack

- **Frontend:** Vanilla JS, HTML, CSS (no framework)
- **Audio analysis:** [essentia.js](https://essentia.upf.edu/essentiajs/) WASM + Web Audio API
- **ML models:** TensorFlow.js + essentia MusiCNN-MSD models (mood, danceability, genre)
- **MP3 encoding:** [lamejs](https://github.com/zhuker/lamejs) (client-side)
- **YouTube extraction:** yt-dlp via Netlify serverless function
- **Hosting:** Netlify (static site + functions)

## ML Models

Six pre-trained MusiCNN models in `models/`:

| Model | Task | Output |
|-------|------|--------|
| `mood_happy` | Mood classification | happy vs not-happy |
| `mood_sad` | Mood classification | sad vs not-sad |
| `mood_aggressive` | Mood classification | aggressive vs not-aggressive |
| `mood_relaxed` | Mood classification | relaxed vs not-relaxed |
| `danceability` | Danceability scoring | danceable vs not-danceable |
| `genre_tzanetakis` | Genre classification | 10 genres (blues, classical, country, disco, hiphop, jazz, metal, pop, reggae, rock) |

Models are loaded from [essentia.upf.edu](https://essentia.upf.edu/essentiajs/) and run entirely in the browser via TensorFlow.js.

## Local Development

```bash
npm install
npx netlify dev --port 8888
```

Open `http://localhost:8888`

## Project Structure

```
music-analyzer/
  index.html          # Main UI (pre-prod + post-prod tabs)
  style.css           # All styles
  app.js              # Main app logic, file/YouTube handling, results display
  audio-analyzer.js   # DSP + ML analysis engine (essentia.js + TF.js)
  prompt-studio.js    # Suno v5 prompt builder + lyrics generator
  audio-editor.js     # Multi-track editor, mix, export
  models/             # TF.js MusiCNN models (mood, genre, danceability)
  netlify/
    functions/
      youtube-audio.js  # Serverless function for YouTube audio extraction (yt-dlp)
  package.json
```

## Usage

1. **Pre-prod:** Upload a reference track or paste a YouTube URL. Review the analysis, write your creative vision, click "Fusionner" to get a Suno-ready Style Prompt + Lyrics.
2. **Post-prod:** Import your Suno-generated tracks (+ film clips if needed), trim, reorder, overlay at specific timestamps, adjust volumes, and export the final mix.

## License

MIT
