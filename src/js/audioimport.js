// Partoch editor — import d'un enregistrement audio
// notes (Basic Pitch, Spotify) → suivi des temps → quantification → voix → tonalité → choix des flûtes
(function () {
  const M = P.model;
  const AUDIO_EXT = /\.(mp3|wav|wave|m4a|aac|ogg|oga|opus|flac|webm|mp4|m4v|mov|3gp|aif|aiff|wma)$/i;
  const SR = 22050;

  // ---------------------------------------------------------------- chargement (à la demande)
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Impossible de charger ' + src));
      document.head.appendChild(s);
    });
  }
  let libP = null;
  function lib() {
    if (!libP) {
      libP = loadScript('../assets/basic-pitch-model.js')
        .then(() => loadScript('vendor/basic-pitch.js'))
        .then(() => window.BasicPitchLib)
        .catch((e) => { libP = null; throw e; });
    }
    return libP;
  }

  // ---------------------------------------------------------------- audio
  async function decode(bytes) {
    const ctx = P.audio.ensureCtx();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let buf;
    try { buf = await ctx.decodeAudioData(ab); } catch (e) { throw new Error('format audio non reconnu (essayez mp3, wav, m4a, ogg ou flac)'); }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * SR)), SR);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    const x = out.getChannelData(0);
    // normalisation (les enregistrements faibles donnent moins de notes)
    let pk = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
    if (pk > 0.001) { const g = 0.9 / pk; for (let i = 0; i < x.length; i++) x[i] *= g; }
    return { samples: x, duration: buf.duration };
  }

  let bp = null;
  async function analyze(samples, onProgress) {
    const L = await lib();
    if (!bp) bp = new L.BasicPitch(L.loadModel());
    const frames = [], onsets = [], contours = [];
    await bp.evaluateModel(samples, (f, o, c) => {
      for (const v of f) frames.push(v);
      for (const v of o) onsets.push(v);
      for (const v of c) contours.push(v);
    }, (p) => { if (onProgress) onProgress(p); });
    return { frames, onsets, contours };
  }

  // ---------------------------------------------------------------- notes brutes
  const SENS = { low: [0.6, 0.4], normal: [0.5, 0.3], high: [0.38, 0.22] };
  function extractNotes(raw, sens) {
    const L = window.BasicPitchLib;
    const [on, fr] = SENS[sens] || SENS.normal;
    const evF = mergeSplits(L.outputToNotesPoly(raw.frames, raw.onsets, on, fr, 7, true, null, null, true, 11), raw.frames);
    const ev = L.noteFramesToTime(evF);
    let notes = ev.map((e) => ({ pitch: e.pitchMidi, start: e.startTimeSeconds, dur: e.durationSeconds, amp: e.amplitude }))
      .filter((n) => n.dur >= 0.05 && n.pitch >= 36 && n.pitch <= 100);
    // notes fantômes : octave (ou octave + quinte) au-dessus ou au-dessous d'une note nettement plus forte
    // qui sonne en même temps (une vraie doublure à l'octave a une force comparable)
    notes = notes.filter((n) => !notes.some((m) => m !== n && n.amp < 0.58 * m.amp
      && [12, 19, 24].includes(Math.abs(n.pitch - m.pitch))
      && overlap(n, m) >= 0.5 * n.dur));
    notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
    return notes;
  }
  // L'analyse coupe parfois une note tenue en deux (même hauteur, sans silence). Une vraie note répétée,
  // elle, fait baisser brièvement la probabilité de cette hauteur juste avant la nouvelle attaque (coup de langue).
  function mergeSplits(ev, frames) {
    ev = ev.slice().sort((a, b) => a.pitchMidi - b.pitchMidi || a.startFrame - b.startFrame);
    const out = [];
    for (const n of ev) {
      const p = out[out.length - 1];
      if (p && p.pitchMidi === n.pitchMidi && n.startFrame - (p.startFrame + p.durationFrames) <= 2) {
        const idx = n.pitchMidi - 21, b = n.startFrame;
        const mid = [];
        for (let f = p.startFrame + Math.floor(p.durationFrames * 0.25); f <= p.startFrame + Math.floor(p.durationFrames * 0.75); f++) if (frames[f]) mid.push(frames[f][idx]);
        mid.sort((x, y) => x - y);
        const ref = mid[mid.length >> 1] || 0;
        let mn = Infinity;
        for (let f = Math.max(p.startFrame, b - 14); f <= b + 2; f++) if (frames[f]) mn = Math.min(mn, frames[f][idx]);
        if (mn > 0.6 * ref) {
          p.durationFrames = n.startFrame + n.durationFrames - p.startFrame;
          p.amplitude = Math.max(p.amplitude, n.amplitude);
          continue;
        }
      }
      out.push({ ...n });
    }
    return out;
  }
  function overlap(a, b) { return Math.max(0, Math.min(a.start + a.dur, b.start + b.dur) - Math.max(a.start, b.start)); }

  // ---------------------------------------------------------------- tempo et temps (programmation dynamique, méthode d'Ellis)
  function trackBeats(notes, duration, fixedBpm, priorSec) {
    const fps = 100;
    const n = Math.ceil((duration + 2) * fps);
    const raw = new Float32Array(n);
    for (const nt of notes) {
      const i = Math.round(nt.start * fps);
      if (i >= 0 && i < n) raw[i] += nt.amp * (0.6 + Math.min(1, nt.dur));
    }
    // lissage gaussien (σ = 20 ms)
    const env = new Float32Array(n);
    const K = [];
    for (let k = -6; k <= 6; k++) K.push(Math.exp(-0.5 * (k / 2) ** 2));
    for (let i = 0; i < n; i++) {
      if (!raw[i]) continue;
      for (let k = -6; k <= 6; k++) if (i + k >= 0 && i + k < n) env[i + k] += raw[i] * K[k + 6];
    }
    let mean = 0;
    for (const v of env) mean += v;
    mean /= n;
    let sd = 0;
    for (const v of env) sd += (v - mean) ** 2;
    sd = Math.sqrt(sd / n) || 1;
    for (let i = 0; i < n; i++) env[i] /= sd;
    // période globale : autocorrélation pondérée autour de 120 à la noire
    let tau;
    if (fixedBpm) tau = (60 * fps) / fixedBpm;
    else {
      let best = -1, bl = 50;
      for (let lag = Math.round((60 * fps) / 200); lag <= Math.round((60 * fps) / 40); lag++) {
        let ac = 0;
        for (let i = 0; i + lag < n; i++) ac += env[i] * env[i + lag];
        const w = Math.exp(-0.5 * (Math.log2(lag / (fps * (priorSec || 0.5))) / 1.0) ** 2);
        if (ac * w > best) { best = ac * w; bl = lag; }
      }
      tau = bl;
    }
    // suivi : chaque temps cherche le meilleur temps précédent à environ une période
    const C = new Float32Array(n), back = new Int32Array(n).fill(-1);
    const tight = 100;
    for (let t = 0; t < n; t++) {
      let best = -Infinity, bpi = -1;
      const lo = Math.max(0, Math.round(t - 2 * tau)), hi = Math.round(t - tau / 2);
      for (let p = lo; p <= hi; p++) {
        const v = C[p] - tight * Math.log((t - p) / tau) ** 2;
        if (v > best) { best = v; bpi = p; }
      }
      if (bpi >= 0 && best > 0) { C[t] = env[t] + best; back[t] = bpi; } else C[t] = env[t];
    }
    const lastOn = notes.length ? notes[notes.length - 1].start : duration;
    let end = 0;
    const endHi = Math.min(n - 1, Math.round((lastOn + 0.1) * fps));
    for (let t = Math.max(0, Math.round(endHi - 2 * tau)); t <= endHi; t++) if (C[t] > C[end]) end = t;
    const beats = [];
    for (let t = end; t >= 0; t = back[t]) { beats.push(t / fps); if (back[t] < 0) break; }
    beats.reverse();
    if (beats.length < 2) { beats.length = 0; for (let t = 0; t <= duration + 1; t += tau / fps) beats.push(t); }
    // on prolonge avant la première note et après la dernière
    const per = tau / fps;
    const first = notes.length ? notes[0].start : 0;
    while (beats[0] > first - per * 0.5) beats.unshift(beats[0] - (beats[1] - beats[0] || per));
    while (beats[beats.length - 1] < duration + per) beats.push(beats[beats.length - 1] + per);
    const ibi = [];
    for (let i = 1; i < beats.length; i++) ibi.push(beats[i] - beats[i - 1]);
    ibi.sort((a, b) => a - b);
    const med = ibi[ibi.length >> 1] || per;
    return { beats, bpm: 60 / med };
  }
  // position en temps (fractionnaire) d'un instant
  function beatPos(beats, t) {
    const n = beats.length;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
    return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
  }

  // ---------------------------------------------------------------- mesures, levée, quantification
  function meterInfo(sig) {
    const [num, den] = sig;
    if (den === 8 && num % 3 === 0) return { bpb: num / 3, beatTicks: 720 };
    return { bpb: (num * 4) / den, beatTicks: 480 };
  }
  // métrique : à 3 ou à 4 temps ? on regarde lequel des deux fait le mieux ressortir des temps forts réguliers
  function accentScore(notes, beats, bpb) {
    const sc = new Array(bpb).fill(0);
    let tot = 0;
    for (const n of notes) {
      const a = beatPos(beats, n.start), r = Math.round(a);
      if (Math.abs(a - r) > 0.15) continue;
      const w = n.amp * Math.min(2, n.dur + 0.2);
      sc[((r % bpb) + bpb) % bpb] += w;
      tot += w;
    }
    return tot ? Math.max(...sc) / (tot / bpb) : 1;
  }
  function detectMeter(notes, beats) {
    const s3 = accentScore(notes, beats, 3), s4 = accentScore(notes, beats, 4);
    return s3 > s4 * 1.12 ? [3, 4] : [4, 4];
  }
  function quantize(notes, beats, sig, grid) {
    const { bpb, beatTicks } = meterInfo(sig);
    const pos = notes.map((n) => ({ n, a: beatPos(beats, n.start), b: beatPos(beats, n.start + n.dur) }));
    // temps fort : là où tombent les notes les plus longues et les plus fortes
    let k = 0;
    if (bpb > 1) {
      const sc = new Array(Math.ceil(bpb)).fill(0);
      for (const p of pos) {
        const r = Math.round(p.a);
        if (Math.abs(p.a - r) > 0.15) continue;
        sc[((r % bpb) + bpb) % bpb] += p.n.amp * Math.min(2, p.n.dur + 0.2);
      }
      for (let i = 1; i < sc.length; i++) if (sc[i] > sc[k] * 1.05) k = i;
    }
    const firstPos = pos.length ? pos[0].a : 0;
    let B0 = Math.floor(firstPos + 0.25);
    while ((((B0 - k) % bpb) + bpb) % bpb !== 0) B0--;
    let offset = Math.floor(firstPos - B0 + 0.25);
    let pickup = 0, shift = B0 * beatTicks;
    if (bpb > 1 && offset >= bpb / 2) {
      pickup = (bpb - offset) * beatTicks;
      shift = (B0 + offset) * beatTicks;
    }
    const q = (t) => Math.round(t / grid) * grid;
    const out = [];
    for (const p of pos) {
      const s = q(p.a * beatTicks - shift);
      if (s < 0) continue;
      const e = Math.max(s + grid, q(p.b * beatTicks - shift));
      out.push({ s, e, pitch: p.n.pitch, amp: p.n.amp, rawStart: p.a * beatTicks - shift, rawEnd: p.b * beatTicks - shift, ref: p.n });
    }
    return { notes: out, pickup, barTicks: bpb * beatTicks };
  }

  // ---------------------------------------------------------------- voix
  function autoVoices(qn, grid) {
    if (!qn.length) return 1;
    const end = Math.max(...qn.map((n) => n.e));
    const cnt = new Uint8Array(Math.ceil(end / grid) + 1);
    for (const n of qn) for (let t = n.s; t < n.e; t += grid) cnt[t / grid]++;
    let sounding = 0;
    const ge = [0, 0, 0, 0, 0, 0];
    for (const c of cnt) { if (!c) continue; sounding++; for (let k = 1; k <= Math.min(5, c); k++) ge[k]++; }
    let nv = 1;
    for (let k = 2; k <= 4; k++) if (ge[k] / sounding >= 0.1) nv = k;
    return nv;
  }
  function combos(n, k, start = 0, acc = [], out = []) {
    if (acc.length === k) { out.push(acc.slice()); return out; }
    for (let i = start; i < n; i++) { acc.push(i); combos(n, k, i + 1, acc, out); acc.pop(); }
    return out;
  }
  function separate(qn, nv, grid, fillGaps) {
    const all = qn.map((n) => n.pitch).sort((a, b) => b - a);
    const voices = [];
    for (let v = 0; v < nv; v++) {
      const c = all.length ? all[Math.min(all.length - 1, Math.floor(((v + 0.5) / nv) * all.length))] : 72 - v * 5;
      voices.push({ center: c, last: c, end: -1, notes: [] });
    }
    // regroupe les notes qui commencent ensemble
    const groups = [];
    for (const n of qn) {
      const g = groups[groups.length - 1];
      if (g && g.s === n.s) g.notes.push(n); else groups.push({ s: n.s, notes: [n] });
    }
    for (const g of groups) {
      let ns = g.notes;
      if (ns.length > nv) ns = ns.slice().sort((a, b) => b.amp - a.amp).slice(0, nv);
      ns = ns.slice().sort((a, b) => b.pitch - a.pitch);
      let best = null, bc = Infinity;
      for (const cmb of combos(nv, ns.length)) {
        let cost = 0;
        cmb.forEach((v, i) => {
          const V = voices[v];
          cost += Math.abs(ns[i].pitch - (0.7 * V.last + 0.3 * V.center));
          if (V.end > g.s + grid) cost += 6; // couperait une note encore tenue
        });
        // croisements avec les voix qui sonnent encore
        voices.forEach((V, u) => {
          if (cmb.includes(u) || V.end <= g.s) return;
          cmb.forEach((v, i) => { if ((v < u && ns[i].pitch < V.last) || (v > u && ns[i].pitch > V.last)) cost += 8; });
        });
        if (cost < bc) { bc = cost; best = cmb; }
      }
      best.forEach((v, i) => {
        const V = voices[v], n = ns[i];
        const prev = V.notes[V.notes.length - 1];
        if (prev && prev.e > n.s) prev.e = n.s;
        V.notes.push({ s: n.s, e: n.e, pitch: n.pitch, rawStart: n.rawStart, rawEnd: n.rawEnd });
        V.last = n.pitch; V.end = n.e;
      });
    }
    for (const V of voices) {
      V.notes = V.notes.filter((n) => n.e > n.s);
      for (let i = 0; i < V.notes.length; i++) {
        const n = V.notes[i], nx = V.notes[i + 1];
        // petits silences comblés ; après une note longue, jusqu'à une croche (l'analyse coupe souvent tôt)
        if (fillGaps && nx && (nx.s - n.e <= grid || (nx.s - n.e <= 240 && n.e - n.s >= 720))) n.e = nx.s;
        // note longue suivie d'un silence : fin arrondie à la croche (même règle que le micro)
        // (Basic Pitch arrête souvent les notes un peu tôt ; au-delà de 2 temps, on arrondit au temps)
        if ((!nx || nx.s - n.e > grid) && n.e - n.s >= 480) {
          n.e = n.e - n.s >= 900 ? Math.max(n.s + grid, Math.ceil((n.rawEnd - 168) / 480) * 480) : Math.max(n.s + grid, Math.ceil((n.rawEnd - 72) / 240) * 240);
        }
        if (nx && n.e > nx.s) n.e = nx.s;
      }
    }
    return voices.map((V) => V.notes);
  }

  // ---------------------------------------------------------------- tonalité (profils de Krumhansl)
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b) {
    const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return n / Math.sqrt(da * db || 1);
  }
  const wrapFifths = (f) => ((((f + 6) % 12) + 12) % 12) - 6;
  function detectKey(voices) {
    const h = new Array(12).fill(0);
    for (const v of voices) for (const n of v) h[n.pitch % 12] += n.e - n.s;
    let best = { r: -2, fifths: 0, minor: false };
    for (let t = 0; t < 12; t++) {
      const rot = (prof) => prof.map((_, i) => prof[(i - t + 12) % 12]);
      const rM = corr(h, rot(MAJ)), rm = corr(h, rot(MIN));
      if (rM > best.r) best = { r: rM, fifths: wrapFifths(t * 7), minor: false };
      if (rm > best.r) best = { r: rm, fifths: wrapFifths((t + 3) * 7), minor: true };
    }
    return best;
  }
  function keyName(fifths, minor) {
    const k = M.KEYS[fifths] || M.KEYS[0];
    return minor ? k[2] : k[1];
  }

  // ---------------------------------------------------------------- choix des flûtes et transposition
  const RECS = ['soprano', 'alto', 'tenor', 'bass']; // du plus aigu au plus grave
  function coverage(pitches, inst, T) {
    const d = M.INSTRUMENTS[inst];
    if (!d.range) return 1;
    let ok = 0;
    for (const p of pitches) { const w = p + T - (d.soundShift || 0); if (w >= d.range[0] && w <= d.range[1]) ok++; }
    return pitches.length ? ok / pitches.length : 1;
  }
  // registre « naturel » de chaque flûte (hauteur sonore) : bas-médium de la tessiture
  const SWEET = { soprano: 79, alto: 72, tenor: 67, bass: 60 };
  function centerFit(pitches, inst, T) {
    const s = pitches.slice().sort((a, b) => a - b);
    const med = (s[s.length >> 1] || 70) + T;
    return 1 - Math.min(1, Math.abs(med - SWEET[inst]) / 12);
  }
  function chooseInstruments(voices, T) {
    const P_ = voices.map((v) => v.map((n) => n.pitch));
    const nv = voices.length;
    let best = null, bs = -Infinity;
    const rec = (i, maxRank, acc) => {
      if (i === nv) {
        let s = 0;
        acc.forEach((inst, v) => { s += coverage(P_[v], inst, T) + 0.1 * centerFit(P_[v], inst, T); });
        if (s > bs) { bs = s; best = acc.slice(); }
        return;
      }
      for (let r = maxRank; r < RECS.length; r++) { acc.push(RECS[r]); rec(i + 1, r, acc); acc.pop(); }
    };
    rec(0, 0, []);
    const insts = best || voices.map(() => 'alto');
    const cov = insts.map((inst, v) => coverage(P_[v], inst, T));
    // voix impossible à jouer à la flûte : portée « mélodie »
    insts.forEach((inst, v) => {
      if (cov[v] < 0.5) {
        const s = P_[v].slice().sort((a, b) => a - b);
        insts[v] = (s[s.length >> 1] || 70) + T < 58 ? 'melodyBass' : 'melody';
        cov[v] = 1;
      }
    });
    return { insts, cov };
  }
  function suggestTransposition(voices, key) {
    const total = voices.reduce((a, v) => a + v.length, 0) || 1;
    const opts = [];
    for (let T = -6; T <= 6; T++) {
      const ch = chooseInstruments(voices, T);
      const avg = ch.cov.reduce((a, c, v) => a + c * voices[v].length, 0) / total;
      const f = wrapFifths(key.fifths + 7 * T);
      opts.push({ T, fifths: f, cov: avg, insts: ch.insts, score: 100 * avg - 2 * Math.abs(f) - 1.5 * Math.abs(T) });
    }
    opts.sort((a, b) => b.score - a.score);
    const zero = opts.find((o) => o.T === 0);
    const best = opts[0];
    // on ne propose de transposer que si cela aide vraiment
    const rec = best.T !== 0 && best.score > zero.score + 3 ? best : zero;
    return { options: opts.sort((a, b) => a.T - b.T), recommended: rec.T };
  }

  // ---------------------------------------------------------------- chaîne complète (rapide : relancée à chaque réglage)
  function compute(ctx, o) {
    const notes = ctx.notesBySens[o.sens] || (ctx.notesBySens[o.sens] = extractNotes(ctx.raw, o.sens));
    if (!notes.length) return { empty: true };
    // pulsation attendue : la noire (~120) ; la noire pointée (~70) en 6/8, 9/8, 12/8
    const bt = trackBeats(notes, ctx.duration, o.bpm || null, o.sig && meterInfo(o.sig).beatTicks === 720 ? 0.85 : 0.5);
    const sig = o.sig || detectMeter(notes, bt.beats);
    const qz = quantize(notes, bt.beats, sig, o.grid || 120);
    const nv = o.voices || autoVoices(qz.notes, o.grid || 120);
    const voices = separate(qz.notes, nv, o.grid || 120, o.fillGaps !== false);
    const key = detectKey(voices);
    const tr = suggestTransposition(voices, key);
    const T = o.T != null ? o.T : tr.recommended;
    const fifths = wrapFifths(key.fifths + 7 * T);
    const ch = chooseInstruments(voices, T);
    const quarterBpm = Math.round(bt.bpm * (meterInfo(sig).beatTicks / 480));
    return { notes: notes.length, autoSig: !o.sig, bpm: quarterBpm, beatBpm: Math.round(bt.bpm), sig, pickup: qz.pickup, voices, nv, autoNv: o.voices ? null : nv, key, T, fifths, tr, insts: ch.insts, cov: ch.cov };
  }

  function buildScore(res, title, insts) {
    insts = insts || res.insts;
    const sc = M.newScore({ title, composer: '', fifths: res.fifths, timeSig: res.sig, pickup: res.pickup, tempo: Math.max(30, Math.min(240, res.bpm)), measures: 1, instruments: insts });
    res.voices.forEach((v, i) => {
      const d = M.INSTRUMENTS[insts[i]];
      for (const n of v) {
        const w = n.pitch + res.T - (d.soundShift || 0);
        M.placeNote(sc, i, n.s, n.e - n.s, [M.spell(w, res.fifths)], M.hintForTicks(n.e - n.s));
      }
    });
    return sc;
  }

  P.audioImport = { isAudio: (name) => AUDIO_EXT.test(name || ''), lib, decode, analyze, extractNotes, trackBeats, detectMeter, quantize, detectKey, compute, buildScore, keyName, coverage };
})();
