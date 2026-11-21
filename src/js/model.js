// Partoch editor — modèle de partition
// Chaque portée stocke ses notes sur une ligne de temps absolue (ticks).
// Les mesures, silences et liaisons de barre sont calculés à l'affichage.
(function () {
  const P = (window.P = window.P || {});

  const TPQ = 480; // ticks par noire
  const DUR_TICKS = { w: 1920, h: 960, q: 480, '8': 240, '16': 120, '32': 60 };
  const DUR_LIST = ['w', 'h', 'q', '8', '16', '32'];
  const DUR_NAMES = { w: 'Ronde', h: 'Blanche', q: 'Noire', '8': 'Croche', '16': 'Double croche', '32': 'Triple croche' };
  const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
  const STEP_EN = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const STEP_FR = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
  const FIFTH_POS = [0, 2, 4, -1, 1, 3, 5]; // position sur la ligne des quintes
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
  const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

  // Tonalités majeures indexées par nombre d'altérations (-7..7)
  const KEYS = {
    '-7': ['Cb', 'Do♭ majeur', 'La♭ mineur'], '-6': ['Gb', 'Sol♭ majeur', 'Mi♭ mineur'],
    '-5': ['Db', 'Ré♭ majeur', 'Si♭ mineur'], '-4': ['Ab', 'La♭ majeur', 'Fa mineur'],
    '-3': ['Eb', 'Mi♭ majeur', 'Do mineur'], '-2': ['Bb', 'Si♭ majeur', 'Sol mineur'],
    '-1': ['F', 'Fa majeur', 'Ré mineur'], '0': ['C', 'Do majeur', 'La mineur'],
    '1': ['G', 'Sol majeur', 'Mi mineur'], '2': ['D', 'Ré majeur', 'Si mineur'],
    '3': ['A', 'La majeur', 'Fa♯ mineur'], '4': ['E', 'Mi majeur', 'Do♯ mineur'],
    '5': ['B', 'Si majeur', 'Sol♯ mineur'], '6': ['F#', 'Fa♯ majeur', 'Ré♯ mineur'],
    '7': ['C#', 'Do♯ majeur', 'La♯ mineur'],
  };

  // Instruments. range = tessiture ÉCRITE (MIDI), soundShift = transposition à l'écoute.
  const INSTRUMENTS = {
    soprano: { name: 'Flûte soprano', short: 'S.', clef: 'treble', clefAnn: '8va', soundShift: 12, range: [60, 86], recorder: true },
    alto: { name: 'Flûte alto', short: 'A.', clef: 'treble', soundShift: 0, range: [65, 91], recorder: true },
    tenor: { name: 'Flûte ténor', short: 'T.', clef: 'treble', soundShift: 0, range: [60, 86], recorder: true },
    bass: { name: 'Flûte basse', short: 'B.', clef: 'bass', clefAnn: '8va', soundShift: 12, range: [41, 67], recorder: true },
    melody: { name: 'Mélodie', short: 'Mél.', clef: 'treble', soundShift: 0, range: null },
    melodyBass: { name: 'Mélodie (clé de fa)', short: 'Mél.', clef: 'bass', soundShift: 0, range: null },
    piano: { name: 'Piano', short: 'Pno.', clef: 'treble', soundShift: 0, range: null, grand: true },
  };

  // Nuances (niveau de jeu), articulations, ornements, sauts (D.C., D.S.)
  const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz', 'fp'];
  const DYN_LEVEL = { pp: 0.38, p: 0.52, mp: 0.66, mf: 0.8, f: 0.94, ff: 1.08 };
  const ARTICULATIONS = ['stacc', 'staccmo', 'ten', 'acc', 'marc'];
  const ORNAMENTS = ['tr', 'mord', 'prall', 'turn'];
  const JUMPS = { dc: 'D.C.', dcFine: 'D.C. al Fine', dcCoda: 'D.C. al Coda', ds: 'D.S.', dsFine: 'D.S. al Fine', dsCoda: 'D.S. al Coda' };
  // annotations rattachées à une portée : à un instant (t) ou sur une étendue (start → end)
  const TICK_LISTS = ['dyns', 'lyrics', 'chords', 'figures'];
  const SPAN_LISTS = ['slurs', 'hairpins'];

  // Clés : diatonique de la 5e ligne (ligne du haut)
  const CLEF_TOP = { treble: 5 * 7 + 3, bass: 3 * 7 + 5 }; // F5, A3

  function durTicks(dur, dots) {
    let t = DUR_TICKS[dur];
    let add = t;
    for (let i = 0; i < (dots || 0); i++) { add /= 2; t += add; }
    return t;
  }
  function hintForTicks(len) {
    for (const d of DUR_LIST) for (let dots = 0; dots <= 2; dots++) if (durTicks(d, dots) === len) return { dur: d, dots };
    return null;
  }
  function keyAlter(step, fifths) {
    if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
    if (fifths < 0) return FLAT_ORDER.indexOf(step) < -fifths ? -1 : 0;
    return 0;
  }
  function midiOf(p) { return 12 * (p.oct + 1) + STEP_PC[p.step] + p.alt; }
  function dnOf(p) { return p.oct * 7 + p.step; }
  function pitchFromDn(dn, fifths) {
    const step = ((dn % 7) + 7) % 7;
    const oct = Math.floor(dn / 7);
    return { step, oct, alt: keyAlter(step, fifths) };
  }
  // Orthographe d'un numéro MIDI dans une tonalité donnée
  function spell(midi, fifths) {
    const pc = ((midi % 12) + 12) % 12;
    let best = null, bestScore = Infinity;
    for (let step = 0; step < 7; step++) {
      let alt = pc - STEP_PC[step];
      if (alt > 6) alt -= 12;
      if (alt < -6) alt += 12;
      if (Math.abs(alt) > 2) continue;
      const pos = FIFTH_POS[step] + 7 * alt;
      const lo = fifths - 1, hi = fifths + 5;
      let dist = pos < lo ? lo - pos : pos > hi ? pos - hi : 0;
      dist += Math.abs(alt) === 2 ? 3 : 0;
      // départage : dièses dans les tonalités à dièses, bémols sinon
      const tie = (alt > 0 && fifths < 0) || (alt < 0 && fifths >= 0) ? 0.1 : 0;
      if (dist + tie < bestScore) { bestScore = dist + tie; best = { step, alt }; }
    }
    const oct = Math.floor((midi - best.alt - STEP_PC[best.step]) / 12) - 1;
    return { step: best.step, oct, alt: best.alt };
  }
  function altSymbol(alt) { return { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' }[alt]; }
  function pitchName(p, lang) {
    const n = (lang === 'en' ? STEP_EN : STEP_FR)[p.step];
    return n + altSymbol(p.alt) + p.oct;
  }

  // ---------- Mesures : levée (anacrouse) et changements de métrique ----------
  // score.timeSig = métrique de départ ; score.sigChanges = [{m, sig}] ; score.pickup = durée de la levée (0 = aucune)
  function sigLen(sig) { return (sig[0] * 1920) / sig[1]; }
  function sigBeat(sig) {
    const [num, den] = sig;
    // mesures composées : la pulsation est la noire pointée
    if (den === 8 && num % 3 === 0 && num > 3) return 720;
    return 1920 / den;
  }
  function sameSig(a, b) { return a[0] === b[0] && a[1] === b[1]; }
  function sortedChanges(score) { return (score.sigChanges || []).slice().sort((a, b) => a.m - b.m); }

  // Table des mesures : [{m, start, len, sig, showSig, pickup}]
  function measureTable(score) {
    const out = [];
    const ch = sortedChanges(score);
    let sig = score.timeSig, t = 0, ci = 0;
    for (let m = 0; m < score.measures; m++) {
      let show = m === 0;
      while (ci < ch.length && ch[ci].m <= m) {
        if (!sameSig(ch[ci].sig, sig)) { if (ch[ci].m === m) show = true; sig = ch[ci].sig; }
        ci++;
      }
      const full = sigLen(sig);
      const pick = m === 0 && score.pickup > 0 && score.pickup < full;
      const len = pick ? score.pickup : full;
      out.push({ m, start: t, len, sig, showSig: show, pickup: pick });
      t += len;
    }
    return out;
  }
  function measureAt(score, tick, tab) {
    tab = tab || measureTable(score);
    if (tick <= 0 || !tab.length) return 0;
    const last = tab[tab.length - 1];
    const end = last.start + last.len;
    if (tick >= end) return tab.length + Math.floor((tick - end) / sigLen(last.sig));
    let lo = 0, hi = tab.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tab[mid].start <= tick) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function measureStart(score, m, tab) {
    tab = tab || measureTable(score);
    if (m < tab.length) return tab[m].start;
    const last = tab[tab.length - 1];
    return last.start + last.len + (m - tab.length) * sigLen(last.sig);
  }
  function totalTicks(score, tab) { return measureStart(score, score.measures, tab); }
  function sigAt(score, m) {
    let sig = score.timeSig;
    for (const c of sortedChanges(score)) if (c.m <= m) sig = c.sig;
    return sig;
  }
  function measureNumber(score, m) { return m + (score.pickup > 0 ? 0 : 1); }
  function measureTicks(score) { return sigLen(score.timeSig); }
  function beatTicks(score) { return sigBeat(score.timeSig); }
  // Temps forts / faibles entre a et b (métronome) ; une levée est calée sur la fin de la mesure
  function beatsBetween(score, a, b, tab) {
    tab = tab || measureTable(score);
    const out = [];
    for (const ms of tab) {
      if (ms.start + ms.len <= a || ms.start >= b) continue;
      const bt = sigBeat(ms.sig), full = sigLen(ms.sig);
      const off = ms.pickup ? full - ms.len : 0;
      for (let k = Math.ceil(off / bt) * bt; k < full; k += bt) {
        const t = ms.start + k - off;
        if (t >= a && t < b) out.push({ tick: t, accent: k === 0 });
      }
    }
    return out;
  }
  function beatFloor(score, tick, tab) {
    tab = tab || measureTable(score);
    const m = Math.min(measureAt(score, tick, tab), tab.length - 1);
    const ms = tab[m];
    const bt = sigBeat(ms.sig), off = ms.pickup ? sigLen(ms.sig) - ms.len : 0;
    return Math.max(ms.start, ms.start + Math.floor((tick - ms.start + off) / bt) * bt - off);
  }
  // Nettoie les changements de métrique (tri, doublons, changements inutiles) et la levée
  function normalizeSigs(score) {
    const byM = new Map();
    for (const c of score.sigChanges || []) {
      if (!c || !Array.isArray(c.sig)) continue;
      const m = Math.round(+c.m), sig = [Math.max(1, +c.sig[0] || 4), [1, 2, 4, 8, 16, 32].includes(+c.sig[1]) ? +c.sig[1] : 4];
      if (m > 0 && m < score.measures) byM.set(m, sig);
    }
    const out = [];
    let cur = score.timeSig;
    for (const m of [...byM.keys()].sort((x, y) => x - y)) {
      const sig = byM.get(m);
      if (!sameSig(sig, cur)) { out.push({ m, sig }); cur = sig; }
    }
    score.sigChanges = out;
    if (!(score.pickup > 0 && score.pickup < sigLen(score.timeSig))) score.pickup = 0;
  }
  function setSigAt(score, m, sig) {
    if (m <= 0) score.timeSig = sig;
    else {
      score.sigChanges = (score.sigChanges || []).filter((c) => c.m !== m);
      score.sigChanges.push({ m, sig });
    }
    normalizeSigs(score);
    ensureMeasures(score, scoreEndTick(score));
  }
  function setPickup(score, ticks) {
    score.pickup = ticks;
    normalizeSigs(score);
    ensureMeasures(score, scoreEndTick(score));
  }

  // ---------- Marques de mesure (reprises, voltas, sauts, sauts de ligne) ----------
  function markOf(score, m) { return (score.marks && score.marks[m]) || null; }
  function setMark(score, m, key, val) {
    score.marks = score.marks || {};
    const o = Object.assign({}, score.marks[m]);
    if (val == null || val === false || (Array.isArray(val) && !val.length)) delete o[key]; else o[key] = val;
    if (Object.keys(o).length) score.marks[m] = o; else delete score.marks[m];
  }
  function shiftMarks(score, fn) {
    const out = {};
    for (const k in score.marks || {}) { const m = fn(+k); if (m != null && m >= 0) out[m] = score.marks[k]; }
    score.marks = out;
  }
  function staffLists(st) { for (const k of TICK_LISTS.concat(SPAN_LISTS)) st[k] = st[k] || []; return st; }

  let idCounter = 1;
  function uid() { return 's' + Date.now().toString(36) + (idCounter++); }

  function newStaff(inst, hand) {
    const def = INSTRUMENTS[inst];
    let clef = def.clef;
    if (def.grand) clef = hand === 'L' ? 'bass' : 'treble';
    return { id: uid(), inst, hand: hand || null, clef, notes: [], slurs: [], tuplets: [], hairpins: [], dyns: [], lyrics: [], chords: [], figures: [] };
  }

  function newScore(opts) {
    opts = opts || {};
    const insts = opts.instruments || ['soprano'];
    const staves = [];
    insts.forEach((inst) => {
      if (INSTRUMENTS[inst].grand) {
        const g = uid();
        const r = newStaff(inst, 'R'); r.group = g;
        const l = newStaff(inst, 'L'); l.group = g;
        staves.push(r, l);
      } else staves.push(newStaff(inst));
    });
    const sc = {
      app: 'partoch', version: 2,
      title: opts.title || 'Sans titre',
      composer: opts.composer || '',
      tempo: opts.tempo || 90,
      timeSig: opts.timeSig || [4, 4],
      sigChanges: [],
      pickup: opts.pickup || 0,
      fifths: opts.fifths || 0,
      measures: opts.measures || 8,
      soundBank: opts.soundBank || 'musyngkite',
      staves,
      texts: [], // notes textuelles libres : { id, sid (portée), t (tick d'ancrage), dx, dy, text }
      marks: {}, // par mesure : { rs, re (nombre de passages), volta: [1, 2], segno, coda, toCoda, fine, jump, brk: 'line' | 'page' }
      tempos: [], // { t, kind: 'tempo' | 'rit' | 'accel' | 'atempo', bpm }
      layout: { mpl: 0, scale: 1, landscape: false }, // mesures par ligne (0 = auto), taille des notes, paysage
    };
    normalizeSigs(sc);
    return sc;
  }

  // ---------- Voix : une voix 2, 3, 4 est une « piste » rattachée à sa portée (voiceOf = id de la portée) ----------
  // Les pistes de voix sont rangées après toutes les portées : les indices des portées ne bougent pas.
  function isLane(st) { return !!(st && st.voiceOf); }
  function voiceNum(score, s) { return score.staves[s].voice || 1; }
  function parentIndex(score, s) {
    const st = score.staves[s];
    if (!st || !st.voiceOf) return s;
    const i = score.staves.findIndex((o) => o.id === st.voiceOf);
    return i < 0 ? s : i;
  }
  function lanesOf(score, ps) {
    const id = score.staves[ps].id;
    const out = [ps];
    score.staves.forEach((o, i) => { if (o.voiceOf === id) out.push(i); });
    return out.sort((a, b) => voiceNum(score, a) - voiceNum(score, b));
  }
  function laneFor(score, ps, voice, create) {
    ps = parentIndex(score, ps);
    if (!voice || voice <= 1) return ps;
    const p = score.staves[ps];
    let i = score.staves.findIndex((o) => o.voiceOf === p.id && o.voice === voice);
    if (i < 0 && create) {
      score.staves.push({ id: uid(), inst: p.inst, hand: p.hand, clef: p.clef, voiceOf: p.id, voice, notes: [], slurs: [], tuplets: [] });
      i = score.staves.length - 1;
    }
    return i;
  }
  function visualStaves(score) { const out = []; score.staves.forEach((st, i) => { if (!st.voiceOf) out.push(i); }); return out; }
  function staffInRange(score, s, r) { const p = parentIndex(score, s); return p >= r.s0 && p <= r.s1; }

  // Liste des instruments (dans l'ordre) d'une partition, les pianos comptant une fois
  function scoreInstruments(score) {
    const out = [];
    const seen = new Set();
    for (const s of score.staves) {
      if (s.voiceOf) continue;
      if (s.group) { if (seen.has(s.group)) continue; seen.add(s.group); }
      out.push(s.inst);
    }
    return out;
  }

  // ---------- Opérations sur la ligne de temps ----------
  function sortNotes(notes) { notes.sort((a, b) => a.start - b.start); return notes; }
  function noteEnd(n) { return n.start + n.len; }
  function clonePitches(ps) { return ps.map((p) => ({ step: p.step, oct: p.oct, alt: p.alt })); }
  function cloneGraces(gs) { return gs && gs.length ? gs.map((g) => ({ pitches: clonePitches(g.pitches), dur: g.dur, slash: !!g.slash })) : undefined; }

  // Efface [a,b) sur une portée : les notes qui commencent avant a sont raccourcies,
  // ce qui dépasse après b devient du silence.
  function clearRange(notes, a, b) {
    const out = [];
    for (const n of notes) {
      if (noteEnd(n) <= a || n.start >= b) { out.push(n); continue; }
      if (n.start < a) {
        const len = a - n.start;
        const h = hintForTicks(len);
        out.push({ start: n.start, len, pitches: n.pitches, tie: false, dur: h ? h.dur : undefined, dots: h ? h.dots : undefined, graces: n.graces });
      }
    }
    return out;
  }

  function ensureMeasures(score, endTick) {
    const tab = measureTable(score);
    if (endTick > totalTicks(score, tab)) score.measures = measureAt(score, endTick - 1, tab) + 1;
  }

  // ---------- n-olets (triolets…) : {start, len (durée réelle), num (notes jouées), den (à la place de)} ----------
  function tupletsOf(score, s) { const st = score.staves[s]; return (st.tuplets = st.tuplets || []); }
  function tupletAt(score, s, t) { return tupletsOf(score, s).find((sp) => sp.start <= t && t < sp.start + sp.len) || null; }
  // retire les n-olets qui chevauchent [a,b) et renvoie la zone totale à vider
  function dropTuplets(st, a, b) {
    let lo = a, hi = b;
    const keep = [];
    for (const sp of st.tuplets || []) {
      if (sp.start < b && sp.start + sp.len > a) { lo = Math.min(lo, sp.start); hi = Math.max(hi, sp.start + sp.len); } else keep.push(sp);
    }
    st.tuplets = keep;
    return [lo, hi];
  }
  function clearForPlacement(score, s, start, len) {
    const st = score.staves[s];
    const sp = tupletAt(score, s, start);
    if (sp && start + len <= sp.start + sp.len) st.notes = clearRange(st.notes, start, start + len);
    else { const [lo, hi] = dropTuplets(st, start, start + len); st.notes = clearRange(st.notes, lo, hi); }
  }
  function createTuplet(score, s, start, len, num, den) {
    const st = score.staves[s];
    const [lo, hi] = dropTuplets(st, start, start + len);
    st.notes = clearRange(st.notes, lo, hi);
    st.tuplets.push({ start, len, num, den });
    st.tuplets.sort((a, b) => a.start - b.start);
    ensureMeasures(score, start + len);
  }
  function removeTuplet(score, s, sp) { const st = score.staves[s]; st.tuplets = tupletsOf(score, s).filter((x) => x !== sp); }

  function placeNote(score, s, start, len, pitches, hint) {
    const st = score.staves[s];
    const old = st.notes.find((x) => x.start === start);
    clearForPlacement(score, s, start, len);
    const n = { start, len, pitches: clonePitches(pitches), tie: false };
    // une note écrite par-dessus une autre au même endroit garde ses signes
    if (old) { if (old.arts) n.arts = old.arts.slice(); if (old.fermata) n.fermata = true; if (old.orn) n.orn = old.orn; }
    if (hint) { n.dur = hint.dur; n.dots = hint.dots; }
    st.notes.push(n);
    sortNotes(st.notes);
    ensureMeasures(score, start + len);
    return n;
  }
  function placeRest(score, s, start, len) {
    clearForPlacement(score, s, start, len);
    ensureMeasures(score, start + len);
  }
  function noteAt(score, s, t) { return score.staves[s].notes.find((n) => n.start === t) || null; }
  function noteCovering(score, s, t) { return score.staves[s].notes.find((n) => n.start <= t && noteEnd(n) > t) || null; }
  function nextNote(score, s, t) { return score.staves[s].notes.find((n) => n.start > t) || null; }
  function prevNote(score, s, t) {
    const ns = score.staves[s].notes;
    for (let i = ns.length - 1; i >= 0; i--) if (ns[i].start < t) return ns[i];
    return null;
  }
  function addToChord(score, s, t, pitch) {
    const n = noteAt(score, s, t);
    if (!n) return false;
    const m = midiOf(pitch);
    if (n.pitches.some((p) => midiOf(p) === m)) return false;
    n.pitches.push({ ...pitch });
    n.pitches.sort((a, b) => midiOf(a) - midiOf(b));
    return true;
  }
  function deleteAt(score, s, t, pi) {
    const st = score.staves[s];
    const n = noteAt(score, s, t);
    if (!n) return;
    if (pi != null && pi >= 0 && n.pitches.length > 1) n.pitches.splice(pi, 1);
    else st.notes = st.notes.filter((x) => x !== n);
  }
  function changeDuration(score, s, t, len, hint) {
    const n = noteAt(score, s, t);
    if (!n) return null;
    const nn = placeNote(score, s, t, len, n.pitches, hint);
    nn.tie = !!n.tie; nn.breath = !!n.breath; // garde liaison et respiration
    if (n.orn) nn.orn = n.orn;
    if (n.arts) nn.arts = n.arts.slice();
    if (n.fermata) nn.fermata = true;
    if (n.graces) nn.graces = n.graces;
    return nn;
  }
  function deleteRange(score, s0, s1, a, b) {
    score.staves.forEach((st, s) => {
      if (!staffInRange(score, s, { s0, s1 })) return;
      st.notes = clearRange(st.notes, a, b);
      // les liaisons et n-olets entièrement effacés disparaissent
      for (const k of SPAN_LISTS) st[k] = (st[k] || []).filter((sl) => !(sl.start >= a && sl.end < b));
      for (const k of TICK_LISTS) st[k] = (st[k] || []).filter((x) => x.t < a || x.t >= b);
      st.tuplets = (st.tuplets || []).filter((sp) => !(sp.start >= a && sp.start + sp.len <= b));
    });
  }
  function copyNotes(st, a, b) {
    const notes = [];
    for (const n of st.notes) {
      if (noteEnd(n) <= a || n.start >= b) continue;
      const s0 = Math.max(n.start, a), e0 = Math.min(noteEnd(n), b);
      const whole = s0 === n.start && e0 === noteEnd(n);
      notes.push({
        start: s0 - a, len: e0 - s0, pitches: clonePitches(n.pitches), tie: whole ? n.tie : false,
        dur: whole ? n.dur : undefined, dots: whole ? n.dots : undefined, breath: whole ? !!n.breath : false,
        graces: s0 === n.start ? cloneGraces(n.graces) : undefined, orn: s0 === n.start ? n.orn : undefined,
        arts: s0 === n.start && n.arts ? n.arts.slice() : undefined, fermata: whole ? n.fermata : undefined,
      });
    }
    return notes;
  }
  // Copie : une entrée par voix de chaque portée de la plage
  function copyRange(score, s0, s1, a, b) {
    const parts = [];
    for (let ps = s0; ps <= s1; ps++) {
      if (!score.staves[ps] || isLane(score.staves[ps])) continue;
      for (const s of lanesOf(score, ps)) {
        const st = score.staves[s];
        const part = {
          rel: ps - s0, voice: st.voice || 1, notes: copyNotes(st, a, b),
          tuplets: (st.tuplets || []).filter((sp) => sp.start >= a && sp.start + sp.len <= b).map((sp) => ({ ...sp, start: sp.start - a })),
        };
        for (const k of SPAN_LISTS) part[k] = (st[k] || []).filter((sl) => sl.start >= a && sl.end < b).map((sl) => ({ ...sl, start: sl.start - a, end: sl.end - a }));
        for (const k of TICK_LISTS) part[k] = (st[k] || []).filter((x) => x.t >= a && x.t < b).map((x) => ({ ...x, t: x.t - a }));
        parts.push(part);
      }
    }
    return { len: b - a, parts, nStaves: s1 - s0 + 1 };
  }
  function paste(score, s, t, clip) {
    const vis = visualStaves(score);
    const base = vis.indexOf(parentIndex(score, s));
    const end = t + clip.len;
    for (const part of clip.parts) {
      const ps = vis[base + part.rel];
      if (ps == null) continue;
      const si = laneFor(score, ps, part.voice, true);
      const st = score.staves[si];
      const [lo, hi] = dropTuplets(st, t, end);
      st.notes = clearRange(st.notes, lo, hi);
      for (const n of part.notes) st.notes.push({ ...n, start: n.start + t, pitches: clonePitches(n.pitches), graces: cloneGraces(n.graces) });
      sortNotes(st.notes);
      for (const k of SPAN_LISTS) {
        st[k] = (st[k] || []).filter((sl) => !(sl.start >= t && sl.end < end));
        for (const sl of part[k] || []) st[k].push({ ...sl, start: sl.start + t, end: sl.end + t });
        st[k].sort((x, y) => x.start - y.start);
      }
      for (const k of TICK_LISTS) {
        if (!part[k]) continue;
        st[k] = (st[k] || []).filter((x) => x.t < t || x.t >= end);
        for (const x of part[k]) st[k].push({ ...x, t: x.t + t });
        st[k].sort((x, y) => x.t - y.t);
      }
      for (const sp of part.tuplets || []) st.tuplets.push({ ...sp, start: sp.start + t });
      st.tuplets.sort((x, y) => x.start - y.start);
    }
    ensureMeasures(score, end);
  }
  // ---------- Liaisons d'expression / de phrasé ----------
  // slur = { start, end, kind: 'slur' | 'phrase' } ; start/end = début de la 1re et de la dernière note
  function slursOf(score, s) { const st = score.staves[s]; return (st.slurs = st.slurs || []); }
  function addSlur(score, s, start, end, kind) {
    const st = score.staves[s];
    st.slurs = slursOf(score, s).filter((sl) => sl.kind !== kind || sl.end < start || sl.start > end);
    st.slurs.push({ start, end, kind });
    st.slurs.sort((x, y) => x.start - y.start);
  }
  function removeSlur(score, s, sl) { const st = score.staves[s]; st.slurs = slursOf(score, s).filter((x) => x !== sl); }
  function slurAt(score, s, t, kind) {
    return slursOf(score, s).find((sl) => sl.kind === kind && (sl.start === t || sl.end === t)) || null;
  }
  function shiftSlurs(st, fn) {
    st.slurs = (st.slurs || []).map((sl) => fn({ ...sl })).filter(Boolean);
  }
  function insertMeasures(score, atMeasure, count) {
    if (atMeasure === 0 && score.pickup > 0) atMeasure = 1; // on n'insère pas avant une levée
    const tab = measureTable(score);
    const at = measureStart(score, atMeasure, tab);
    const sig = atMeasure > 0 ? sigAt(score, atMeasure - 1) : score.timeSig;
    const shift = count * sigLen(sig);
    for (const st of score.staves) {
      const out = [];
      for (const n of st.notes) {
        if (n.start >= at) out.push({ ...n, start: n.start + shift });
        else if (noteEnd(n) > at) { // coupe la note qui traverse
          const len = at - n.start, h = hintForTicks(len);
          out.push({ ...n, len, tie: false, dur: h ? h.dur : undefined, dots: h ? h.dots : undefined });
        } else out.push(n);
      }
      st.notes = out;
      for (const k of SPAN_LISTS) st[k] = (st[k] || []).map((sl) => ({ ...sl, start: sl.start >= at ? sl.start + shift : sl.start, end: sl.end >= at ? sl.end + shift : sl.end }));
      for (const k of TICK_LISTS) st[k] = (st[k] || []).map((x) => (x.t >= at ? { ...x, t: x.t + shift } : x));
      st.tuplets = (st.tuplets || []).map((sp) => (sp.start >= at ? { ...sp, start: sp.start + shift } : sp));
    }
    for (const tx of score.texts || []) if (tx.t >= at) tx.t += shift;
    score.tempos = (score.tempos || []).map((x) => (x.t >= at ? { ...x, t: x.t + shift } : x));
    shiftMarks(score, (m) => (m >= atMeasure ? m + count : m));
    score.sigChanges = (score.sigChanges || []).map((c) => (c.m >= atMeasure ? { ...c, m: c.m + count } : c));
    // les mesures insérées gardent la métrique de la mesure précédente
    if (atMeasure < score.measures && !score.sigChanges.some((c) => c.m === atMeasure + count)) {
      const after = sigAt(score, atMeasure + count);
      if (!sameSig(after, sig)) score.sigChanges.push({ m: atMeasure + count, sig: after });
    }
    score.measures += count;
    normalizeSigs(score);
  }
  function deleteMeasures(score, m0, m1) {
    const tab = measureTable(score);
    const a = tab[m0].start, b = tab[m1].start + tab[m1].len, shift = b - a, n = m1 - m0 + 1;
    const sigAfter = m1 + 1 < tab.length ? tab[m1 + 1].sig : null;
    for (const st of score.staves) {
      const kept = clearRange(st.notes, a, b);
      st.notes = kept.map((x) => (x.start >= b ? { ...x, start: x.start - shift } : x));
      for (const k of SPAN_LISTS) {
        st[k] = (st[k] || []).map((x) => ({ ...x })).map((sl) => {
          if (sl.start >= a && sl.end < b) return null; // entièrement supprimée
          if (sl.start >= b) sl.start -= shift; else if (sl.start >= a) sl.start = a;
          if (sl.end >= b) sl.end -= shift; else if (sl.end >= a) sl.end = Math.max(sl.start, a - 1);
          return sl.end > sl.start ? sl : null;
        }).filter(Boolean);
      }
      for (const k of TICK_LISTS) st[k] = (st[k] || []).filter((x) => x.t < a || x.t >= b).map((x) => (x.t >= b ? { ...x, t: x.t - shift } : x));
      st.tuplets = (st.tuplets || []).filter((sp) => sp.start < a || sp.start >= b).map((sp) => (sp.start >= b ? { ...sp, start: sp.start - shift } : sp));
    }
    score.texts = (score.texts || []).filter((tx) => tx.t < a || tx.t >= b).map((tx) => (tx.t >= b ? { ...tx, t: tx.t - shift } : tx));
    score.tempos = (score.tempos || []).filter((x) => x.t < a || x.t >= b).map((x) => (x.t >= b ? { ...x, t: x.t - shift } : x));
    shiftMarks(score, (m) => (m < m0 ? m : m > m1 ? m - n : null));
    let ch = (score.sigChanges || []).filter((c) => c.m < m0 || c.m > m1).map((c) => (c.m > m1 ? { ...c, m: c.m - n } : c));
    if (m0 === 0) {
      score.pickup = 0;
      if (sigAfter) score.timeSig = sigAfter;
    } else if (sigAfter && !ch.some((c) => c.m === m0)) ch.push({ m: m0, sig: sigAfter });
    score.sigChanges = ch;
    score.measures = Math.max(1, score.measures - n);
    normalizeSigs(score);
  }
  function setTimeSig(score, num, den) { setSigAt(score, 0, [num, den]); }
  function transpose(score, semis, newFifths, range) {
    const tr = (p) => spell(midiOf(p) + semis, newFifths);
    for (let s = 0; s < score.staves.length; s++) {
      if (range && !staffInRange(score, s, range)) continue;
      for (const n of score.staves[s].notes) {
        if (range && (n.start < range.a || n.start >= range.b)) continue;
        n.pitches = n.pitches.map(tr);
        if (n.graces) n.graces.forEach((g) => { g.pitches = g.pitches.map(tr); });
      }
    }
    if (!range) score.fifths = newFifths;
  }
  function scoreEndTick(score) {
    let end = 0;
    for (const st of score.staves) for (const n of st.notes) end = Math.max(end, noteEnd(n));
    return end;
  }

  // ---------- Découpage en mesures (pour l'affichage) ----------
  const NOTE_CANDIDATES = [];
  for (const d of DUR_LIST) {
    NOTE_CANDIDATES.push({ dur: d, dots: 1, len: durTicks(d, 1), base: DUR_TICKS[d] });
    NOTE_CANDIDATES.push({ dur: d, dots: 0, len: durTicks(d, 0), base: DUR_TICKS[d] });
  }
  NOTE_CANDIDATES.sort((a, b) => b.len - a.len);

  // Découpe une durée en valeurs écrites, alignées sur la grille rythmique
  // beat : une note pointée qui commence à contretemps ne traverse pas un temps (croche liée plutôt que croche pointée)
  function decompose(relStart, len, allowDots, beat) {
    const out = [];
    let t = relStart, rem = len, guard = 0;
    while (rem > 0 && guard++ < 64) {
      let pick = null;
      for (const c of NOTE_CANDIDATES) {
        if (!allowDots && c.dots) continue;
        if (c.dots && beat && t % beat !== 0 && Math.floor(t / beat) !== Math.floor((t + c.len - 1) / beat)) continue;
        if (c.len <= rem && t % c.base === 0) { pick = c; break; }
      }
      if (!pick) for (const c of NOTE_CANDIDATES) { if (!c.dots && c.len <= rem) { pick = c; break; } }
      if (!pick) break; // reste plus court qu'une triple croche
      out.push({ dur: pick.dur, dots: pick.dots, len: pick.len, rel: t - relStart });
      t += pick.len; rem -= pick.len;
    }
    return out;
  }

  // Retourne, pour une portée (ou une voix), la liste des événements de chaque mesure
  function staffMeasures(score, s, tab) {
    tab = tab || measureTable(score);
    const st = score.staves[s];
    const notes = st.notes;
    const tups = (st.tuplets || []).slice().sort((x, y) => x.start - y.start);
    const result = [];
    let ni = 0;
    for (const ms of tab) {
      const a = ms.start, b = a + ms.len;
      const off = ms.pickup ? sigLen(ms.sig) - ms.len : 0; // une levée est alignée sur la fin de mesure
      const pieces = [];
      while (ni < notes.length && noteEnd(notes[ni]) <= a) ni++;
      for (let k = ni; k < notes.length && notes[k].start < b; k++) {
        const n = notes[k];
        const s0 = Math.max(n.start, a), e0 = Math.min(noteEnd(n), b);
        if (e0 > s0) pieces.push({ n, st: s0, en: e0 });
      }
      const spans = tups.filter((sp) => sp.start >= a && sp.start < b);
      if (!pieces.length && !spans.length) { result.push({ m: ms.m, start: a, len: ms.len, events: [], full: true }); continue; }
      const evs = [];
      const pushRest = (from, to) => {
        for (const d of decompose(from - a + off, to - from, false)) evs.push({ rest: true, dur: d.dur, dots: d.dots, start: from + d.rel, len: d.len });
      };
      const pushNote = (n, s0, e0) => {
        const whole = s0 === n.start && e0 === noteEnd(n);
        let parts;
        if (whole && n.dur && durTicks(n.dur, n.dots) === n.len) parts = [{ dur: n.dur, dots: n.dots || 0, len: n.len, rel: 0 }];
        else parts = decompose(s0 - a + off, e0 - s0, true, sigBeat(ms.sig));
        parts.forEach((d, i) => {
          const lastOfNote = e0 === noteEnd(n) && i === parts.length - 1;
          const first = s0 + d.rel === n.start;
          evs.push({
            rest: false, dur: d.dur, dots: d.dots, start: s0 + d.rel, len: d.len,
            pitches: n.pitches, tie: lastOfNote ? !!n.tie : true,
            src: n.start, tiedFromSelf: !first, breath: lastOfNote && !!n.breath,
            graces: first && n.graces && n.graces.length ? n.graces : null, orn: first ? n.orn : undefined,
            arts: first ? n.arts : undefined, fermata: lastOfNote && n.fermata,
          });
        });
      };
      // n-olet : les durées écrites sont calculées dans le temps « agrandi » (× num/den)
      const pushTuplet = (sp) => {
        const ratio = sp.num / sp.den;
        const g = { num: sp.num, den: sp.den, start: sp.start };
        const G = 30;
        const sc = (t) => Math.round(((t - sp.start) * ratio) / G) * G;
        const real = (u) => sp.start + Math.round(u / ratio);
        const scaledLen = sc(sp.start + sp.len);
        const restIn = (u0, u1) => {
          for (const d of decompose(u0, u1 - u0, false)) evs.push({ rest: true, dur: d.dur, dots: d.dots, start: real(u0 + d.rel), len: real(u0 + d.rel + d.len) - real(u0 + d.rel), tuplet: g });
        };
        let u = 0;
        for (const n of notes) {
          if (n.start < sp.start || n.start >= sp.start + sp.len) continue;
          const ns = sc(n.start), ne = Math.min(scaledLen, sc(Math.min(noteEnd(n), sp.start + sp.len)));
          if (ne <= ns || ns < u) continue;
          if (ns > u) restIn(u, ns);
          let parts;
          if (n.dur && durTicks(n.dur, n.dots) === ne - ns) parts = [{ dur: n.dur, dots: n.dots || 0, len: ne - ns, rel: 0 }];
          else parts = decompose(ns, ne - ns, true);
          const endsHere = noteEnd(n) <= sp.start + sp.len;
          parts.forEach((d, i) => {
            const u0 = ns + d.rel, u1 = u0 + d.len;
            const lastOfNote = endsHere && i === parts.length - 1;
            evs.push({
              rest: false, dur: d.dur, dots: d.dots, start: real(u0), len: real(u1) - real(u0),
              pitches: n.pitches, tie: lastOfNote ? !!n.tie : true, src: n.start, tiedFromSelf: i > 0,
              breath: lastOfNote && !!n.breath, graces: i === 0 && n.graces && n.graces.length ? n.graces : null, orn: i === 0 ? n.orn : undefined, tuplet: g,
              arts: i === 0 ? n.arts : undefined, fermata: lastOfNote && n.fermata,
            });
          });
          u = ne;
        }
        if (u < scaledLen) restIn(u, scaledLen);
      };
      let t = a, pi = 0, si = 0;
      while (t < b) {
        const sp = spans[si];
        if (sp && sp.start <= t) {
          pushTuplet(sp);
          t = Math.max(t, sp.start + sp.len);
          si++;
          while (pi < pieces.length && pieces[pi].st < t) pi++;
          continue;
        }
        const limit = sp ? sp.start : b;
        const p = pieces[pi];
        if (p && p.st < t) { pi++; continue; }
        if (p && p.st < limit) {
          if (p.st > t) pushRest(t, p.st);
          const e0 = Math.min(p.en, limit);
          pushNote(p.n, p.st, e0);
          t = e0; pi++;
        } else { pushRest(t, limit); t = limit; }
      }
      result.push({ m: ms.m, start: a, len: ms.len, events: evs, full: false });
    }
    return result;
  }

  // Événements sonores (liaisons de prolongation fusionnées). Retourne {tick, len, midi, staff, src, …}
  // legato : pas de coup de langue (note liée à la précédente par une liaison d'expression ou après une petite note)
  // slurNext : pas de silence avant la note suivante ; phraseNext : pas de respiration ; breath : respiration après
  // Trille : alternance rapide note / note voisine supérieure de la gamme, finit sur la note
  function trillEvents(ev, p, score, len) {
    const upStep = (p.step + 1) % 7;
    const up = midiOf({ step: upStep, oct: p.oct + (upStep === 0 ? 1 : 0), alt: keyAlter(upStep, score.fifths) });
    const tps = (score.tempo || 90) / 60 * TPQ; // ticks par seconde
    const each = Math.max(30, Math.round(Math.max(60, tps * 0.11) / 10) * 10);
    // trille baroque : commence sur la note du dessus, alterne, finit sur la note écrite (qui prend le reste)
    let k = Math.floor(len / each);
    if (k < 2) return [ev];
    if (k % 2 === 1) k--; // nombre pair : note du dessus en premier, note écrite en dernier
    const out = [];
    for (let i = 0; i < k; i++) {
      const last = i === k - 1;
      const t0 = ev.tick + i * each;
      const upper = i % 2 === 0;
      out.push(Object.assign({}, ev, {
        tick: t0, len: last ? ev.tick + len - t0 : each,
        midi: upper ? ev.midi + up - ev.written : ev.midi, written: upper ? up : ev.written,
        legato: i > 0 ? true : ev.legato, slurNext: last ? ev.slurNext : true, phraseNext: last ? ev.phraseNext : false,
        breath: last ? ev.breath : false, trill: true,
      }));
    }
    return out;
  }
  // Mordant (note, note inférieure, note), mordant supérieur (note, note supérieure, note), gruppetto (sup., note, inf., note)
  function neighbor(p, dir, score) {
    const dn = p.oct * 7 + p.step + dir;
    const step = ((dn % 7) + 7) % 7;
    return midiOf({ step, oct: Math.floor(dn / 7), alt: keyAlter(step, score.fifths) });
  }
  function ornamentEvents(ev, p, score, len, kind) {
    const tps = (score.tempo || 90) / 60 * TPQ;
    const each = Math.max(30, Math.min(len / 4, Math.round(Math.max(60, tps * 0.1) / 10) * 10));
    const seq = kind === 'mord' ? [0, -1] : kind === 'prall' ? [0, 1] : [1, 0, -1];
    if (len < each * (seq.length + 1)) return [ev];
    const out = [];
    seq.forEach((d, i) => {
      const w = d === 0 ? ev.written : neighbor(p, d, score);
      out.push(Object.assign({}, ev, { tick: ev.tick + i * each, len: each, midi: ev.midi + w - ev.written, written: w, legato: i > 0 ? true : ev.legato, slurNext: true, phraseNext: false, breath: false, trill: true }));
    });
    const t0 = ev.tick + seq.length * each;
    out.push(Object.assign({}, ev, { tick: t0, len: ev.tick + len - t0, legato: true }));
    return out;
  }
  // niveau de jeu (nuances et soufflets) d'une portée à un instant
  function dynamicsOf(st) {
    const dyns = (st.dyns || []).slice().sort((a, b) => a.t - b.t);
    const pins = st.hairpins || [];
    const levelAt = (t) => {
      let lv = DYN_LEVEL.mf;
      for (const d of dyns) { if (d.t > t) break; if (DYN_LEVEL[d.v] != null) lv = DYN_LEVEL[d.v]; else if (d.v === 'fp') lv = DYN_LEVEL.p; }
      return lv;
    };
    return (t) => {
      let lv = levelAt(t);
      const hit = dyns.find((d) => d.t === t);
      let acc = hit && (hit.v === 'sfz' || hit.v === 'fp') ? 1.35 : 1;
      if (hit && hit.v === 'fp') acc = DYN_LEVEL.f / lv;
      for (const hp of pins) {
        if (t <= hp.start || t > hp.endT) continue;
        // vers la nuance suivante (si elle arrive juste après le soufflet), sinon un degré de plus ou de moins
        const a = levelAt(hp.start);
        const nx = dyns.find((d) => d.t >= hp.endT && d.t <= hp.endT + TPQ && DYN_LEVEL[d.v] != null);
        const b = nx ? DYN_LEVEL[nx.v] : a + (hp.kind === 'cresc' ? 0.16 : -0.16);
        lv = a + (b - a) * Math.min(1, (t - hp.start) / Math.max(1, hp.endT - hp.start));
      }
      return Math.max(0.2, Math.min(1.25, lv)) * acc;
    };
  }
  function playbackEvents(score) {
    const out = [];
    score.staves.forEach((st, s) => {
      // nuances : celles de la portée (les voix 2… suivent leur portée)
      const pst = st.voiceOf ? score.staves.find((o) => o.id === st.voiceOf) || st : st;
      const pinsEnd = (pst.hairpins || []).map((hp) => {
        const last = st.notes.find((n) => n.start === hp.end) || (pst.notes || []).find((n) => n.start === hp.end);
        return { ...hp, endT: last ? noteEnd(last) : hp.end };
      });
      const velAt = dynamicsOf({ dyns: pst.dyns, hairpins: pinsEnd });
      const def = INSTRUMENTS[st.inst];
      const shiftSnd = def.soundShift || 0;
      const notes = st.notes;
      const consumed = new Set();
      const slurs = st.slurs || [];
      const inSlur = (t, kind, cond) => slurs.some((sl) => sl.kind === kind && cond(sl, t));
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const prev = notes[i - 1];
        const tiedIn = prev && prev.tie && noteEnd(prev) === n.start;
        // petites notes : prises sur le début de la note principale
        let gShift = 0;
        const gr = n.graces;
        if (gr && gr.length && !tiedIn) {
          const each = gr.every((g) => g.slash)
            ? Math.max(20, Math.round(Math.min(60, n.len / 4 / gr.length)))
            : Math.max(20, Math.round(Math.min(DUR_TICKS[gr[0].dur] || 120, n.len / 2 / gr.length)));
          gr.forEach((g, k) => {
            for (const p of g.pitches) {
              const midi = midiOf(p);
              out.push({ tick: n.start + k * each, len: each, midi: midi + shiftSnd, written: midi, staff: s, src: n.start, endSrc: n.start, grace: true, legato: k > 0, slurNext: true, phraseNext: false, breath: false, vel: 0.8 * velAt(n.start) });
            }
          });
          gShift = each * gr.length;
        }
        for (const p of n.pitches) {
          const midi = midiOf(p);
          if (consumed.has(i + ':' + midi)) continue;
          let len = n.len, cur = n, j = i, tied = false;
          while (cur.tie) {
            const nx = notes[j + 1];
            if (!nx || nx.start !== noteEnd(cur) || !nx.pitches.some((q) => midiOf(q) === midi)) break;
            consumed.add(j + 1 + ':' + midi);
            len += nx.len; cur = nx; j++; tied = true;
          }
          const arts = n.arts || [];
          const vel = 0.8 * velAt(n.start) * (arts.includes('marc') ? 1.35 : arts.includes('acc') ? 1.25 : 1);
          const ev0 = {
            vel, stacc: arts.includes('staccmo') ? 0.3 : arts.includes('stacc') ? 0.5 : 0, ten: arts.includes('ten'), fermata: !!cur.fermata,
            tick: n.start + gShift, len: len - gShift, midi: midi + shiftSnd, written: midi, staff: s, src: n.start, endSrc: cur.start, tied,
            legato: gShift > 0 || (i > 0 && noteEnd(prev) === n.start && !prev.breath && inSlur(n.start, 'slur', (sl, t) => t > sl.start && t <= sl.end)),
            slurNext: inSlur(cur.start, 'slur', (sl, t) => t >= sl.start && t < sl.end),
            phraseNext: inSlur(cur.start, 'phrase', (sl, t) => t >= sl.start && t < sl.end),
            breath: !!cur.breath,
          };
          if (n.orn === 'tr' && p === n.pitches[0] && !tiedIn) out.push(...trillEvents(ev0, p, score, len - gShift));
          else if (n.orn && p === n.pitches[0] && !tiedIn) out.push(...ornamentEvents(ev0, p, score, len - gShift, n.orn));
          else out.push(ev0);
        }
      }
    });
    out.sort((a, b) => a.tick - b.tick);
    return out;
  }

  // Ordre de lecture des mesures : reprises (avec voltas), D.C. / D.S., Fine, Coda
  function playOrder(score, nM) {
    const mk = (m) => markOf(score, m) || {};
    const runMax = new Array(nM).fill(0); // dernière volta de chaque groupe (jouée après un D.C. / D.S.)
    for (let m = 0; m < nM;) {
      if (mk(m).volta) { let e = m, mx = 0; while (e < nM && mk(e).volta) { mx = Math.max(mx, ...mk(e).volta); e++; } for (let k = m; k < e; k++) runMax[k] = mx; m = e; } else m++;
    }
    let segno = 0, codaM = null;
    for (let m = 0; m < nM; m++) { if (mk(m).segno && !segno) segno = m; if (mk(m).coda && codaM == null) codaM = m; }
    const order = [], endCount = {};
    let m = 0, start = 0, pass = 1, jumped = null, fromRepeat = false, afterRepeat = false, guard = 0;
    while (m < nM && guard++ < 20000) {
      const k = mk(m);
      if (k.rs && !fromRepeat) { start = m; pass = 1; afterRepeat = false; }
      fromRepeat = false;
      if (k.volta) {
        const want = jumped ? runMax[m] : pass;
        if (!k.volta.includes(want)) { m++; continue; }
      } else if (afterRepeat) { pass = 1; afterRepeat = false; }
      order.push(m);
      if (jumped && jumped.fine && k.fine) break;
      if (jumped && jumped.coda && k.toCoda && codaM != null && codaM > m) { m = codaM; continue; }
      if (k.re && !jumped) {
        const times = Math.max(2, k.re | 0 || 2), c = endCount[m] || 1;
        if (c < times) { endCount[m] = c + 1; pass = c + 1; m = start; fromRepeat = true; continue; }
        start = m + 1; afterRepeat = true;
      }
      if (k.jump && !jumped) {
        jumped = { fine: !/Coda/.test(k.jump), coda: /Coda/.test(k.jump) };
        m = k.jump.startsWith('dc') ? 0 : segno; pass = 1; fromRepeat = false;
        continue;
      }
      m++;
    }
    return order;
  }
  // tempo (noires / min) à un tick, en lisant la partition dans l'ordre
  function tempoState(score, t) {
    const marks = (score.tempos || []).filter((x) => x.t < t).sort((a, b) => a.t - b.t);
    let bpm = score.tempo || 90, base = bpm;
    for (let i = 0; i < marks.length; i++) {
      const x = marks[i];
      if (x.kind === 'tempo') { bpm = base = x.bpm; } else if (x.kind === 'atempo') bpm = base;
      else { const end = rampEnd(score, x, marks[i + 1]); const to = bpm * (x.kind === 'rit' ? 0.65 : 1.35); bpm = t >= end ? to : bpm + (to - bpm) * (t - x.t) / (end - x.t); }
    }
    return { bpm, base };
  }
  // un rit. / accel. dure jusqu'à l'indication suivante, deux mesures au plus
  function rampEnd(score, x, next) {
    const tab = measureTable(score);
    const lim = measureStart(score, measureAt(score, x.t, tab) + 2, tab);
    return Math.max(x.t + 1, Math.min(lim, next ? next.t : Infinity));
  }
  // Interprétation : segments joués (reprises déroulées), événements et carte du temps (tempo, rit., points d'orgue)
  // opts.range = {a, b} : joue seulement ce passage, tel quel ; opts.endTick : fin imposée (enregistrement) ; opts.plain : ni reprises ni tempos
  function performance(score, opts) {
    opts = opts || {};
    const tab = measureTable(score);
    const base = playbackEvents(score);
    const segs = [];
    if (opts.range) segs.push({ a: opts.range.a, b: opts.range.b, p: 0 });
    else {
      const total = totalTicks(score, tab);
      const lastM = Math.min(measureAt(score, Math.max(0, scoreEndTick(score) - 1), tab), tab.length - 1);
      const endTick = opts.endTick || Math.min(total, tab[lastM].start + tab[lastM].len) || total;
      const nM = Math.min(tab.length, measureAt(score, Math.max(0, endTick - 1), tab) + 1);
      const order = opts.plain ? [...Array(nM).keys()] : playOrder(score, nM);
      let p = 0;
      for (const m of order) {
        const a = tab[m].start, b = Math.min(tab[m].start + tab[m].len, endTick);
        const last = segs[segs.length - 1];
        if (last && last.b === a) last.b = b; else segs.push({ a, b, p });
        p += b - a;
      }
      if (opts.endTick && endTick > total) { const last = segs[segs.length - 1]; if (last) last.b = endTick; }
      let q = 0; for (const sg of segs) { sg.p = q; q += sg.b - sg.a; }
    }
    const end = segs.reduce((acc, sg) => acc + sg.b - sg.a, 0);
    // événements
    const events = [], beats = [];
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      for (const e of base) {
        if (e.tick < sg.a || e.tick >= sg.b) continue;
        const len = Math.min(e.len, sg.b - e.tick);
        events.push(Object.assign({}, e, { tick: e.tick - sg.a + sg.p, len, cut: len < e.len }));
      }
      for (const bt of beatsBetween(score, sg.a, sg.b, tab)) beats.push({ tick: bt.tick - sg.a + sg.p, accent: bt.accent });
    }
    events.sort((x, y) => x.tick - y.tick);
    // carte du temps : secondes (vitesse 1) tous les STEP ticks
    const STEP = 10;
    const n = Math.ceil(end / STEP) + 2;
    const T = new Float64Array(n + 1);
    const segAt = (pt) => { let lo = 0, hi = segs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].p <= pt) lo = mid; else hi = mid - 1; } return segs[lo]; };
    const toScore = (pt) => { if (!segs.length) return pt; const sg = segAt(pt); return Math.min(sg.b, sg.a + pt - sg.p); };
    const marks = opts.plain ? [] : (score.tempos || []).slice().sort((a, b) => a.t - b.t);
    const bpmCache = new Map();
    const bpmAt = (t) => {
      if (!marks.length) return score.tempo || 90;
      const k = Math.round(t / STEP);
      if (!bpmCache.has(k)) bpmCache.set(k, tempoState(score, t + 0.5).bpm);
      return bpmCache.get(k);
    };
    // points d'orgue : une pause (en secondes) à la fin de la note
    const pauses = [];
    for (const e of events) {
      if (!e.fermata || e.grace) continue;
      const sec = (e.len / TPQ) * 60 / bpmAt(toScore(e.tick)) * 0.8;
      const at = e.tick + e.len;
      const old = pauses.find((x) => x.at === at);
      if (old) old.sec = Math.max(old.sec, sec); else pauses.push({ at, sec });
    }
    pauses.sort((a, b) => a.at - b.at);
    let pi = 0;
    for (let i = 1; i <= n; i++) {
      const pt = (i - 1) * STEP;
      let dt = STEP / TPQ * 60 / bpmAt(toScore(pt));
      while (pi < pauses.length && pauses[pi].at <= pt + STEP && pauses[pi].at > pt) dt += pauses[pi++].sec;
      T[i] = T[i - 1] + dt;
    }
    const timeOf = (pt) => {
      const x = Math.max(0, pt) / STEP, i = Math.min(n - 1, Math.floor(x));
      // pas d'interpolation à travers une pause : on reste sur la valeur avant la pause
      const a = T[i], b = T[i + 1], seg = STEP / TPQ * 60 / bpmAt(toScore(i * STEP));
      return a + Math.min(b - a, seg) * (x - i);
    };
    const tickAt = (sec) => {
      let lo = 0, hi = n;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= sec) lo = mid; else hi = mid - 1; }
      const a = T[lo], b = T[lo + 1] != null ? T[lo + 1] : a + 1;
      const seg = STEP / TPQ * 60 / bpmAt(toScore(lo * STEP));
      return lo * STEP + Math.min(1, (sec - a) / seg) * STEP;
    };
    const toPerf = (t) => {
      for (const sg of segs) if (t >= sg.a && t < sg.b) return sg.p + t - sg.a;
      for (const sg of segs) if (sg.a >= t) return sg.p; // dans une mesure sautée : au segment suivant
      return 0;
    };
    const pauseAt = (pt) => { const x = pauses.find((q) => q.at === pt); return x ? x.sec : 0; };
    return { segs, events, beats, end, timeOf, tickAt, toScore, toPerf, pauseAt, bpmAt: (pt) => bpmAt(toScore(pt)) };
  }

  function outOfRange(score, s, p) {
    const r = INSTRUMENTS[score.staves[s].inst].range;
    if (!r) return false;
    const m = midiOf(p);
    return m < r[0] || m > r[1];
  }
  function countOutOfRange(score) {
    let c = 0;
    score.staves.forEach((st, s) => st.notes.forEach((n) => n.pitches.forEach((p) => { if (outOfRange(score, s, p)) c++; })));
    return c;
  }

  // Validation d'un fichier chargé
  function normPitches(ps) { return (Array.isArray(ps) ? ps : []).map((p) => ({ step: +p.step, oct: +p.oct, alt: +p.alt || 0 })).filter((p) => p.step >= 0 && p.step <= 6); }
  function normalizeScore(obj) {
    if (!obj || obj.app !== 'partoch' || !Array.isArray(obj.staves)) throw new Error('Fichier Partoch invalide');
    const sc = newScore({});
    Object.assign(sc, {
      title: String(obj.title || 'Sans titre'), composer: String(obj.composer || ''),
      tempo: Math.min(400, Math.max(20, +obj.tempo || 90)),
      timeSig: Array.isArray(obj.timeSig) ? [+obj.timeSig[0] || 4, +obj.timeSig[1] || 4] : [4, 4],
      sigChanges: Array.isArray(obj.sigChanges) ? obj.sigChanges : [],
      pickup: Math.max(0, +obj.pickup || 0),
      fifths: Math.max(-7, Math.min(7, +obj.fifths || 0)),
      measures: Math.max(1, +obj.measures || 8),
      soundBank: obj.soundBank === 'fluidr3' ? 'fluidr3' : 'musyngkite',
    });
    const staves = obj.staves.filter((s) => s && INSTRUMENTS[s.inst]).map((s) => ({
      id: s.id || uid(), inst: s.inst, hand: s.hand || null, group: s.voiceOf ? undefined : s.group || undefined,
      clef: s.clef === 'bass' ? 'bass' : 'treble',
      voiceOf: s.voiceOf || undefined, voice: s.voiceOf ? Math.max(2, Math.min(4, +s.voice || 2)) : undefined,
      notes: sortNotes((s.notes || []).filter((n) => n && n.len > 0 && Array.isArray(n.pitches) && n.pitches.length).map((n) => {
        const nn = {
          start: +n.start, len: +n.len, tie: !!n.tie, dur: DUR_TICKS[n.dur] ? n.dur : undefined, dots: n.dots ? +n.dots : 0,
          breath: !!n.breath, pitches: normPitches(n.pitches),
        };
        const gs = (Array.isArray(n.graces) ? n.graces : []).map((g) => ({ pitches: normPitches(g && g.pitches), dur: DUR_TICKS[g && g.dur] ? g.dur : '8', slash: !!(g && g.slash) })).filter((g) => g.pitches.length);
        if (gs.length) nn.graces = gs;
        if (ORNAMENTS.includes(n.orn)) nn.orn = n.orn;
        const arts = (Array.isArray(n.arts) ? n.arts : []).filter((a) => ARTICULATIONS.includes(a));
        if (arts.length) nn.arts = arts;
        if (n.fermata) nn.fermata = true;
        return nn;
      }).filter((n) => n.pitches.length)),
      slurs: (s.slurs || []).filter((sl) => sl && +sl.end > +sl.start).map((sl) => ({ start: +sl.start, end: +sl.end, kind: sl.kind === 'phrase' ? 'phrase' : 'slur' })),
      tuplets: (s.tuplets || []).filter((sp) => sp && +sp.len > 0 && +sp.num > 0 && +sp.den > 0).map((sp) => ({ start: +sp.start, len: +sp.len, num: +sp.num, den: +sp.den })),
      hairpins: (s.hairpins || []).filter((h) => h && +h.end >= +h.start).map((h) => ({ start: +h.start, end: +h.end, kind: h.kind === 'dim' ? 'dim' : 'cresc' })),
      dyns: (s.dyns || []).filter((d) => d && DYNAMICS.includes(d.v)).map((d) => ({ t: +d.t || 0, v: d.v })),
      lyrics: (s.lyrics || []).filter((x) => x && String(x.text || '').trim()).map((x) => ({ t: +x.t || 0, v: Math.max(0, Math.min(4, +x.v || 0)), text: String(x.text).slice(0, 60), hyph: !!x.hyph })),
      chords: (s.chords || []).filter((x) => x && String(x.text || '').trim()).map((x) => ({ t: +x.t || 0, text: String(x.text).slice(0, 30) })),
      figures: (s.figures || []).filter((x) => x && String(x.text || '').trim()).map((x) => ({ t: +x.t || 0, text: String(x.text).slice(0, 30) })),
    }));
    // voix : rattachées à une portée existante, non vides, rangées après les portées
    const parents = staves.filter((s) => !s.voiceOf);
    const lanes = staves.filter((s) => s.voiceOf && s.notes.length && parents.some((p) => p.id === s.voiceOf));
    for (const l of lanes) { const p = parents.find((x) => x.id === l.voiceOf); l.inst = p.inst; l.clef = p.clef; l.hand = p.hand; }
    sc.staves = parents.length ? [...parents, ...lanes] : [newStaff('soprano')];
    for (const st of sc.staves) { if (!st.voiceOf) { delete st.voiceOf; delete st.voice; } if (!st.group) delete st.group; }
    sc.texts = (Array.isArray(obj.texts) ? obj.texts : []).filter((x) => x && String(x.text || '').trim() && parents.some((p) => p.id === x.sid))
      .map((x) => ({ id: x.id || uid(), sid: x.sid, t: Math.max(0, +x.t || 0), dx: +x.dx || 0, dy: Number.isFinite(+x.dy) ? +x.dy : -28, text: String(x.text).slice(0, 2000) }));
    const marks = {};
    for (const k in (obj.marks && typeof obj.marks === 'object') ? obj.marks : {}) {
      const o = obj.marks[k] || {}, x = {};
      if (o.rs) x.rs = true;
      if (o.re) x.re = Math.max(2, Math.min(9, +o.re || 2));
      if (Array.isArray(o.volta)) { const v = o.volta.map(Number).filter((y) => y >= 1 && y <= 9); if (v.length) x.volta = v; }
      for (const f of ['segno', 'coda', 'toCoda', 'fine']) if (o[f]) x[f] = true;
      if (JUMPS[o.jump]) x.jump = o.jump;
      if (o.brk === 'line' || o.brk === 'page') x.brk = o.brk;
      if (Object.keys(x).length && +k >= 0) marks[+k] = x;
    }
    sc.marks = marks;
    sc.tempos = (Array.isArray(obj.tempos) ? obj.tempos : []).filter((x) => x && ['tempo', 'rit', 'accel', 'atempo'].includes(x.kind))
      .map((x) => ({ t: Math.max(0, +x.t || 0), kind: x.kind, bpm: x.kind === 'tempo' ? Math.min(400, Math.max(20, +x.bpm || 90)) : undefined }));
    const lay = obj.layout || {};
    sc.layout = { mpl: Math.max(0, Math.min(12, +lay.mpl || 0)), scale: Math.max(0.6, Math.min(1.6, +lay.scale || 1)), landscape: !!lay.landscape };
    ensureMeasures(sc, scoreEndTick(sc));
    normalizeSigs(sc);
    return sc;
  }

  P.model = {
    TPQ, DUR_TICKS, DUR_LIST, DUR_NAMES, STEP_EN, STEP_FR, KEYS, INSTRUMENTS, CLEF_TOP,
    durTicks, hintForTicks, keyAlter, midiOf, dnOf, pitchFromDn, spell, pitchName, altSymbol,
    sigLen, sigBeat, sameSig, measureTable, measureAt, measureStart, totalTicks, sigAt, measureNumber,
    measureTicks, beatTicks, beatsBetween, beatFloor, normalizeSigs, setSigAt, setPickup,
    newScore, newStaff, scoreInstruments, noteEnd, uid,
    isLane, voiceNum, parentIndex, lanesOf, laneFor, visualStaves, staffInRange,
    tupletsOf, tupletAt, createTuplet, removeTuplet,
    clearRange, placeNote, placeRest, noteAt, noteCovering, nextNote, prevNote, addToChord, deleteAt,
    changeDuration, deleteRange, copyRange, paste, insertMeasures, deleteMeasures, setTimeSig, transpose,
    slursOf, addSlur, removeSlur, slurAt, cloneGraces,
    scoreEndTick, staffMeasures, playbackEvents, outOfRange, countOutOfRange, normalizeScore, decompose, ensureMeasures,
    DYNAMICS, ARTICULATIONS, ORNAMENTS, JUMPS, TICK_LISTS, SPAN_LISTS, markOf, setMark, staffLists, playOrder, performance, tempoState,
  };
})();
