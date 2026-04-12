/**
 * Music DNA - Audio Editor (Post-prod)
 * Cut, reorder, merge audio tracks and export as single file
 * Uses Web Audio API + lamejs for MP3 encoding
 */

class AudioEditor {
  constructor() {
    this.audioContext = null;
    this.tracks = []; // { id, name, file, buffer, startTrim, endTrim, canvas }
    this.trackIdCounter = 0;
    this.isPlaying = false;
    this.currentSource = null;
    this.draggedTrack = null;
    this.playheadRAF = null;
    this.playingTrackId = null;
    // Selection state
    this.selectionTrackId = null;
    this.selectionStart = null; // seconds
    this.selectionEnd = null;   // seconds
  }

  init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this._setupDropZone();
    this._setupControls();
    this._setupExport();
  }

  // ─── File Import ───
  _setupDropZone() {
    const dropZone = document.getElementById('editorDropZone');
    const fileInput = document.getElementById('editorFileInput');
    const browseBtn = document.getElementById('editorBrowseBtn');

    browseBtn.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('click', (e) => {
      if (e.target !== browseBtn) fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      this._addFiles(Array.from(e.target.files));
      fileInput.value = '';
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
      this._addFiles(files);
    });
  }

  async _addFiles(files) {
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);

        const track = {
          id: this.trackIdCounter++,
          name: file.name.replace(/\.[^.]+$/, ''),
          file,
          buffer,
          startTrim: 0,        // seconds from start to trim
          endTrim: buffer.duration, // seconds from start where track ends
          volume: 1.0
        };

        this.tracks.push(track);
      } catch (err) {
        console.error(`Failed to decode ${file.name}:`, err);
      }
    }

    this._renderTimeline();
    this._updateControls();
  }

  // ─── Timeline Rendering ───
  _renderTimeline() {
    const container = document.getElementById('editorTimeline');
    const empty = document.getElementById('timelineEmpty');

    if (this.tracks.length === 0) {
      empty.classList.remove('hidden');
      container.querySelectorAll('.track-item, .selection-actions').forEach(el => el.remove());
      return;
    }

    empty.classList.add('hidden');

    // Remove old tracks and selection bars
    container.querySelectorAll('.track-item, .selection-actions').forEach(el => el.remove());

    this.tracks.forEach((track, index) => {
      const el = document.createElement('div');
      el.className = 'track-item';
      el.dataset.trackId = track.id;
      el.draggable = true;

      const duration = track.endTrim - track.startTrim;

      el.innerHTML = `
        <div class="track-handle" title="Glisse pour reordonner">&#9776;</div>
        <div class="track-info">
          <div class="track-name">${index + 1}. ${track.name}</div>
          <div class="track-duration">${this._formatTime(duration)} / ${this._formatTime(track.buffer.duration)}</div>
        </div>
        <div class="track-waveform-container">
          <canvas class="track-waveform" width="400" height="60"></canvas>
          <div class="track-trim-left" data-track="${track.id}" title="Glisse pour couper le debut"></div>
          <div class="track-trim-right" data-track="${track.id}" title="Glisse pour couper la fin"></div>
          <div class="track-region" data-track="${track.id}"></div>
          <div class="track-playhead" data-track="${track.id}"></div>
          <div class="track-selection" data-track="${track.id}"></div>
        </div>
        <div class="track-actions">
          <button class="btn btn-sm btn-outline track-play-btn" data-track="${track.id}" title="Ecouter ce morceau">&#9654;</button>
          <button class="btn btn-sm btn-outline track-delete-btn" data-track="${track.id}" title="Supprimer">&#10005;</button>
        </div>
      `;

      // Selection actions bar — outside the track-item so it doesn't affect its layout
      const selBar = document.createElement('div');
      selBar.className = 'selection-actions hidden';
      selBar.dataset.trackId = track.id;
      selBar.innerHTML = `
        <button class="btn btn-sm btn-outline sel-cut-btn" data-track="${track.id}">&#9986; Couper la selection</button>
        <button class="btn btn-sm btn-outline sel-dup-btn" data-track="${track.id}">&#10697; Dupliquer la selection</button>
        <button class="btn btn-sm btn-outline sel-cancel-btn" data-track="${track.id}">&#10005; Annuler</button>
      `;

      container.appendChild(el);
      container.appendChild(selBar);

      // Draw waveform
      const canvas = el.querySelector('.track-waveform');
      this._drawTrackWaveform(canvas, track);

      // Draw trim region
      this._updateTrimVisual(el, track);

      // Events
      el.querySelector('.track-play-btn').addEventListener('click', () => this._playTrack(track, el));
      el.querySelector('.track-delete-btn').addEventListener('click', () => this._removeTrack(track.id));

      // Selection events
      this._setupSelection(el, track);

      // Selection action buttons (on selBar, outside track-item)
      selBar.querySelector('.sel-cut-btn').addEventListener('click', () => this._cutSelection(track.id));
      selBar.querySelector('.sel-dup-btn').addEventListener('click', () => this._duplicateSelection(track.id));
      selBar.querySelector('.sel-cancel-btn').addEventListener('click', () => this._clearSelection(track.id));

      // Drag to reorder
      el.addEventListener('dragstart', (e) => {
        this.draggedTrack = track.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        this.draggedTrack = null;
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this.draggedTrack !== null && this.draggedTrack !== track.id) {
          el.classList.add('drag-target');
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-target');
        if (this.draggedTrack !== null && this.draggedTrack !== track.id) {
          this._reorderTrack(this.draggedTrack, track.id);
        }
      });

      // Trim handles
      this._setupTrimHandles(el, track);
    });
  }

  _drawTrackWaveform(canvas, track) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const data = track.buffer.getChannelData(0);

    ctx.clearRect(0, 0, width, height);

    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j] || 0;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      const x = i / width;
      const trimStart = track.startTrim / track.buffer.duration;
      const trimEnd = track.endTrim / track.buffer.duration;
      const inRegion = x >= trimStart && x <= trimEnd;

      ctx.fillStyle = inRegion
        ? `rgba(124, 58, 237, ${0.4 + Math.abs(max - min) * 0.6})`
        : 'rgba(180, 180, 190, 0.3)';
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }

  _updateTrimVisual(el, track) {
    const region = el.querySelector('.track-region');
    const leftHandle = el.querySelector('.track-trim-left');
    const rightHandle = el.querySelector('.track-trim-right');
    const container = el.querySelector('.track-waveform-container');

    const leftPct = (track.startTrim / track.buffer.duration) * 100;
    const rightPct = (track.endTrim / track.buffer.duration) * 100;

    region.style.left = leftPct + '%';
    region.style.width = (rightPct - leftPct) + '%';
    leftHandle.style.left = leftPct + '%';
    rightHandle.style.left = rightPct + '%';
  }

  _setupTrimHandles(el, track) {
    const container = el.querySelector('.track-waveform-container');
    const leftHandle = el.querySelector('.track-trim-left');
    const rightHandle = el.querySelector('.track-trim-right');

    const makeDraggable = (handle, isLeft) => {
      let isDragging = false;

      handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const rect = container.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const time = pct * track.buffer.duration;

        if (isLeft) {
          track.startTrim = Math.min(time, track.endTrim - 0.5);
        } else {
          track.endTrim = Math.max(time, track.startTrim + 0.5);
        }

        this._updateTrimVisual(el, track);
        this._drawTrackWaveform(el.querySelector('.track-waveform'), track);

        // Update duration display
        const dur = track.endTrim - track.startTrim;
        el.querySelector('.track-duration').textContent =
          `${this._formatTime(dur)} / ${this._formatTime(track.buffer.duration)}`;

        this._updateTotalTime();
      });

      document.addEventListener('mouseup', () => { isDragging = false; });
    };

    makeDraggable(leftHandle, true);
    makeDraggable(rightHandle, false);
  }

  // ─── Track Operations ───
  _removeTrack(id) {
    this.tracks = this.tracks.filter(t => t.id !== id);
    this._renderTimeline();
    this._updateControls();
  }

  _reorderTrack(fromId, toId) {
    const fromIdx = this.tracks.findIndex(t => t.id === fromId);
    const toIdx = this.tracks.findIndex(t => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = this.tracks.splice(fromIdx, 1);
    this.tracks.splice(toIdx, 0, moved);
    this._renderTimeline();
  }

  _playTrack(track, trackEl) {
    // If same track is playing, toggle pause
    if (this.isPlaying && this.playingTrackId === track.id) {
      this._stopPlayback();
      return;
    }
    this._startPlayback(track, track.startTrim);
  }

  // Unified playback: plays a track from any position, handles playhead + timer
  _startPlayback(track, fromTime) {
    this._stopPlayback();

    // Increment play session so old animations die cleanly
    this._playSession = (this._playSession || 0) + 1;
    const session = this._playSession;

    fromTime = Math.max(track.startTrim, Math.min(fromTime, track.endTrim));
    const remainingDuration = track.endTrim - fromTime;
    if (remainingDuration < 0.05) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = track.buffer;
    source.connect(this.audioContext.destination);
    source.start(0, fromTime, remainingDuration);
    this.currentSource = source;
    this.isPlaying = true;
    this.playingTrackId = track.id;

    // Toggle play button to pause icon
    const playBtn = document.querySelector(`.track-play-btn[data-track="${track.id}"]`);
    if (playBtn) playBtn.innerHTML = '&#9646;&#9646;';

    // Playhead + timer
    const playhead = document.querySelector(`.track-playhead[data-track="${track.id}"]`);
    const timeDisplay = document.getElementById('editorPlaybackTime');
    const ctxStartTime = this.audioContext.currentTime;
    const totalDuration = track.endTrim - track.startTrim;
    const elapsedOffset = fromTime - track.startTrim;
    const trimStartPct = track.startTrim / track.buffer.duration;
    const fromPct = fromTime / track.buffer.duration;
    const trimEndPct = track.endTrim / track.buffer.duration;

    if (playhead) playhead.classList.add('active');
    if (timeDisplay) {
      timeDisplay.style.display = 'inline';
      timeDisplay.textContent = this._formatTime(elapsedOffset) + ' / ' + this._formatTime(totalDuration);
    }

    const animate = () => {
      // Stop if session changed (another play/stop happened)
      if (this._playSession !== session) return;

      const elapsed = this.audioContext.currentTime - ctxStartTime;
      const pct = fromPct + (elapsed / track.buffer.duration);
      if (playhead) playhead.style.left = (Math.min(pct, trimEndPct) * 100) + '%';
      if (timeDisplay) timeDisplay.textContent = this._formatTime(elapsedOffset + elapsed) + ' / ' + this._formatTime(totalDuration);

      if (elapsed < remainingDuration) {
        this.playheadRAF = requestAnimationFrame(animate);
      } else {
        if (playhead) playhead.classList.remove('active');
        if (timeDisplay) timeDisplay.style.display = 'none';
      }
    };
    this.playheadRAF = requestAnimationFrame(animate);

    source.onended = () => {
      if (this._playSession !== session) return; // stale callback
      this.isPlaying = false;
      this.playingTrackId = null;
      if (playhead) playhead.classList.remove('active');
      if (timeDisplay) timeDisplay.style.display = 'none';
      const btn = document.querySelector(`.track-play-btn[data-track="${track.id}"]`);
      if (btn) btn.innerHTML = '&#9654;';
    };
  }

  // ─── Controls ───
  _setupControls() {
    document.getElementById('editorPlayAll').addEventListener('click', () => this._playAll());
    document.getElementById('editorStop').addEventListener('click', () => this._stopPlayback());

    // Range sliders
    ['crossfadeDuration', 'gapDuration', 'fadeIn', 'fadeOut'].forEach(id => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id.replace('Duration', 'Value').replace('fadeIn', 'fadeInValue').replace('fadeOut', 'fadeOutValue'));
      // Fix value element ids
      const valueId = id === 'crossfadeDuration' ? 'crossfadeValue'
        : id === 'gapDuration' ? 'gapValue'
        : id === 'fadeIn' ? 'fadeInValue'
        : 'fadeOutValue';
      const valueEl = document.getElementById(valueId);

      el.addEventListener('input', () => {
        valueEl.textContent = el.value + 's';
        this._updateTotalTime();
      });
    });
  }

  _updateControls() {
    const controls = document.getElementById('editorControls');
    if (this.tracks.length > 0) {
      controls.classList.remove('hidden');
    } else {
      controls.classList.add('hidden');
    }
    this._updateTotalTime();
  }

  _updateTotalTime() {
    const gap = parseFloat(document.getElementById('gapDuration').value) || 0;
    let total = 0;
    this.tracks.forEach((t, i) => {
      total += t.endTrim - t.startTrim;
      if (i < this.tracks.length - 1) total += gap;
    });
    document.getElementById('editorTotalTime').textContent = `Total: ${this._formatTime(total)}`;
  }

  async _playAll() {
    this._stopPlayback();
    if (this.tracks.length === 0) return;

    this._playSession = (this._playSession || 0) + 1;
    const session = this._playSession;

    const merged = await this._mergeBuffers();
    const source = this.audioContext.createBufferSource();
    source.buffer = merged;
    source.connect(this.audioContext.destination);
    source.start();
    this.currentSource = source;
    this.isPlaying = true;
    this.playingTrackId = '__all__';
    document.getElementById('playIcon').textContent = '⏸';

    // Build a timeline: at which second does each track start/end in the merged output
    const gap = parseFloat(document.getElementById('gapDuration').value) || 0;
    const crossfade = parseFloat(document.getElementById('crossfadeDuration').value) || 0;
    const segments = [];
    let cursor = 0;
    this.tracks.forEach((track, i) => {
      const dur = track.endTrim - track.startTrim;
      segments.push({
        track,
        mergedStart: cursor,
        mergedEnd: cursor + dur,
        trimStart: track.startTrim,
        trimEnd: track.endTrim,
        bufferDuration: track.buffer.duration
      });
      cursor += dur;
      if (i < this.tracks.length - 1) {
        cursor += crossfade > 0 ? -crossfade : gap;
      }
    });

    const ctxStartTime = this.audioContext.currentTime;
    const totalDuration = merged.duration;
    const timeDisplay = document.getElementById('editorPlaybackTime');
    if (timeDisplay) { timeDisplay.style.display = 'inline'; timeDisplay.textContent = '0:00'; }

    let activePlayhead = null;

    const animateAll = () => {
      if (this._playSession !== session) return;

      const elapsed = this.audioContext.currentTime - ctxStartTime;
      if (timeDisplay) timeDisplay.textContent = this._formatTime(elapsed) + ' / ' + this._formatTime(totalDuration);

      // Find which segment we're in and move the playhead on that track
      let foundSegment = null;
      for (const seg of segments) {
        if (elapsed >= seg.mergedStart && elapsed < seg.mergedEnd) {
          foundSegment = seg;
          break;
        }
      }

      // Hide previous playhead if we moved to a different track
      if (foundSegment) {
        const newPlayhead = document.querySelector(`.track-playhead[data-track="${foundSegment.track.id}"]`);
        if (activePlayhead && activePlayhead !== newPlayhead) {
          activePlayhead.classList.remove('active');
        }
        activePlayhead = newPlayhead;

        if (activePlayhead) {
          activePlayhead.classList.add('active');
          const progressInSegment = (elapsed - foundSegment.mergedStart) / (foundSegment.mergedEnd - foundSegment.mergedStart);
          const trimStartPct = foundSegment.trimStart / foundSegment.bufferDuration;
          const trimEndPct = foundSegment.trimEnd / foundSegment.bufferDuration;
          const pct = trimStartPct + progressInSegment * (trimEndPct - trimStartPct);
          activePlayhead.style.left = (pct * 100) + '%';
        }
      } else if (activePlayhead) {
        activePlayhead.classList.remove('active');
        activePlayhead = null;
      }

      if (elapsed < totalDuration) {
        this.playheadRAF = requestAnimationFrame(animateAll);
      } else {
        if (activePlayhead) activePlayhead.classList.remove('active');
        if (timeDisplay) timeDisplay.style.display = 'none';
      }
    };
    this.playheadRAF = requestAnimationFrame(animateAll);

    source.onended = () => {
      if (this._playSession !== session) return;
      this.isPlaying = false;
      this.playingTrackId = null;
      document.getElementById('playIcon').textContent = '▶';
      if (activePlayhead) activePlayhead.classList.remove('active');
      if (timeDisplay) timeDisplay.style.display = 'none';
    };
  }

  _stopPlayback() {
    // Kill session so any running animation/onended callback stops
    this._playSession = (this._playSession || 0) + 1;

    if (this.currentSource) {
      this.currentSource.onended = null;
      try { this.currentSource.stop(); } catch (e) {}
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.playingTrackId = null;
    if (this.playheadRAF) {
      cancelAnimationFrame(this.playheadRAF);
      this.playheadRAF = null;
    }
    // Hide all playheads + time display + reset buttons
    document.querySelectorAll('.track-playhead').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.track-play-btn').forEach(btn => btn.innerHTML = '&#9654;');
    const timeDisplay = document.getElementById('editorPlaybackTime');
    if (timeDisplay) timeDisplay.style.display = 'none';
    document.getElementById('playIcon').textContent = '▶';
  }

  // ─── Selection on Waveform ───
  _setupSelection(el, track) {
    const container = el.querySelector('.track-waveform-container');
    const selectionEl = el.querySelector('.track-selection');
    let isSelecting = false;
    let hasDragged = false;
    let startX = 0;

    container.addEventListener('mousedown', (e) => {
      // Ignore if clicking on trim handles
      if (e.target.classList.contains('track-trim-left') || e.target.classList.contains('track-trim-right')) return;
      isSelecting = true;
      hasDragged = false;
      const rect = container.getBoundingClientRect();
      startX = (e.clientX - rect.left) / rect.width;
      startX = Math.max(0, Math.min(1, startX));
      this._clearSelection();
      this.selectionTrackId = track.id;
      this.selectionStart = startX * track.buffer.duration;
      this.selectionEnd = this.selectionStart;
      selectionEl.style.left = (startX * 100) + '%';
      selectionEl.style.width = '0%';
      selectionEl.classList.add('active');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isSelecting || this.selectionTrackId !== track.id) return;
      hasDragged = true;
      const rect = container.getBoundingClientRect();
      let currentX = (e.clientX - rect.left) / rect.width;
      currentX = Math.max(0, Math.min(1, currentX));
      const left = Math.min(startX, currentX);
      const right = Math.max(startX, currentX);
      selectionEl.style.left = (left * 100) + '%';
      selectionEl.style.width = ((right - left) * 100) + '%';
      this.selectionStart = left * track.buffer.duration;
      this.selectionEnd = right * track.buffer.duration;
    });

    document.addEventListener('mouseup', () => {
      if (!isSelecting || this.selectionTrackId !== track.id) return;
      isSelecting = false;

      // If user just clicked (no drag) → seek playhead to that position
      if (!hasDragged || (this.selectionEnd - this.selectionStart) < 0.1) {
        selectionEl.classList.remove('active');
        this.selectionTrackId = null;
        const seekTime = startX * track.buffer.duration;
        this._seekTrack(track, el, seekTime);
        return;
      }

      // Show action buttons (selBar is the next sibling of el)
      const selBar = el.nextElementSibling;
      if (selBar && selBar.classList.contains('selection-actions')) {
        selBar.classList.remove('hidden');
      }
    });
  }

  // Seek: restart playback from a given position
  _seekTrack(track, trackEl, seekTime) {
    this._startPlayback(track, seekTime);
  }

  _clearSelection() {
    document.querySelectorAll('.track-selection').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.selection-actions').forEach(a => a.classList.add('hidden'));
    this.selectionTrackId = null;
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  _cutSelection(trackId) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track || this.selectionStart == null) return;

    const sr = track.buffer.sampleRate;
    const numCh = track.buffer.numberOfChannels;
    const cutStart = Math.floor(this.selectionStart * sr);
    const cutEnd = Math.floor(this.selectionEnd * sr);
    const totalLen = track.buffer.length;

    // New buffer = everything before cutStart + everything after cutEnd
    const newLen = totalLen - (cutEnd - cutStart);
    if (newLen < sr * 0.1) return; // don't cut everything

    const newBuffer = this.audioContext.createBuffer(numCh, newLen, sr);
    for (let ch = 0; ch < numCh; ch++) {
      const oldData = track.buffer.getChannelData(ch);
      const newData = newBuffer.getChannelData(ch);
      // Copy before selection
      for (let i = 0; i < cutStart; i++) newData[i] = oldData[i];
      // Copy after selection
      for (let i = cutEnd; i < totalLen; i++) newData[cutStart + (i - cutEnd)] = oldData[i];
    }

    track.buffer = newBuffer;
    // Adjust trim points
    const cutDuration = this.selectionEnd - this.selectionStart;
    if (track.endTrim > this.selectionEnd) {
      track.endTrim -= cutDuration;
    } else if (track.endTrim > this.selectionStart) {
      track.endTrim = this.selectionStart;
    }
    if (track.startTrim > this.selectionEnd) {
      track.startTrim -= cutDuration;
    } else if (track.startTrim > this.selectionStart) {
      track.startTrim = this.selectionStart;
    }
    track.endTrim = Math.min(track.endTrim, newBuffer.duration);
    track.startTrim = Math.min(track.startTrim, track.endTrim);

    this._clearSelection();
    this._renderTimeline();
    this._updateControls();
  }

  _duplicateSelection(trackId) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track || this.selectionStart == null) return;

    const sr = track.buffer.sampleRate;
    const numCh = track.buffer.numberOfChannels;
    const selStart = Math.floor(this.selectionStart * sr);
    const selEnd = Math.floor(this.selectionEnd * sr);
    const selLen = selEnd - selStart;

    // Create a new track from the selection
    const newBuffer = this.audioContext.createBuffer(numCh, selLen, sr);
    for (let ch = 0; ch < numCh; ch++) {
      const src = track.buffer.getChannelData(ch);
      const dst = newBuffer.getChannelData(ch);
      for (let i = 0; i < selLen; i++) dst[i] = src[selStart + i];
    }

    const newTrack = {
      id: this.trackIdCounter++,
      name: track.name + ' (extrait)',
      file: null,
      buffer: newBuffer,
      startTrim: 0,
      endTrim: newBuffer.duration,
      volume: 1.0
    };

    // Insert right after the source track
    const idx = this.tracks.findIndex(t => t.id === trackId);
    this.tracks.splice(idx + 1, 0, newTrack);

    this._clearSelection();
    this._renderTimeline();
    this._updateControls();
  }

  // ─── Merge Buffers ───
  async _mergeBuffers() {
    const sampleRate = this.audioContext.sampleRate;
    const gap = parseFloat(document.getElementById('gapDuration').value) || 0;
    const crossfade = parseFloat(document.getElementById('crossfadeDuration').value) || 0;
    const fadeInSec = parseFloat(document.getElementById('fadeIn').value) || 0;
    const fadeOutSec = parseFloat(document.getElementById('fadeOut').value) || 0;

    // Calculate total length
    let totalSamples = 0;
    const segments = [];

    this.tracks.forEach((track, i) => {
      const startSample = Math.floor(track.startTrim * sampleRate);
      const endSample = Math.floor(track.endTrim * sampleRate);
      const length = endSample - startSample;
      segments.push({ track, startSample, endSample, length });
      totalSamples += length;
      if (i < this.tracks.length - 1) {
        if (crossfade > 0) {
          totalSamples -= Math.floor(crossfade * sampleRate);
        } else {
          totalSamples += Math.floor(gap * sampleRate);
        }
      }
    });

    totalSamples = Math.max(totalSamples, 1);
    const numChannels = Math.max(...this.tracks.map(t => t.buffer.numberOfChannels), 1);
    const outputBuffer = this.audioContext.createBuffer(numChannels, totalSamples, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const output = outputBuffer.getChannelData(ch);
      let writePos = 0;

      segments.forEach((seg, i) => {
        const channelIdx = Math.min(ch, seg.track.buffer.numberOfChannels - 1);
        const input = seg.track.buffer.getChannelData(channelIdx);
        const volume = seg.track.volume || 1.0;

        for (let j = 0; j < seg.length && (writePos + j) < totalSamples; j++) {
          const srcIdx = seg.startSample + j;
          if (srcIdx < input.length) {
            output[writePos + j] += input[srcIdx] * volume;
          }
        }

        writePos += seg.length;
        if (i < segments.length - 1) {
          if (crossfade > 0) {
            writePos -= Math.floor(crossfade * sampleRate);
          } else {
            writePos += Math.floor(gap * sampleRate);
          }
        }
      });

      // Apply global fade-in
      if (fadeInSec > 0) {
        const fadeSamples = Math.floor(fadeInSec * sampleRate);
        for (let i = 0; i < fadeSamples && i < totalSamples; i++) {
          output[i] *= i / fadeSamples;
        }
      }

      // Apply global fade-out
      if (fadeOutSec > 0) {
        const fadeSamples = Math.floor(fadeOutSec * sampleRate);
        for (let i = 0; i < fadeSamples && i < totalSamples; i++) {
          const idx = totalSamples - 1 - i;
          output[idx] *= i / fadeSamples;
        }
      }
    }

    return outputBuffer;
  }

  // ─── Export ───
  _setupExport() {
    document.getElementById('exportBtn').addEventListener('click', () => this._export());
  }

  async _export() {
    if (this.tracks.length === 0) return;

    const format = document.getElementById('exportFormat').value;
    const filename = document.getElementById('exportFilename').value || 'music-dna-export';
    const progressEl = document.getElementById('exportProgress');
    const fillEl = document.getElementById('exportFill');
    const textEl = document.getElementById('exportText');

    progressEl.classList.remove('hidden');
    fillEl.style.width = '10%';
    textEl.textContent = 'Fusion des morceaux...';

    try {
      const merged = await this._mergeBuffers();
      fillEl.style.width = '40%';
      textEl.textContent = 'Encodage...';

      let blob;
      if (format === 'wav') {
        blob = this._bufferToWav(merged);
        fillEl.style.width = '90%';
      } else {
        blob = await this._bufferToMp3(merged, (progress) => {
          fillEl.style.width = (40 + progress * 50) + '%';
        });
      }

      fillEl.style.width = '100%';
      textEl.textContent = 'Telechargement...';

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setTimeout(() => {
        textEl.textContent = 'Export termine !';
        setTimeout(() => progressEl.classList.add('hidden'), 2000);
      }, 500);

    } catch (err) {
      console.error('Export error:', err);
      textEl.textContent = 'Erreur: ' + err.message;
    }
  }

  _bufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const headerSize = 44;
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave samples
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = buffer.getChannelData(ch)[i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  async _bufferToMp3(buffer, onProgress) {
    const bitrate = parseInt(document.getElementById('mp3Bitrate').value) || 320;
    const sampleRate = buffer.sampleRate;
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const samples = buffer.length;

    // Check if lamejs is available
    if (typeof lamejs === 'undefined') {
      throw new Error('lamejs not loaded. Export as WAV instead.');
    }

    const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrate);
    const mp3Data = [];
    const blockSize = 1152;

    const left = this._floatTo16BitPCM(buffer.getChannelData(0));
    const right = numChannels > 1
      ? this._floatTo16BitPCM(buffer.getChannelData(1))
      : left;

    for (let i = 0; i < samples; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      const rightChunk = right.subarray(i, i + blockSize);

      let mp3buf;
      if (numChannels === 1) {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      if (onProgress && i % (blockSize * 100) === 0) {
        onProgress(i / samples);
        await new Promise(r => setTimeout(r, 0)); // yield
      }
    }

    const end = mp3encoder.flush();
    if (end.length > 0) mp3Data.push(end);

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  _floatTo16BitPCM(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

window.AudioEditor = AudioEditor;
