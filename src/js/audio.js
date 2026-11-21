// Partoch editor — son de flûte à bec (échantillons) + lecture planifiée + métronome
(function () {
  const P = (window.P = window.P || {});
  const M = P.model;
  const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  function midiName(midi) { return NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  // Cherche une zone stable du son pour boucler les notes longues
  function analyzeLoop(buf, midi) {
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    const fr = Math.floor(sr * 0.02);
    const env = [];
    for (let i = 0; i + fr <= d.length; i += fr) {
      let s = 0;
      for (let j = 0; j < fr; j++) { const v = d[i + j]; s += v * v; }
      env.push(Math.sqrt(s / fr));
    }
    const max = Math.max(...env);
    if (!max) return null;
    const a = env.findIndex((v) => v > 0.55 * max);
    let b = a;
    while (b + 1 < env.length && env[b + 1] > 0.55 * max) b++;
    const startS = Math.floor((a + (b - a) * 0.3) * fr);
    const endS = Math.floor((a + (b - a) * 0.92) * fr);
    if (endS - startS < sr * 0.15) return null;
    const period = sr / (440 * Math.pow(2, (midi - 69) / 12));
    let s0 = startS;
    while (s0 < endS && !(d[s0] <= 0 && d[s0 + 1] > 0)) s0++;
    const k = Math.max(1, Math.floor((endS - s0) / period));
    const target = s0 + k * period;
    const W = Math.min(400, Math.floor(period * 2));
    let best = Math.round(target), bestErr = Infinity;
    for (let e = Math.floor(target - period / 2); e <= Math.ceil(target + period / 2); e++) {
      if (e + W >= d.length) break;
      let err = 0;
      for (let j = 0; j < W; j++) { const q = d[s0 + j] - d[e + j]; err += q * q; }
      if (err < bestErr) { bestErr = err; best = e; }
    }
    return { start: s0 / sr, end: best / sr };
  }

  const audio = {
    ctx: null, master: null, bank: null, buffers: {}, ready: false, loadingPromise: null, active: new Set(),
    volume: 0.8,
    ensureCtx() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    load(bank) {
      if (this.bank === bank && this.loadingPromise) return this.loadingPromise;
      this.bank = bank; this.ready = false; this.buffers = {};
      const ctx = this.ensureCtx();
      const data = (window.PARTOCH_SAMPLES || {})[bank];
      if (!data) { this.loadingPromise = Promise.resolve(false); return this.loadingPromise; }
      const jobs = [];
      for (let midi = 21; midi <= 108; midi++) {
        const name = midiName(midi);
        if (!data[name]) continue;
        jobs.push(ctx.decodeAudioData(b64ToBuf(data[name])).then((buffer) => {
          if (this.bank !== bank) return;
          // normalisation : les échantillons d'origine sont très faibles
          const d = buffer.getChannelData(0);
          const a = Math.floor(d.length * 0.3), b = Math.floor(d.length * 0.8);
          let s = 0;
          for (let i = a; i < b; i++) s += d[i] * d[i];
          const rms = Math.sqrt(s / Math.max(1, b - a)) || 0.02;
          this.buffers[midi] = { buffer, loop: analyzeLoop(buffer, midi), gain: Math.max(0.5, Math.min(12, 0.13 / rms)) };
        }).catch(() => {}));
      }
      this.loadingPromise = Promise.all(jobs).then(() => { this.ready = this.bank === bank; return this.ready; });
      return this.loadingPromise;
    },
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },
    // opts.legato : note liée (liaison d'expression) — on saute l'attaque du coup de langue
    // au début de l'échantillon et on fait un court fondu d'entrée qui se superpose à la note précédente
    playNote(midi, when, dur, vel, opts) {
      const ctx = this.ensureCtx();
      midi = Math.max(21, Math.min(108, Math.round(midi)));
      const b = this.buffers[midi];
      if (!b) return null;
      vel = (vel == null ? 0.8 : vel) * (b.gain || 1);
      const src = ctx.createBufferSource();
      src.buffer = b.buffer;
      if (b.loop && dur > b.loop.end - 0.05) { src.loop = true; src.loopStart = b.loop.start; src.loopEnd = b.loop.end; }
      const g = ctx.createGain();
      const off = when + Math.max(0.05, dur);
      const legato = opts && opts.legato;
      const offset = legato ? Math.min(0.09, b.buffer.duration * 0.25) : 0;
      if (legato) {
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(vel, when + 0.025);
      } else g.gain.setValueAtTime(vel, when);
      g.gain.setValueAtTime(vel, off);
      g.gain.linearRampToValueAtTime(0.0001, off + 0.09);
      src.connect(g).connect((opts && opts.dest) || this.master);
      src.start(when, offset);
      src.stop(off + 0.12);
      const rec = { src, g };
      this.active.add(rec);
      src.onended = () => this.active.delete(rec);
      return rec;
    },
    click(when, accent) {
      const ctx = this.ensureCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1760 : 1175;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      o.connect(g).connect(this.master);
      o.start(when); o.stop(when + 0.06);
    },
    stopAll() {
      const ctx = this.ctx;
      if (!ctx) return;
      for (const r of this.active) {
        try { r.g.gain.cancelScheduledValues(ctx.currentTime); r.g.gain.setTargetAtTime(0, ctx.currentTime, 0.02); r.src.stop(ctx.currentTime + 0.1); } catch (e) { /* déjà arrêté */ }
      }
      this.active.clear();
    },
    preview(midi, dur) { this.playNote(midi, this.ensureCtx().currentTime + 0.01, dur || 0.4, 0.75); },
  };

  // ---------------- Lecteur ----------------
  const player = {
    playing: false, timer: null, segs: [], onEnd: null,
    // o : fromTick, speed, metronome, countIn, muted, loop + loopRange, endTick (enregistrement)
    start(score, o) {
      this.stop();
      const ctx = audio.ensureCtx();
      const speed = o.speed || 1;
      const muted = o.muted || new Set();
      const loop = o.loop && o.loopRange ? o.loopRange : null;
      // enregistrement : tempo constant, sans reprises (le micro compte en ticks réguliers)
      const perf = M.performance(score, loop ? { range: loop } : { endTick: o.endTick, plain: !!o.endTick });
      const events = perf.events.filter((e) => !muted.has(e.staff));
      const end = perf.end;
      if (end <= 0) return;
      const fromSel = o.fromTick || 0;
      let from = loop ? (fromSel > loop.a && fromSel < loop.b ? fromSel - loop.a : 0) : Math.min(perf.toPerf(fromSel), end - 1);
      // décompte : une mesure entière de la métrique du point de départ
      const tab = M.measureTable(score);
      const sig0 = tab[Math.min(M.measureAt(score, perf.toScore(from), tab), tab.length - 1)].sig;
      const beat0 = M.sigBeat(sig0);
      const spt0 = 60 / (perf.bpmAt(from) * speed) / M.TPQ;
      const countIn = o.countIn ? Math.round(M.sigLen(sig0) * spt0 * 1000) / 1000 : 0;
      const t0 = ctx.currentTime + 0.12 + countIn;

      this.playing = true;
      this.perf = perf;
      this.spt = 60 / (score.tempo * speed) / M.TPQ; // pour le micro (tempo constant)
      this.speed = speed;
      this.segs = [{ time: t0, tick: from }];
      this.endTime = null;
      this.loop = loop;
      let segStartTime = t0, segStartPt = from;
      let idx = events.findIndex((e) => e.tick >= from);
      if (idx < 0) idx = events.length;
      let bi = perf.beats.findIndex((b) => b.tick >= from);
      if (bi < 0) bi = perf.beats.length;

      if (countIn) {
        const nb = Math.round(M.sigLen(sig0) / beat0);
        for (let i = 0; i < nb; i++) audio.click(t0 - countIn + i * beat0 * spt0, i === 0);
      }
      const timeOf = (pt) => segStartTime + (perf.timeOf(pt) - perf.timeOf(segStartPt)) / speed;
      // Articulation : petit détaché par défaut (coup de langue), notes enchaînées sous une
      // liaison d'expression, aucun trou sous une liaison de phrasé, vraie coupure à la respiration
      const noteDur = (e) => {
        const full = timeOf(e.tick + e.len) - timeOf(e.tick) + (e.fermata ? perf.pauseAt(e.tick + e.len) / speed : 0);
        if (e.cut) return full; // note coupée par la fin de la boucle ou un saut
        if (e.stacc) return Math.max(0.05, full * e.stacc);
        if (e.breath) return Math.max(full * 0.5, full - 0.2);
        if (e.slurNext || e.ten) return full + 0.03;
        if (e.phraseNext) return full * 0.97;
        return full * 0.93;
      };
      const schedule = () => {
        if (!this.playing) return;
        const horizon = ctx.currentTime + 0.25;
        for (;;) {
          while (idx < events.length && timeOf(events[idx].tick) < horizon) {
            const e = events[idx++];
            audio.playNote(e.midi, timeOf(e.tick), noteDur(e), e.vel != null ? e.vel : 0.8, { legato: e.legato && e.tick > segStartPt });
          }
          if (o.metronome) {
            while (bi < perf.beats.length && timeOf(perf.beats[bi].tick) < horizon) {
              audio.click(timeOf(perf.beats[bi].tick), perf.beats[bi].accent);
              bi++;
            }
          }
          const endT = timeOf(end);
          const evDone = idx >= events.length;
          const beatDone = !o.metronome || bi >= perf.beats.length;
          if (evDone && beatDone && endT < horizon) {
            if (loop || o.loop) {
              segStartTime = endT; segStartPt = 0;
              this.segs.push({ time: segStartTime, tick: 0 });
              idx = 0; bi = 0;
              continue;
            }
            this.endTime = endT;
          }
          break;
        }
        if (this.endTime != null && ctx.currentTime > this.endTime + 0.15) {
          this.stop();
          if (this.onEnd) this.onEnd();
        }
      };
      schedule();
      this.timer = setInterval(schedule, 25);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.playing) audio.stopAll();
      this.playing = false;
    },
    // position de lecture (tick de la partition)
    currentTick() {
      if (!this.playing || !audio.ctx) return null;
      const now = audio.ctx.currentTime;
      let seg = this.segs[0];
      for (const s of this.segs) if (s.time <= now) seg = s;
      const perf = this.perf;
      const toScore = (pt) => (this.loop ? this.loop.a + pt : perf.toScore(pt));
      if (now < seg.time) return { tick: toScore(seg.tick), countIn: true };
      const pt = perf.tickAt(perf.timeOf(seg.tick) + (now - seg.time) * this.speed);
      return { tick: toScore(Math.min(pt, perf.end)), countIn: false };
    },
  };

  P.audio = audio;
  P.player = player;
})();
