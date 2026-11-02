// Всё звучание синтезируется на лету через WebAudio — внешних файлов нет.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.master = null;
    this.ambienceNodes = [];
    this.breath = null;
    this.heartTimer = 0;
    this.breathLevel = 0;
    this.breathTarget = 0;
    this.stepSide = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // Компрессор, чтобы скримеры не рвали уши
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.25;
    this.comp.connect(this.master);

    this.noiseBuffer = this._makeNoise(4, 'white');
    this.brownBuffer = this._makeNoise(6, 'brown');
    this.ready = true;
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  _makeNoise(seconds, kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  _noiseSource(kind = 'white') {
    const src = this.ctx.createBufferSource();
    src.buffer = kind === 'brown' ? this.brownBuffer : this.noiseBuffer;
    src.loop = true;
    return src;
  }

  startAmbience() {
    if (!this.ready || this.ambienceNodes.length) return;
    const ctx = this.ctx;

    // Гул вентиляции
    const droneOsc = ctx.createOscillator();
    droneOsc.type = 'sawtooth';
    droneOsc.frequency.value = 43;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 190;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.045;
    lfo.connect(lfoGain).connect(droneGain.gain);
    droneOsc.connect(droneFilter).connect(droneGain).connect(this.comp);
    droneOsc.start();
    lfo.start();

    // Шум воздуха
    const air = this._noiseSource('brown');
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 320;
    airFilter.Q.value = 0.7;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.16;
    air.connect(airFilter).connect(airGain).connect(this.comp);
    air.start();

    this.ambienceNodes = [droneOsc, lfo, air, droneGain, airGain, droneFilter, airFilter];
    this.airGain = airGain;
    this.droneGain = droneGain;

    // Случайные капли/скрипы
    const scheduleDrip = () => {
      if (!this.ready || this.muted) return;
      const delay = 2.5 + Math.random() * 7;
      this._timer = setTimeout(() => {
        if (!this.muted) this.randomAmbient();
        scheduleDrip();
      }, delay * 1000);
      if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
    };
    scheduleDrip();
  }

  randomAmbient() {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = Math.random();
    if (r < 0.45) {
      // капля
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(1200 + Math.random() * 900, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.16);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g).connect(this.comp);
      osc.start(t);
      osc.stop(t + 0.35);
    } else if (r < 0.75) {
      // скрип металла
      const src = this._noiseSource('white');
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700 + Math.random() * 1300;
      bp.Q.value = 18;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      src.connect(bp).connect(g).connect(this.comp);
      src.start(t);
      src.stop(t + 1.5);
    } else {
      // далёкий удар
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.6);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(g).connect(this.comp);
      osc.start(t);
      osc.stop(t + 1);
    }
  }

  step(kind = 'walk', volume = 1) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noiseSource('white');
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = kind === 'run' ? 1400 : kind === 'crouch' ? 480 : 900;
    filter.Q.value = 0.9;
    const g = ctx.createGain();
    const base = (kind === 'run' ? 0.2 : kind === 'crouch' ? 0.05 : 0.12) * volume;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(base, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(filter).connect(g).connect(this.comp);
    src.start(t);
    src.stop(t + 0.2);

    // низкий "тук" подошвы
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(kind === 'run' ? 90 : 70, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    og.gain.setValueAtTime(0.09 * volume, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(og).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.16);
    this.stepSide = 1 - this.stepSide;
  }

  click() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noiseSource('white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(g).connect(this.comp);
    src.start(t);
    src.stop(t + 0.06);
  }

  pickup(type = 'fuse') {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freqs = type === 'fuse' ? [440, 660, 880] : type === 'battery' ? [520, 780] : type === 'medkit' ? [330, 495] : [620, 830];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(g).connect(this.comp);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }

  deny() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 120;
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  hurt() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.5);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.65);

    const src = this._noiseSource('white');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    src.connect(lp).connect(ng).connect(this.comp);
    src.start(t);
    src.stop(t + 0.45);
  }

  heartbeat(strength) {
    if (!this.ready || this.muted || strength <= 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const thump = (at, amp, freq) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, at + 0.16);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(amp, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(g).connect(this.comp);
      osc.start(at);
      osc.stop(at + 0.25);
    };
    thump(t, 0.16 * strength, 58);
    thump(t + 0.17, 0.11 * strength, 48);
  }

  startBreath() {
    if (!this.ready || this.breath) return;
    const ctx = this.ctx;
    const src = this._noiseSource('brown');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.comp);
    src.start();
    this.breath = { src, bp, g };
  }

  setMonsterProximity(dist, active) {
    if (!this.ready) return;
    const target = active && dist < 26 ? Math.min(1, (26 - dist) / 26) * 0.42 : 0;
    if (this._lastBreathTarget !== undefined && Math.abs(target - this._lastBreathTarget) < 0.012) return;
    this._lastBreathTarget = target;
    if (!this.breath) this.startBreath();
    this.breathTarget = target;
    if (this.breath) {
      this.breath.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
      this.breath.bp.frequency.setTargetAtTime(300 + (1 - Math.min(1, dist / 26)) * 320, this.ctx.currentTime, 0.4);
    }
  }

  monsterScream(pitch = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + i * 500;
      bp.Q.value = 4;
      osc.type = i === 0 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime((180 + i * 90) * pitch, t);
      osc.frequency.linearRampToValueAtTime((420 + i * 160) * pitch, t + 0.35);
      osc.frequency.exponentialRampToValueAtTime((120 + i * 40) * pitch, t + 1.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(bp).connect(g).connect(this.comp);
      osc.start(t);
      osc.stop(t + 1.25);
    }
    const src = this._noiseSource('white');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 1.1);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(bp).connect(g).connect(this.comp);
    src.start(t);
    src.stop(t + 1.25);
  }

  sting() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freqs = [220, 233, 330, 466, 622];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 2, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 1.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.03 + i * 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      osc.connect(g).connect(this.comp);
      osc.start(t);
      osc.stop(t + 1.9);
    });
    const src = this._noiseSource('white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(hp).connect(g).connect(this.comp);
    src.start(t);
    src.stop(t + 1.3);
  }

  powerOn() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(40, t);
    osc.frequency.linearRampToValueAtTime(120, t + 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.4);
    g.gain.linearRampToValueAtTime(0.1, t + 2.0);
    osc.connect(lp).connect(g).connect(this.comp);
    osc.start(t);
    // гул остаётся
    this.hum = { osc, g };
    this.hum.g.gain.setTargetAtTime(0.05, t + 2.2, 1);
  }

  stopHum() {
    if (this.hum) {
      try {
        this.hum.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
        this.hum.osc.stop(this.ctx.currentTime + 1.5);
      } catch (e) { /* ignore */ }
      this.hum = null;
    }
  }

  win() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [262, 330, 392, 523].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = t + i * 0.18;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.16, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
      osc.connect(g).connect(this.comp);
      osc.start(start);
      osc.stop(start + 1.7);
    });
  }

  lose() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 3.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    osc.connect(lp).connect(g).connect(this.comp);
    osc.start(t);
    osc.stop(t + 3.5);
  }

  update(dt, fear) {
    if (!this.ready || this.muted) return;
    // Сердцебиение: чем страшнее, тем чаще
    this.heartTimer -= dt;
    if (this.heartTimer <= 0 && fear > 0.05) {
      this.heartbeat(Math.min(1, fear * 1.15));
      this.heartTimer = 1.15 - fear * 0.55;
    }
    if (this.breath) {
      this.breathLevel += (this.breathTarget - this.breathLevel) * Math.min(1, dt * 3);
    }
  }
}
