// Audio playback engine: native (mp3/aac) + hls.js (m3u8), retry + failover.
export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.hls = null;
    this.current = null;
    this.state = 'idle'; // idle | loading | live | paused | error
    this.listeners = new Set();
    this.retries = 0;
    this._playId = 0;
    this._stallTimer = null;
    // ---- equalizer (Web Audio) ----
    this._eqCtx = null;        // AudioContext (lazily created on user gesture)
    this._eqSrc = null;        // MediaElementAudioSourceNode
    this._eqBands = null;      // [lowShelf, peaking..., highShelf]
    this._eqPreset = 'flat';
    this._eqReady = false;
    this._savedVolume = Number(localStorage.getItem('orbis.volume') ?? 0.8);
    if (!Number.isFinite(this._savedVolume)) this._savedVolume = 0.8;
    this.audio.volume = this._savedVolume;
    this.audio.muted = localStorage.getItem('orbis.muted') === '1';
    this.onAutoplayBlocked = null;

    const a = this.audio;
    a.addEventListener('playing', () => {
      this._setState('live');
      this._updateMediaSession('playing');
    });
    a.addEventListener('pause', () => {
      if (this.state !== 'loading') {
        this._setState('paused');
        this._updateMediaSession('paused');
      }
    });
    a.addEventListener('waiting', () => {
      if (this.state !== 'loading') this._setState('loading');
      this._armStall(18000);
    });
    a.addEventListener('canplay', () => this._clearStall());
    a.addEventListener('error', () => this._handleError());
    a.addEventListener('stalled', () => this._armStall(18000));

    this._setupMediaSession();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _setState(state) {
    this.state = state;
    for (const fn of this.listeners) fn(state, this.current);
  }

  _clearStall() {
    if (this._stallTimer) clearTimeout(this._stallTimer);
    this._stallTimer = null;
  }

  _armStall(ms) {
    this._clearStall();
    this._stallTimer = setTimeout(() => {
      if (this.state === 'loading') this._handleError();
    }, ms);
  }

  _destroyHls() {
    if (this.hls) {
      try { this.hls.destroy(); } catch {}
      this.hls = null;
    }
  }

  // Wrap audio.play() so a browser autoplay refusal is distinguished from a
  // dead stream: the station stays selected in "paused" for one click to start.
  _attemptPlay(playId) {
    const p = this.audio.play();
    if (p && typeof p.then === 'function') {
      p.catch((err) => {
        if (playId !== this._playId) return;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          this._clearStall();
          this._setState('paused');
          this.onAutoplayBlocked && this.onAutoplayBlocked();
        } else {
          this._handleError(playId);
        }
      });
    }
  }

  play(station) {
    if (!station) return;
    this.current = station;
    this._playId++;
    this.retries = 0;
    this._clearStall();
    this._setState('loading');
    localStorage.setItem('orbis.lastStation', station.url);
    this._setMediaMetadata(station);
    this._connect(station, this._playId);
  }

  // Fresh manual retry from the error state (play button / re-select).
  retry() {
    if (!this.current) return;
    this.play(this.current);
  }

  _connect(station, playId = this._playId) {
    this._destroyHls();
    const a = this.audio;
    const stale = () => playId !== this._playId;
    const isHls = station.kind === 'hls' || /\.m3u8(\?|$)/i.test(station.url);
    if (isHls) {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: false,
          manifestLoadingTimeOut: 15000,
          levelLoadingTimeOut: 15000,
          fragLoadingTimeOut: 20000,
        });
        this.hls = hls;
        hls.attachMedia(a);
        hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
          if (!stale()) hls.loadSource(station.url);
        });
        hls.on(window.Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal || stale()) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && this.retries < 2) {
            this.retries++;
            try { hls.startLoad(); } catch {}
            return;
          }
          if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && this.retries < 2) {
            this.retries++;
            try { hls.recoverMediaError(); } catch {}
            return;
          }
          this._handleError(playId);
        });
        this._attemptPlay(playId);
        return;
      }
      // Safari native HLS
      if (a.canPlayType('application/vnd.apple.mpegurl')) {
        a.src = station.url;
        this._attemptPlay(playId);
        return;
      }
      this._handleError(playId);
      return;
    }
    a.src = station.url;
    this._attemptPlay(playId);
  }

  _handleError(playId = this._playId) {
    if (!this.current || playId !== this._playId) return;
    if (this.state === 'live') return;
    if (this.retries < 1) {
      this.retries++;
      this._setState('loading');
      setTimeout(() => {
        if (this.current && playId === this._playId) this._connect(this.current, playId);
      }, 700);
      return;
    }
    this._clearStall();
    this._setState('error');
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.resume();
    else this.audio.pause();
  }

  resume() {
    if (!this.current) return;
    this._setState('loading');
    if (this.hls || this.audio.src) {
      this._attemptPlay(this._playId);
    } else {
      this._connect(this.current, this._playId);
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this._destroyHls();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.current = null;
    this._setState('idle');
  }

  setVolume(v) {
    this._savedVolume = v;
    this.audio.volume = v;
    localStorage.setItem('orbis.volume', String(v));
    if (v > 0 && this.audio.muted) {
      this.audio.muted = false;
      localStorage.setItem('orbis.muted', '0');
    }
  }

  get volume() {
    return this.audio.muted ? 0 : this.audio.volume;
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    localStorage.setItem('orbis.muted', this.audio.muted ? '1' : '0');
    return this.audio.muted;
  }

  /* ---------------- equalizer + analyser (Web Audio) ---------------- */

  // Build the audio graph once, lazily on the first user gesture that needs
  // it (browsers require a gesture to create/resume an AudioContext). Chain:
  //   <audio> -> low -> mid1 -> mid2 -> high -> analyser -> destination
  // so the EQ filters colour the sound and the analyser feeds the visualizer.
  _ensureEq() {
    if (this._eqReady) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(this.audio);
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf'; low.frequency.value = 200;
      const mid1 = ctx.createBiquadFilter();
      mid1.type = 'peaking'; mid1.frequency.value = 600; mid1.Q.value = 0.9;
      const mid2 = ctx.createBiquadFilter();
      mid2.type = 'peaking'; mid2.frequency.value = 2500; mid2.Q.value = 0.9;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf'; high.frequency.value = 7000;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      src.connect(low); low.connect(mid1); mid1.connect(mid2); mid2.connect(high);
      high.connect(analyser); analyser.connect(ctx.destination);
      this._eqCtx = ctx;
      this._eqSrc = src;
      this._eqBands = [low, mid1, mid2, high];
      this._analyser = analyser;
      this._eqReady = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  // AnalyserNode for the live spectrum visualizer. Creates the graph on demand
  // (also used by the EQ) so the visualizer works even with EQ set to "flat".
  getAnalyser() {
    if (this._ensureEq()) return this._analyser;
    return null;
  }

  get eqPreset() { return this._eqPreset; }

  // preset gains in dB for [low, mid1, mid2, high]
  static EQ_PRESETS = {
    flat:      [0, 0, 0, 0],
    pop:       [-1, 3, 4, 1],
    rock:      [5, 2, -1, 4],
    classical: [3, 0, 0, 3],
    vocal:     [-2, 3, 5, 1],
    bass:      [8, 3, -1, -1],
  };

  applyEq(preset) {
    const gains = Player.EQ_PRESETS[preset];
    if (!gains) return false;
    if (!this._ensureEq()) return false;
    this._eqPreset = preset;
    this._eqBands.forEach((b, i) => {
      try { b.gain.setTargetAtTime(gains[i], this._eqCtx.currentTime, 0.08); } catch {}
    });
    try { localStorage.setItem('orbis.eq', preset); } catch {}
    if (this._eqCtx.state === 'suspended') this._eqCtx.resume().catch(() => {});
    return true;
  }

  restoreEq() {
    let preset = 'flat';
    try { preset = localStorage.getItem('orbis.eq') || 'flat'; } catch {}
    if (preset !== 'flat' && Player.EQ_PRESETS[preset]) this._eqPreset = preset;
  }

  /* ---------------- Media Session (OS media keys / lock screen) ---------------- */

  _setupMediaSession() {
    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (!ms) return;
    try {
      ms.setActionHandler('play', () => this.current && this.resume());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('previoustrack', () => this.onPrev && this.onPrev());
      ms.setActionHandler('nexttrack', () => this.onNext && this.onNext());
    } catch {}
  }

  _setMediaMetadata(station) {
    if (!('MediaMetadata' in window) || !('mediaSession' in navigator)) return;
    try {
      const loc = [station.cityZh || station.city, station.country].filter(Boolean).join(' · ');
      const artwork = station.favicon
        ? [{ src: station.favicon, sizes: '96x96', type: 'image/png' },
            { src: station.favicon, sizes: '256x256', type: 'image/png' }]
        : [];
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: station.name,
        artist: loc || 'ORBIS FM',
        album: 'ORBIS FM · 全球广播',
        artwork,
      });
    } catch {}
  }

  _updateMediaSession(state) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : 'paused';
    } catch {}
  }
}
