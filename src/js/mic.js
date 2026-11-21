// Partoch editor — enregistrement au micro et transcription (hauteur, attaques, quantification)
(function () {
  const M = P.model;

  // ---------------------------------------------------------------- capture
  // Le processeur audio reçoit le micro dans le même horloge que le métronome :
  // currentFrame / sampleRate = ctx.currentTime, d'où un calage exact sur les temps.
  const WORKLET = `
class PartochRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true; this.buf = new Float32Array(2048); this.n = 0; this.f0 = 0; this.peak = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); } };
  }
  flush() {
    if (this.n) this.port.postMessage({ f: this.f0, d: this.buf.slice(0, this.n), peak: this.peak });
    this.n = 0; this.peak = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0];
    if (inp && inp.length) {
      const L = inp[0].length;
      if (this.n === 0) this.f0 = currentFrame;
      for (let i = 0; i < L; i++) {
        let v = 0;
        for (let c = 0; c < inp.length; c++) v += inp[c][i];
        v /= inp.length;
        this.buf[this.n++] = v;
        const a = v < 0 ? -v : v;
        if (a > this.peak) this.peak = a;
      }
      if (this.n + L > this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor('partoch-rec', PartochRec);`;

  const mic = {
    stream: null, source: null, analyser: null, deviceId: null, workletReady: null,

    supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode); },

    async listDevices() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || 'Micro ' + (i + 1) }));
      } catch (e) { return []; }
    },

    // ouvre le micro (sans traitement : pas d'annulation d'écho ni de réduction de bruit, qui abîment la hauteur)
    async open(deviceId) {
      const ctx = P.audio.ensureCtx();
      if (this.stream && this.deviceId === (deviceId || null)) return this.source;
      this.close();
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
      if (deviceId) audio.deviceId = { exact: deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      this.deviceId = deviceId || null;
      this.source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      return this.source;
    },
    close() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      try { if (this.source) this.source.disconnect(); } catch (e) { /* ignore */ }
      this.stream = null; this.source = null; this.analyser = null; this.deviceId = null;
    },
    // niveau instantané 0..1 (crête), pour le vumètre
    level() {
      if (!this.analyser) return 0;
      const a = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(a);
      let p = 0;
      for (const v of a) { const x = Math.abs(v); if (x > p) p = x; }
      return p;
    },

    async ensureWorklet() {
      const ctx = P.audio.ensureCtx();
      if (!this.workletReady) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        this.workletReady = ctx.audioWorklet.addModule(url);
      }
      return this.workletReady;
    },

    // commence la capture d'un nœud audio (le micro, ou une source de test)
    async startCapture(input) {
      const ctx = P.audio.ensureCtx();
      await this.ensureWorklet();
      const node = new AudioWorkletNode(ctx, 'partoch-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      input.connect(node);
      node.connect(mute).connect(ctx.destination); // garde le nœud actif, sans le faire entendre
      const cap = { node, input, mute, chunks: [], peak: 0, sr: ctx.sampleRate };
      node.port.onmessage = (e) => {
        if (e.data.done) { if (cap.onDone) cap.onDone(); return; }
        cap.chunks.push(e.data);
        cap.peak = Math.max(cap.peak * 0.85, e.data.peak);
      };
      return cap;
    },
    async stopCapture(cap) {
      await new Promise((res) => { cap.onDone = res; cap.node.port.postMessage('stop'); setTimeout(res, 400); });
      try { cap.input.disconnect(cap.node); } catch (e) { /* ignore */ }
      try { cap.node.disconnect(); cap.mute.disconnect(); } catch (e) { /* ignore */ }
      const ch = cap.chunks;
      if (!ch.length) return { data: new Float32Array(0), sr: cap.sr, frame0: 0 };
      const frame0 = ch[0].f;
      const last = ch[ch.length - 1];
      const data = new Float32Array(last.f + last.d.length - frame0);
      for (const c of ch) data.set(c.d, c.f - frame0);
      return { data, sr: cap.sr, frame0 };
    },
  };

  // ---------------------------------------------------------------- analyse
  function median(a) {
    if (!a.length) return NaN;
    const s = Float64Array.from(a).sort();
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  }
  function percentile(a, p) {
    if (!a.length) return 0;
    const s = Float64Array.from(a).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  }

  // Détection de hauteur YIN sur une fenêtre ; renvoie { f0, ap } (ap = apériodicité, 0 = son pur)
  function yin(x, start, W, tmin, tmax, sr, d, cm) {
    const N = W - tmax;
    for (let tau = 1; tau <= tmax; tau++) {
      let s = 0;
      for (let i = 0; i < N; i++) { const v = x[start + i] - x[start + i + tau]; s += v * v; }
      d[tau] = s;
    }
    let run = 0;
    cm[0] = 1;
    for (let tau = 1; tau <= tmax; tau++) { run += d[tau]; cm[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
    let tau = -1;
    for (let t = tmin; t <= tmax; t++) {
      if (cm[t] < 0.15) {
        while (t + 1 <= tmax && cm[t + 1] < cm[t]) t++;
        tau = t; break;
      }
    }
    if (tau < 0) {
      let best = tmin;
      for (let t = tmin; t <= tmax; t++) if (cm[t] < cm[best]) best = t;
      tau = best;
    }
    const ap = cm[tau];
    let ft = tau;
    if (tau > 1 && tau < tmax) {
      const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) ft = tau + (a - c) / (2 * den);
    }
    return { f0: sr / ft, ap };
  }

  // Analyse image par image : énergie, hauteur, voisement
  function analyzeFrames(take) {
    let x = take.data, sr = take.sr, dec = 1;
    // sous-échantillonnage ×2 (la flûte à bec monte à ~2,4 kHz : 24 kHz suffisent largement)
    if (sr > 30000) {
      dec = 2;
      const y = new Float32Array(x.length >> 1);
      for (let i = 0; i < y.length; i++) {
        const a = x[2 * i - 1] || 0, b = x[2 * i], c = x[2 * i + 1] || 0;
        y[i] = 0.25 * a + 0.5 * b + 0.25 * c;
      }
      x = y; sr /= 2;
    }
    const W = Math.round(sr * 0.0213) & ~1;   // ~21 ms
    const hop = Math.round(sr * 0.0053);       // ~5 ms
    const tmin = Math.floor(sr / 2800), tmax = Math.ceil(sr / 140);
    const nF = Math.max(0, Math.floor((x.length - W) / hop));
    const rms = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      let s = 0;
      const o = f * hop;
      for (let i = 0; i < W; i++) s += x[o + i] * x[o + i];
      rms[f] = Math.sqrt(s / W);
    }
    const noise = percentile(rms, 0.1), peak = percentile(rms, 0.995);
    const gate = Math.max(noise * 3.5, peak * 0.05, 0.0015);
    const midi = new Float32Array(nF).fill(NaN);
    const d = new Float64Array(tmax + 2), cm = new Float64Array(tmax + 2);
    for (let f = 0; f < nF; f++) {
      if (rms[f] < gate) continue;
      const r = yin(x, f * hop, W, tmin, tmax, sr, d, cm);
      if (r.ap > 0.3 || !(r.f0 > 130 && r.f0 < 2900)) continue;
      midi[f] = 69 + 12 * Math.log2(r.f0 / 440);
    }
    // temps (secondes, horloge audio) du centre de chaque image
    const secPerFrame = hop / sr;
    const frameTime = (f) => (take.frame0 / take.sr) + (f * hop + W / 2) / sr;
    return { nF, rms, midi, gate, peak, secPerFrame, frameTime, dec };
  }

  // Découpe en notes : changement de hauteur, silence, ou creux d'énergie (coup de langue sur la même note)
  function segment(A, minNoteSec) {
    const { nF, rms, midi, secPerFrame } = A;
    // justesse globale : décalage moyen (en demi-ton) de l'instrument par rapport au La 440
    let sx = 0, sy = 0;
    for (let f = 0; f < nF; f++) {
      if (isNaN(midi[f])) continue;
      const a = 2 * Math.PI * (midi[f] - Math.round(midi[f]));
      sx += Math.cos(a); sy += Math.sin(a);
    }
    const tuning = sx || sy ? Math.atan2(sy, sx) / (2 * Math.PI) : 0;
    // hauteur lissée (médiane sur 5 images voisées consécutives)
    const m = new Float32Array(nF).fill(NaN);
    for (let f = 0; f < nF; f++) {
      if (isNaN(midi[f])) continue;
      const w = [];
      for (let k = f - 2; k <= f + 2; k++) if (k >= 0 && k < nF && !isNaN(midi[k])) w.push(midi[k] - tuning);
      m[f] = median(w);
    }
    // enveloppe lissée (~15 ms)
    const env = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      let s = 0, c = 0;
      for (let k = f - 1; k <= f + 1; k++) if (k >= 0 && k < nF) { s += rms[k]; c++; }
      env[f] = s / c;
    }
    const maxGap = Math.max(2, Math.round(0.012 / secPerFrame));
    const confirm = Math.max(3, Math.round(0.025 / secPerFrame));
    const notes = [];
    let cur = null, gap = 0, pend = null;
    const close = () => { if (cur) notes.push(cur); cur = null; pend = null; };
    for (let f = 0; f < nF; f++) {
      if (isNaN(m[f])) {
        gap++;
        if (cur && gap > maxGap) close();
        continue;
      }
      const r = Math.round(m[f]);
      if (!cur || gap > maxGap) {
        close();
        cur = { a: f, b: f, pitch: r };
      } else if (r !== cur.pitch) {
        if (!pend || pend.pitch !== r) pend = { a: f, pitch: r, n: 0 };
        pend.n++;
        if (pend.n >= confirm) {
          cur.b = pend.a - 1;
          const np = pend.pitch, na = pend.a;
          close();
          cur = { a: na, b: f, pitch: np };
        }
      } else {
        pend = null;
        cur.b = f;
      }
      gap = 0;
    }
    close();
    // coups de langue : creux d'énergie à l'intérieur d'une note
    const look = Math.round(0.06 / secPerFrame);
    const out = [];
    for (const n of notes) {
      let a = n.a;
      for (let f = n.a + look; f <= n.b - 3; f++) {
        let pk = 0;
        for (let k = f - look; k < f; k++) pk = Math.max(pk, env[k]);
        // nouvelle attaque sans creux (son très lié ou pièce réverbérante) : montée rapide + hauteur qui vacille
        const rise = Math.round(0.032 / secPerFrame);
        if (f + rise <= n.b && f - 8 >= a + look) { // référence prise après l'attaque de la note
          let base = 0;
          for (let k = f - 8; k < f; k++) base += env[k];
          base /= 8;
          let mx = f;
          for (let k = f; k <= Math.min(n.b, f + 2 * rise); k++) if (env[k] > env[mx]) mx = k;
          if (env[f] < 1.1 * base && env[mx] > 1.35 * base) {
            // temps de montée 10 % → 90 % : court pour une attaque (~25 ms), long pour un vibrato ou un crescendo
            const lo = base + 0.1 * (env[mx] - base), hi = base + 0.9 * (env[mx] - base);
            let k1 = f;
            while (k1 < mx && env[k1] < lo) k1++;
            let k2 = k1;
            while (k2 < mx && env[k2] < hi) k2++;
            let wob = 0;
            for (let k = f; k <= mx; k++) if (!isNaN(midi[k])) wob = Math.max(wob, Math.abs(midi[k] - tuning - n.pitch));
            if ((k2 - k1) * secPerFrame <= 0.04 && wob > 0.12 && f - a >= 4 && n.b - f >= 4) {
              out.push({ a, b: f - 1, pitch: n.pitch });
              a = f;
              f += look;
              continue;
            }
          }
        }
        if (env[f] > 0.8 * pk) continue;
        // creux : on cherche le minimum puis une remontée franche
        let mi = f;
        while (mi + 1 <= n.b && env[mi + 1] <= env[mi]) mi++;
        let up = 0;
        for (let k = mi; k <= Math.min(n.b, mi + look); k++) up = Math.max(up, env[k]);
        // creux profond, ou creux léger suivi d'une nouvelle attaque (la hauteur vacille au coup de langue)
        let wob = 0;
        for (let k = Math.max(n.a, mi - 3); k <= Math.min(n.b, mi + 3); k++) if (!isNaN(midi[k])) wob = Math.max(wob, Math.abs(midi[k] - tuning - n.pitch));
        const deep = env[mi] < 0.5 * pk && up > 0.75 * pk;
        // largeur du creux à mi-profondeur : étroit pour un coup de langue (~30 ms), large pour un vibrato (~90 ms)
        let l = mi, r = mi;
        while (l > a && env[l] < (pk + env[mi]) / 2) l--;
        while (r < n.b && env[r] < (up + env[mi]) / 2) r++;
        const narrow = (r - l) * secPerFrame <= 0.055;
        const soft = narrow && up > 1.4 * env[mi] && up > 0.9 * pk && (wob > 0.15 || (up > 1.25 * pk && up > 1.6 * env[mi]));
        if ((deep || soft) && mi - a >= 4 && n.b - mi >= 4) {
          out.push({ a, b: mi - 1, pitch: n.pitch });
          a = mi + 1;
          f = mi + look;
        } else f = mi;
      }
      out.push({ a, b: n.b, pitch: n.pitch });
    }
    // hauteur définitive : médiane sur le cœur de la note ; on écarte les notes trop courtes
    const minF = Math.max(5, Math.round(minNoteSec / secPerFrame));
    const res = [];
    for (const n of out) {
      if (n.b - n.a + 1 < minF) continue;
      const k0 = n.a + Math.floor((n.b - n.a) * 0.2), k1 = n.b - Math.floor((n.b - n.a) * 0.2);
      const w = [];
      for (let k = k0; k <= k1; k++) if (!isNaN(m[k])) w.push(m[k]);
      res.push({ a: n.a, b: n.b, midi: Math.round(w.length ? median(w) : n.pitch) });
    }
    return { notes: res, tuning };
  }

  // Transcription complète d'une prise
  // take : { data, sr, frame0, zeroTime (horloge audio du tick fromTick), spt (s par tick), fromTick, endTick }
  // opts : { grid (ticks), latency (s), fillGaps }
  function transcribe(take, opts) {
    const grid = opts.grid || 120;
    const A = take.analysis || (take.analysis = analyzeFrames(take));
    const gridSec = grid * take.spt;
    const seg = segment(A, Math.max(0.04, gridSec * 0.35));
    const toTick = (sec) => take.fromTick + (sec - (opts.latency || 0) - take.zeroTime) / take.spt;
    const q = (t) => Math.round(t / grid) * grid;
    let list = [];
    for (const n of seg.notes) {
      const on = toTick(A.frameTime(n.a) - A.secPerFrame * 2);
      const off = toTick(A.frameTime(n.b) + A.secPerFrame);
      const qs = q(on);
      if (qs < take.fromTick || (take.endTick != null && qs >= take.endTick)) continue;
      list.push({ start: qs, rawLen: off - on, off, midi: n.midi });
    }
    // deux notes sur la même case de grille : on garde la plus longue
    const merged = [];
    for (const n of list) {
      const p = merged[merged.length - 1];
      if (p && p.start === n.start) { if (n.rawLen > p.rawLen) merged[merged.length - 1] = n; continue; }
      merged.push(n);
    }
    list = merged;
    for (let i = 0; i < list.length; i++) {
      const n = list[i], nx = list[i + 1];
      let end = Math.max(q(n.off), n.start + grid);
      // note longue suivie d'un silence : fin arrondie à la croche (la résonance ne doit pas créer de double point)
      // (on joue souvent un peu court : arrondi vers le haut sauf si la note s'arrête nettement avant)
      if (n.rawLen >= 400 && (!nx || nx.start - end > grid)) end = Math.max(n.start + grid, Math.ceil((n.off - 72) / 240) * 240);
      if (nx && end > nx.start) end = nx.start;
      if (opts.fillGaps && nx && nx.start - end <= grid) end = nx.start;
      if (take.endTick != null) end = Math.min(end, Math.max(n.start + grid, q(take.endTick)));
      n.len = end - n.start;
    }
    return { notes: list.filter((n) => n.len > 0).map((n) => ({ start: n.start, len: n.len, midi: n.midi })), tuning: seg.tuning };
  }

  // hauteur instantanée pour l'accordeur : { f0, ap } ou null (silence, son trop bruité)
  mic.pitchNow = function () {
    const an = this.analyser;
    if (!an) return null;
    if (an.fftSize < 2048) an.fftSize = 2048;
    const x = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(x);
    let e = 0;
    for (const v of x) e += v * v;
    if (Math.sqrt(e / x.length) < 0.01) return null;
    const sr = an.context.sampleRate;
    const tmin = Math.floor(sr / 2400), tmax = Math.min(Math.floor(sr / 140), x.length >> 1);
    const r = yin(x, 0, x.length, tmin, tmax, sr, new Float32Array(tmax + 2), new Float32Array(tmax + 2));
    return r.ap < 0.25 ? r : null;
  };

  P.mic = mic;
  P.transcribe = { transcribe, analyzeFrames, segment };
})();
