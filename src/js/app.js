// Partoch editor — interface, saisie souris/clavier, fichiers, lecture
(function () {
  const P = window.P;
  const M = P.model;
  const R = P.render;
  const api = window.api || null; // fourni par preload (Electron)
  P.applyIcons(); // icônes des barres d'outils (js/icons.js)

  const $ = (sel) => document.querySelector(sel);
  const scoreEl = $('#score');
  const overlay = $('#overlay');
  const wrap = $('#scoreWrap');
  const scroller = $('#scroller');
  const SVGNS = 'http://www.w3.org/2000/svg';

  const S = {
    score: null, filePath: null, dirty: false,
    mode: 'select', dur: 'q', dots: 0, restMode: false, pendingAcc: null,
    voice: 1, tuplet: false, graceMode: false, chordMode: false,
    textTool: false, selText: null, // notes textuelles : outil actif, texte sélectionné
    sel: null, // {s, t, pi, rest?, len?}
    range: null, // {s0, s1, a, b}
    cursor: { s: 0, t: 0 },
    zoom: 1, layout: null,
    undo: [], redo: [], clip: null,
    muted: new Set(), metronome: false, countIn: false, loop: false, speed: 1,
    playFrom: 0, hover: null, drag: null, lastDn: null,
  };
  window.PartochState = S; // pratique pour le débogage
  window.PartochDebug = {}; // fonctions internes exposées pour les tests

  // ------------------------------------------------------------------ utilitaires
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms || 2200);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function curLen() { return M.durTicks(S.dur, S.dots); }
  function curHint() { return { dur: S.dur, dots: S.dots }; }
  function frNum(x) { return (Math.round(x * 100) / 100).toString().replace('.', ','); }

  function snapshot() { return JSON.stringify(S.score); }
  function change(fn, opts) {
    const before = snapshot();
    const res = fn();
    if (res === false) return false;
    if (snapshot() === before) { renderAll(); return false; }
    S.undo.push(before);
    if (S.undo.length > 300) S.undo.shift();
    S.redo = [];
    setDirty(true);
    if (!opts || !opts.noRender) renderAll();
    return true;
  }
  function undo() {
    if (!S.undo.length) return toast('Rien à annuler');
    S.redo.push(snapshot());
    S.score = JSON.parse(S.undo.pop());
    validateSel(); setDirty(true); renderAll();
  }
  function redo() {
    if (!S.redo.length) return toast('Rien à rétablir');
    S.undo.push(snapshot());
    S.score = JSON.parse(S.redo.pop());
    validateSel(); setDirty(true); renderAll();
  }
  function validateSel() {
    const n = S.score.staves.length;
    if (S.sel && (S.sel.s >= n || (!S.sel.rest && !M.noteAt(S.score, S.sel.s, S.sel.t)))) S.sel = null;
    if (S.range && S.range.s1 >= n) S.range = null;
    if (S.cursor.s >= n) S.cursor = { s: 0, t: 0 };
  }

  function setDirty(d) {
    S.dirty = d;
    updateTitle();
    if (api) api.setDirty(d);
    if (d) scheduleAutosave();
  }
  function updateTitle() {
    const name = S.filePath ? S.filePath.split(/[\\/]/).pop() : (S.score.title || 'Sans titre');
    document.title = (S.dirty ? '• ' : '') + name + ' — Partoch editor';
  }
  let autosaveTimer = null;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try { localStorage.setItem('partoch-autosave', JSON.stringify({ score: S.score, filePath: S.filePath, dirty: S.dirty })); } catch (e) { /* plein */ }
    }, 800);
  }

  // ------------------------------------------------------------------ rendu
  function renderAll() {
    const t0 = performance.now();
    const tb = $('#titleBlock');
    tb.style.zoom = S.zoom;
    if (document.activeElement !== $('#title')) $('#title').textContent = S.score.title;
    if (document.activeElement !== $('#composer')) $('#composer').textContent = S.score.composer;
    try {
      S.layout = R.render(S.score, scoreEl, { selection: S.sel, selText: S.selText, zoom: S.zoom, pages: true, pageOffset: tb.getBoundingClientRect().height / S.zoom });
    } catch (e) {
      console.error(e);
      toast('Erreur d’affichage : ' + e.message, 5000);
    }
    const svg = scoreEl.querySelector('svg');
    if (svg) {
      overlay.setAttribute('viewBox', svg.getAttribute('viewBox'));
      overlay.setAttribute('width', svg.getAttribute('width'));
      overlay.setAttribute('height', svg.getAttribute('height'));
    }
    drawSheets();
    if (document.activeElement !== $('#tempo')) $('#tempo').value = S.score.tempo;
    drawOverlay();
    updateUI();
    updateStatus();
    renderAll.last = performance.now() - t0;
  }

  // feuilles A4 dessinées derrière la partition
  function drawSheets() {
    const paper = $('#paper');
    let box = $('#sheets');
    if (!box) { box = document.createElement('div'); box.id = 'sheets'; paper.prepend(box); }
    const L = S.layout;
    const pages = (L && L.pages) || [];
    paper.classList.toggle('paged', pages.length > 0);
    const z = S.zoom * ((L && L.unit) || 1), off = pages.length ? -pages[0].y0 : 0;
    let h = '';
    pages.forEach((pg, i) => {
      h += `<div class="sheet" style="top:${(pg.y0 + off) * z}px;height:${L.pageH * z}px">${pages.length > 1 ? `<span class="pnum" style="font-size:${12 * S.zoom}px;bottom:${28 * S.zoom}px">${i + 1}</span>` : ''}</div>`;
    });
    box.innerHTML = h;
  }

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function measureLayout(m) {
    for (const sys of S.layout.systems) for (const ML of sys.measures) if (ML.m === m) return { sys, ML };
    return null;
  }
  function xOfTick(tick, preferEnd) {
    const m = R.measureIndex(S.layout.tab, tick);
    if (preferEnd && S.layout.tab[m] && tick === S.layout.tab[m].start && m > 0) {
      const ml = measureLayout(m - 1);
      if (ml) return { x: ml.ML.x + ml.ML.w, sys: ml.sys };
    }
    const p = R.tickToPos(S.layout, tick);
    return p;
  }

  function drawOverlay() {
    overlay.innerHTML = '';
    if (!S.layout) return;
    // sélection de plage
    if (S.range) {
      const { s0, s1, a, b } = S.range;
      for (const sys of S.layout.systems) {
        const top = sys.staves[s0].lineY - 12, bot = sys.staves[s1].lineY + 52;
        for (const ML of sys.measures) {
          const ms = ML.start, me = ML.start + ML.len;
          if (me <= a || ms >= b) continue;
          const xa = a > ms ? xOfTick(a).x - 12 : ML.x + 1;
          const xb = b < me ? xOfTick(b).x - 12 : ML.x + ML.w - 1;
          svgEl('rect', { x: xa, y: top, width: Math.max(4, xb - xa), height: bot - top, fill: 'rgba(31,111,235,0.13)', stroke: 'rgba(31,111,235,0.6)', 'stroke-width': 1, rx: 3 }, overlay);
        }
      }
    }
    // curseur de saisie
    if (S.mode === 'input') {
      const p = xOfTick(S.cursor.t);
      if (p) {
        const st = p.sys.staves[S.cursor.s];
        if (st) svgEl('rect', { x: p.x - 12, y: st.lineY - 14, width: 24, height: 68, fill: 'rgba(31,111,235,0.10)', stroke: 'rgba(31,111,235,0.55)', 'stroke-dasharray': '3 2', rx: 4 }, overlay);
      }
      if (S.hover && S.hover.ghost) drawGhost(S.hover.ghost);
    }
    // curseur de lecture
    const g = svgEl('g', { id: 'playCursor' }, overlay);
    g.style.display = 'none';
    svgEl('rect', { x: 0, y: 0, width: 3, height: 10, fill: '#e8590c', rx: 1.5, opacity: 0.85 }, g);
  }

  function drawGhost(gh) {
    const col = gh.out ? '#d62828' : '#1f6feb';
    const g = svgEl('g', { opacity: 0.75 }, overlay);
    const y = gh.lineY + gh.pos * 5;
    // lignes supplémentaires
    for (let p = -2; p >= gh.pos; p -= 2) svgEl('line', { x1: gh.x - 11, x2: gh.x + 11, y1: gh.lineY + p * 5, y2: gh.lineY + p * 5, stroke: col, 'stroke-width': 1.4 }, g);
    for (let p = 10; p <= gh.pos; p += 2) svgEl('line', { x1: gh.x - 11, x2: gh.x + 11, y1: gh.lineY + p * 5, y2: gh.lineY + p * 5, stroke: col, 'stroke-width': 1.4 }, g);
    if (gh.rest) {
      svgEl('rect', { x: gh.x - 5, y: gh.lineY + 10, width: 10, height: 20, fill: col, rx: 2, opacity: 0.6 }, g);
    } else {
      svgEl('ellipse', { cx: gh.x, cy: y, rx: 6.6, ry: 4.6, fill: col, transform: `rotate(-20 ${gh.x} ${y})` }, g);
      const t = svgEl('text', { x: gh.x + 12, y: y - 8, 'font-size': 11, 'font-family': 'Segoe UI', fill: col, 'font-weight': 600 }, g);
      t.textContent = gh.label;
    }
  }

  // ------------------------------------------------------------------ test de position (souris)
  function toLayout(e) {
    const svg = scoreEl.querySelector('svg');
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * S.layout.width) / r.width, y: ((e.clientY - r.top) * S.layout.height) / r.height };
  }
  function hitTest(pt) {
    const L = S.layout;
    if (!L || !L.systems.length) return null;
    let sys = null, bd = Infinity;
    for (const s of L.systems) {
      const d = pt.y < s.top ? s.top - pt.y : pt.y > s.bottom ? pt.y - s.bottom : 0;
      if (d < bd) { bd = d; sys = s; }
    }
    if (bd > 60) return null;
    let staff = null; bd = Infinity;
    for (const st of sys.vstaves) {
      const d = Math.abs(pt.y - (st.lineY + 20));
      if (d < bd) { bd = d; staff = st; }
    }
    const pos = clamp(Math.round((pt.y - staff.lineY) / 5), -10, 18);
    let ML = sys.measures.find((m) => pt.x >= m.x && pt.x < m.x + m.w);
    if (!ML) ML = pt.x < sys.measures[0].x ? sys.measures[0] : sys.measures[sys.measures.length - 1];
    return { sys, staff, s: staff.s, pos, ML, x: pt.x, y: pt.y };
  }
  // Position rythmique visée en mode écriture
  // Durée réelle de la valeur choisie à cet endroit (dans un triolet : 2/3)
  function effLen(s, t) {
    const base = curLen();
    const sp = s != null && s >= 0 ? M.tupletAt(S.score, s, t) : null;
    if (sp) return Math.max(1, Math.min(Math.round((base * sp.den) / sp.num), sp.start + sp.len - t));
    if (S.tuplet && S.mode === 'input') return Math.round((base * 2) / 3);
    return base;
  }
  // voix visée par la saisie sur la portée ps (sans la créer)
  function inputLane(ps) { return M.laneFor(S.score, ps, S.voice, false); }
  function inputTarget(h) {
    const lane = inputLane(h.s);
    let evs = lane >= 0 ? h.ML.staffEvents[lane] : null;
    if (!evs || !evs.length) evs = [{ start: h.ML.start, len: h.ML.len, x: (h.ML.noteStartX + h.ML.noteEndX) / 2, rest: true, ev: { rest: true, full: true } }];
    let j = 0;
    for (let i = 1; i < evs.length; i++) if (h.x >= (evs[i - 1].x + evs[i].x) / 2) j = i;
    const ev = evs[j];
    const left = j === 0 ? h.ML.noteStartX - 6 : (evs[j - 1].x + ev.x) / 2;
    const right = j === evs.length - 1 ? h.ML.noteEndX : (ev.x + evs[j + 1].x) / 2;
    let t = ev.start, x = ev.x;
    const sp = lane >= 0 ? M.tupletAt(S.score, lane, ev.start) : null;
    // en mode triolet, le triolet commence sur une position de la valeur « normale »
    const L = sp ? effLen(lane, ev.start) : S.tuplet ? curLen() * 2 : curLen();
    if (ev.rest && L < ev.len) {
      const slots = Math.floor(ev.len / L);
      const f = clamp((h.x - left) / Math.max(1, right - left), 0, 0.999);
      const k = Math.min(slots - 1, Math.floor(f * slots));
      t = ev.start + k * L;
      x = left + ((k + 0.5) * (right - left)) / slots;
    }
    return { t, x };
  }
  function pitchFromPos(s, pos) {
    const st = S.score.staves[s];
    const dn = M.CLEF_TOP[st.clef] - pos;
    const p = M.pitchFromDn(dn, S.score.fifths);
    if (S.pendingAcc != null) p.alt = S.pendingAcc;
    return p;
  }
  function posOfPitch(s, p) { return M.CLEF_TOP[S.score.staves[s].clef] - M.dnOf(p); }

  // Événement (note ou silence) le plus proche d'un clic
  // (cherche dans toutes les voix de la portée ; renvoie aussi la voix trouvée dans .lane)
  function eventAt(h, tol) {
    let best = null, bd = Infinity;
    for (const lane of M.lanesOf(S.score, h.s)) {
      const evs = h.ML.staffEvents[lane] || [];
      for (const e of evs) {
        if (e.hidden) continue;
        let d = Math.abs(e.x - h.x);
        if (!e.rest) d += Math.min(...e.ev.pitches.map((p) => Math.abs(posOfPitch(lane, p) - h.pos))) * 1.5;
        else if (lane !== h.s) d += 6;
        if (d < bd) { bd = d; best = { ...e, lane }; }
      }
    }
    if (!best || bd > (tol || 14) + (best.rest ? 0 : 12)) return null;
    if (best.ev.full) return Math.abs(best.x - h.x) < 40 ? best : null;
    return best;
  }

  // ------------------------------------------------------------------ notes textuelles
  function textAt(pt) {
    const L = S.layout;
    if (!L || !L.texts) return null;
    for (let i = L.texts.length - 1; i >= 0; i--) {
      const b = L.texts[i];
      if (pt.x >= b.x - 4 && pt.x <= b.x + b.w + 4 && pt.y >= b.y - 4 && pt.y <= b.y + b.h + 4) return b;
    }
    return null;
  }
  function textObj(id) { return (S.score.texts || []).find((x) => x.id === id) || null; }
  function textCommand() {
    S.textTool = !S.textTool;
    if (S.textTool && S.mode === 'input') setMode('select');
    updateUI();
  }
  // ancrage : la note ou le silence le plus proche sur la portée visée (le texte suit la musique)
  function textAnchor(h, pt) {
    let t = h.ML.start, bd = Infinity;
    for (const lane of M.lanesOf(S.score, h.s)) {
      for (const e of h.ML.staffEvents[lane] || []) {
        if (e.hidden || e.ev.full) continue;
        const d = Math.abs(e.x - pt.x);
        if (d < bd) { bd = d; t = e.start; }
      }
    }
    const pos = R.tickToPos(S.layout, t);
    const ax = pos ? pos.x : h.ML.noteStartX;
    return { t, dx: Math.round(pt.x - ax), dy: Math.round(pt.y - h.staff.lineY + 5) };
  }
  function deleteText(id) {
    if (S.selText === id) S.selText = null;
    change(() => { S.score.texts = (S.score.texts || []).filter((x) => x.id !== id); });
  }
  // Zone de saisie posée sur la partition. tx : texte existant, ou nouveau (pas encore dans la partition)
  function editScoreText(tx, isNew, at) {
    const old = wrap.querySelector('textarea.textEdit');
    if (old) old.blur();
    const svg = scoreEl.querySelector('svg');
    if (!svg || !tx) return;
    const r = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const k = r.width / S.layout.width;
    const b = !isNew && S.layout.texts.find((x) => x.id === tx.id);
    if (!isNew && !b) return;
    const lx = b ? b.x : at.x, ly = b ? b.y : at.y - 14;
    const ta = document.createElement('textarea');
    ta.className = 'textEdit';
    ta.value = isNew ? '' : tx.text;
    ta.spellcheck = true;
    ta.style.left = (r.left - wr.left + (lx - 4) * k) + 'px';
    ta.style.top = (r.top - wr.top + (ly - 3) * k) + 'px';
    ta.style.fontSize = (15 * k) + 'px';
    ta.style.lineHeight = (18 * k) + 'px';
    const fit = () => {
      const lines = ta.value.split('\n');
      ta.rows = Math.max(1, lines.length);
      ta.style.width = Math.max(8, Math.max(...lines.map((l) => l.length)) + 3) + 'ch';
    };
    ta.addEventListener('input', fit);
    fit();
    const el = svg.querySelector(`[data-text-id="${tx.id}"]`);
    if (el) el.style.visibility = 'hidden';
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      ta.remove();
      const v = ta.value.replace(/\s+$/, '');
      if (!commit || (isNew && !v.trim())) { if (el) el.style.visibility = ''; return; }
      if (!v.trim()) return deleteText(tx.id);
      if (!isNew && v === tx.text) { if (el) el.style.visibility = ''; return; }
      S.selText = tx.id; S.sel = null; S.range = null;
      change(() => {
        if (isNew) { S.score.texts = S.score.texts || []; S.score.texts.push({ ...tx, text: v }); }
        else textObj(tx.id).text = v;
      });
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    ta.addEventListener('dblclick', (e) => e.stopPropagation());
    wrap.appendChild(ta);
    setTimeout(() => { ta.focus(); if (!isNew) ta.select(); }, 0);
  }
  // Clic : outil Texte actif → nouveau texte ; clic sur un texte → sélection et déplacement
  function textMouseDown(e, pt) {
    const b = textAt(pt);
    if (S.textTool) {
      S.textTool = false;
      updateUI();
      e.preventDefault();
      if (b) { editScoreText(textObj(b.id), false); return true; }
      const h = hitTest(pt);
      if (!h) return true;
      const a = textAnchor(h, pt);
      editScoreText({ id: M.uid(), sid: S.score.staves[h.s].id, t: a.t, dx: a.dx, dy: a.dy, text: '' }, true, pt);
      return true;
    }
    if (!b) {
      if (S.selText) { S.selText = null; renderAll(); }
      return false;
    }
    if (S.selText !== b.id || S.sel || S.range) { S.selText = b.id; S.sel = null; S.range = null; renderAll(); }
    S.textDrag = { id: b.id, x0: pt.x, y0: pt.y, dx: 0, dy: 0 };
    e.preventDefault();
    return true;
  }
  function textDragMove(pt) {
    const d = S.textDrag;
    d.dx = Math.round(pt.x - d.x0); d.dy = Math.round(pt.y - d.y0);
    const svg = scoreEl.querySelector('svg');
    const el = svg && svg.querySelector(`[data-text-id="${d.id}"]`);
    if (!el) return;
    const tr = `translate(${d.dx} ${d.dy})`;
    el.setAttribute('transform', tr);
    if (el.previousSibling && el.previousSibling.nodeName === 'rect') el.previousSibling.setAttribute('transform', tr);
  }
  function textDragEnd() {
    const d = S.textDrag;
    S.textDrag = null;
    if (!d || (Math.abs(d.dx) < 2 && Math.abs(d.dy) < 2)) return;
    change(() => { const tx = textObj(d.id); if (tx) { tx.dx += d.dx; tx.dy += d.dy; } });
  }

  // ------------------------------------------------------------------ souris
  wrap.addEventListener('mousemove', (e) => {
    if (!S.layout) return;
    const pt = toLayout(e);
    if (S.textDrag) return textDragMove(pt);
    if (S.drag) return dragMove(pt);
    if (S.mode !== 'input') return;
    const h = hitTest(pt);
    if (!h) { if (S.hover) { S.hover = null; drawOverlay(); } return; }
    const tg = inputTarget(h);
    if (!tg) return;
    const p = pitchFromPos(h.s, h.pos);
    S.hover = { h, tg, p, ghost: { x: tg.x, lineY: h.staff.lineY, pos: h.pos, rest: S.restMode, label: M.pitchName(p), out: M.outOfRange(S.score, h.s, p) } };
    drawOverlay();
  });
  wrap.addEventListener('mouseleave', () => { if (S.hover) { S.hover = null; drawOverlay(); } });

  wrap.addEventListener('mousedown', (e) => {
    if (!S.layout || e.button !== 0) return;
    const pt = toLayout(e);
    if (textMouseDown(e, pt)) return;
    const h = hitTest(pt);
    if (!h) { if (S.mode === 'select') { S.sel = null; S.range = null; renderAll(); } return; }
    const tabL = S.layout.tab;
    if (tabL && tabL[h.ML.m] && (tabL[h.ML.m].showSig || h.ML.m === 0) && h.x < h.ML.noteStartX - 2 && h.x > h.ML.noteStartX - 34) {
      // clic sur le chiffrage de mesure : menu des métriques
      S.sigClick = true;
      return openSigMenu(h.ML.m, { x: e.clientX - 20, y: e.clientY + 14 });
    }
    if (S.mode === 'input') return inputClick(h, e);
    selectClick(h, e);
  });
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!S.layout) return;
    const tb = textAt(toLayout(e));
    if (tb) return deleteText(tb.id);
    const h = hitTest(toLayout(e));
    if (!h) return;
    const ev = eventAt(h, 16);
    if (ev && !ev.rest) {
      const pi = nearestPitch(h, ev);
      change(() => M.deleteAt(S.score, ev.lane, ev.src, pi));
    }
  });
  window.addEventListener('mouseup', () => { if (S.textDrag) textDragEnd(); if (S.drag) dragEnd(); });
  wrap.addEventListener('dblclick', (e) => {
    if (!S.layout) return;
    const b = textAt(toLayout(e));
    if (b) editScoreText(textObj(b.id), false);
  });
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  function nearestPitch(h, ev) {
    if (ev.rest) return -1;
    let pi = 0, bd = Infinity;
    ev.ev.pitches.forEach((p, i) => { const d = Math.abs(posOfPitch(h.s, p) - h.pos); if (d < bd) { bd = d; pi = i; } });
    return pi;
  }

  // Place une note (ou un silence) en saisie, en créant la voix et le triolet si besoin
  function writeAt(ps, t, pitches) {
    let s = -1, L = 0, refused = false;
    change(() => {
      s = M.laneFor(S.score, ps, S.voice, true);
      if (S.tuplet && !M.tupletAt(S.score, s, t)) {
        const span = curLen() * 2;
        const ms = S.score.measures > 0 ? M.measureTable(S.score)[Math.min(M.measureAt(S.score, t), S.score.measures - 1)] : null;
        if (ms && t + span > ms.start + ms.len && t < ms.start + ms.len) { toast('Le triolet ne tient pas avant la barre de mesure'); refused = true; return false; }
        M.createTuplet(S.score, s, t, span, 3, 2);
      }
      L = effLen(s, t);
      if (pitches) M.placeNote(S.score, s, t, L, pitches, curHint());
      else M.placeRest(S.score, s, t, L);
      if (pitches) extendPendingSlur(s, t);
    }, { noRender: true });
    if (refused || s < 0) return null;
    return { s, L };
  }
  function inputClick(h, e) {
    const tg = inputTarget(h);
    if (!tg) return;
    if (S.graceMode) return addGraceAt(h, tg);
    if (S.restMode) {
      const r = writeAt(h.s, tg.t, null);
      if (!r) return;
      S.sel = null;
      S.cursor = { s: r.s, t: tg.t + r.L };
      return renderAll();
    }
    const lane0 = inputLane(h.s);
    const s = lane0 >= 0 ? lane0 : h.s;
    const p = pitchFromPos(s, h.pos);
    let pi = 0;
    const host = lane0 >= 0 && (e.shiftKey || S.chordMode) ? M.noteCovering(S.score, s, tg.t) : null;
    if (host) {
      // accord : ajoute la hauteur cliquée à la note existante (ou la retire si elle y est déjà)
      const t0 = host.start, m = M.midiOf(p);
      const j = host.pitches.findIndex((q) => M.midiOf(q) === m);
      if (j >= 0) {
        if (host.pitches.length < 2) { toast('Seule note de l’accord'); return; }
        change(() => { M.deleteAt(S.score, s, t0, j); });
        S.sel = { s, t: t0, pi: 0 };
        S.pendingAcc = null;
        return renderAll();
      }
      change(() => { M.addToChord(S.score, s, t0, p); });
      const n = M.noteAt(S.score, s, t0);
      pi = n.pitches.findIndex((q) => M.midiOf(q) === m);
      S.sel = { s, t: t0, pi };
    } else {
      const r = writeAt(h.s, tg.t, [p]);
      if (!r) return renderAll();
      S.sel = { s: r.s, t: tg.t, pi: 0 };
      S.cursor = { s: r.s, t: tg.t + r.L };
    }
    S.pendingAcc = null;
    S.lastDn = M.dnOf(p);
    previewPitch(s, p);
    renderAll();
  }

  function selectClick(h, e) {
    const ev = eventAt(h);
    if (ev) h = { ...h, s: ev.lane };
    if (!ev) {
      // clic dans le vide d'une mesure : sélection de la mesure
      const a = h.ML.start, b = h.ML.start + h.ML.len;
      if (e.shiftKey && (S.range || S.sel)) extendRange(h.s, a, b);
      else { S.range = { s0: h.s, s1: h.s, a, b }; S.sel = null; S.anchor = { s: h.s, a, b }; }
      return renderAll();
    }
    const t = ev.rest ? ev.start : ev.src;
    const len = ev.rest ? ev.len : M.noteAt(S.score, h.s, ev.src).len;
    if (e.shiftKey && (S.sel || S.range)) {
      extendRange(h.s, t, t + len);
      return renderAll();
    }
    const pi = nearestPitch(h, ev);
    S.sel = ev.rest ? { s: h.s, t, pi: -1, rest: true, len } : { s: h.s, t, pi };
    S.range = null;
    S.anchor = { s: h.s, a: t, b: t + len };
    S.playFrom = t;
    if (!ev.rest) {
      const n = M.noteAt(S.score, h.s, t);
      const p = n.pitches[pi];
      previewPitch(h.s, p);
      S.drag = { s: h.s, t, pi, startY: h.y, origDn: M.dnOf(p), origAlt: p.alt, before: snapshot(), moved: false };
    }
    renderAll();
  }
  function extendRange(s, a, b) {
    const an = S.anchor || (S.sel ? { s: S.sel.s, a: S.sel.t, b: S.sel.t + (S.sel.len || M.noteAt(S.score, S.sel.s, S.sel.t)?.len || curLen()) } : { s, a, b });
    const ps = M.parentIndex(S.score, s), pa = M.parentIndex(S.score, an.s);
    S.range = { s0: Math.min(pa, ps), s1: Math.max(pa, ps), a: Math.min(an.a, a), b: Math.max(an.b, b) };
    S.sel = null;
  }

  function dragMove(pt) {
    const d = S.drag;
    const delta = Math.round((pt.y - d.startY) / 5);
    const n = M.noteAt(S.score, d.s, d.t);
    if (!n) return;
    const dn = d.origDn - delta;
    const p = n.pitches[d.pi];
    if (M.dnOf(p) === dn && d.moved) return;
    if (!d.moved && delta === 0) return;
    d.moved = true;
    const np = delta === 0 ? { step: p.step, oct: p.oct, alt: d.origAlt } : M.pitchFromDn(dn, S.score.fifths);
    if (M.dnOf(p) === M.dnOf(np) && p.alt === np.alt) return;
    n.pitches[d.pi] = np;
    n.pitches.sort((a, b) => M.midiOf(a) - M.midiOf(b));
    d.pi = n.pitches.indexOf(np);
    S.sel = { s: d.s, t: d.t, pi: d.pi };
    previewPitch(d.s, np, 0.25);
    renderAll();
  }
  function dragEnd() {
    const d = S.drag;
    S.drag = null;
    if (d.moved && snapshot() !== d.before) {
      S.undo.push(d.before); S.redo = []; setDirty(true);
    }
  }

  function previewPitch(s, p, dur) {
    if (!P.audio.ready) return;
    const def = M.INSTRUMENTS[S.score.staves[s].inst];
    P.audio.preview(M.midiOf(p) + (def.soundShift || 0), dur);
  }

  // ------------------------------------------------------------------ commandes d'édition
  function selNote() { return S.sel && !S.sel.rest ? M.noteAt(S.score, S.sel.s, S.sel.t) : null; }

  function setMode(mode) {
    S.mode = mode;
    S.hover = null;
    if (mode === 'input') {
      if (S.sel) S.cursor = { s: S.sel.s, t: S.sel.t };
      else if (S.range) S.cursor = { s: S.range.s0, t: S.range.a };
      S.range = null;
    } else {
      S.restMode = false; S.pendingAcc = null; S.pendingSlur = null; S.tuplet = false; S.graceMode = false; S.chordMode = false;
    }
    renderAll();
  }

  function setDuration(dur) {
    S.dur = dur;
    const n = selNote();
    if (n && S.mode === 'select') {
      change(() => M.changeDuration(S.score, S.sel.s, S.sel.t, effLen(S.sel.s, S.sel.t), curHint()));
    } else if (S.mode === 'select' && !S.sel && !S.range) {
      setMode('input');
      return;
    }
    updateUI();
  }
  function toggleDot() {
    S.dots = S.dots ? 0 : 1;
    const n = selNote();
    if (n && S.mode === 'select') {
      const base = n.dur || S.dur;
      const dots = n.dots ? 0 : 1;
      S.dots = dots;
      const sp = M.tupletAt(S.score, S.sel.s, S.sel.t);
      let len = M.durTicks(base, dots);
      if (sp) len = Math.min(Math.round((len * sp.den) / sp.num), sp.start + sp.len - S.sel.t);
      change(() => M.changeDuration(S.score, S.sel.s, S.sel.t, len, { dur: base, dots }));
    }
    updateUI();
  }
  function restCommand() {
    if (S.mode === 'input') { S.restMode = !S.restMode; drawOverlay(); updateUI(); return; }
    if (S.range) return deleteSelection();
    const n = selNote();
    if (n) { const t = S.sel.t; change(() => M.placeRest(S.score, S.sel.s, t, n.len)); S.sel = null; renderAll(); }
  }
  function placeRestAtCursor() {
    const r = writeAt(S.cursor.s, S.cursor.t, null);
    if (!r) return;
    S.cursor = { s: r.s, t: S.cursor.t + r.L };
    S.sel = null;
    renderAll();
  }
  function applyAccidental(alt) {
    const n = selNote();
    if (n) {
      change(() => {
        const idxs = S.sel.pi >= 0 && n.pitches.length > 1 ? [S.sel.pi] : n.pitches.map((_, i) => i);
        for (const i of idxs) {
          const p = n.pitches[i];
          p.alt = p.alt === alt && alt !== 0 ? M.keyAlter(p.step, S.score.fifths) : alt;
        }
      });
      const p = n.pitches[Math.max(0, S.sel.pi)];
      if (p) previewPitch(S.sel.s, p);
      return;
    }
    if (S.range) {
      change(() => forRangeNotes((n2) => n2.pitches.forEach((p) => (p.alt = alt))));
      return;
    }
    if (S.mode === 'input') {
      S.pendingAcc = S.pendingAcc === alt ? null : alt;
      updateUI();
      if (S.hover) { S.hover.p = pitchFromPos(S.hover.h.s, S.hover.h.pos); S.hover.ghost.label = M.pitchName(S.hover.p); drawOverlay(); }
    }
  }
  // toutes les portées et voix d'une plage
  function rangeStaves(r) { const out = []; S.score.staves.forEach((_, s) => { if (M.staffInRange(S.score, s, r)) out.push(s); }); return out; }
  function forRangeNotes(fn) {
    const r = S.range;
    for (const s of rangeStaves(r)) for (const n of S.score.staves[s].notes) if (n.start >= r.a && n.start < r.b) fn(n, s);
  }
  function shiftPitch(kind, dir) {
    const fifths = S.score.fifths;
    const move = (p) => {
      if (kind === 'oct') return { ...p, oct: p.oct + dir };
      if (kind === 'step') return M.pitchFromDn(M.dnOf(p) + dir, fifths);
      return M.spell(M.midiOf(p) + dir, fifths);
    };
    const n = selNote();
    if (n) {
      change(() => {
        const idxs = S.sel.pi >= 0 && n.pitches.length > 1 ? [S.sel.pi] : n.pitches.map((_, i) => i);
        const target = n.pitches[idxs[0]];
        for (const i of idxs) n.pitches[i] = move(n.pitches[i]);
        const moved = n.pitches[idxs[0]];
        n.pitches.sort((a, b) => M.midiOf(a) - M.midiOf(b));
        if (S.sel.pi >= 0) S.sel.pi = n.pitches.indexOf(moved);
        void target;
      });
      const p = n.pitches[Math.max(0, S.sel.pi)];
      previewPitch(S.sel.s, p, 0.3);
      S.lastDn = M.dnOf(p);
      return;
    }
    if (S.range) change(() => forRangeNotes((n2) => { n2.pitches = n2.pitches.map(move); }));
  }
  // ---- liaisons d'expression / de phrasé ----
  function extendPendingSlur(s, t) {
    const ps = S.pendingSlur;
    if (ps && ps.s === s && t > ps.start) M.addSlur(S.score, s, ps.start, t, ps.kind);
  }
  function slurCommand(kind) {
    const label = kind === 'phrase' ? 'Liaison de phrasé' : 'Liaison d’expression';
    if (S.pendingSlur && S.pendingSlur.kind === kind) {
      S.pendingSlur = null; updateUI();
      return updateUI();
    }
    if (S.range) {
      const r = S.range;
      let added = 0, removed = 0;
      change(() => {
        for (const s of rangeStaves(r)) {
          const ns = S.score.staves[s].notes.filter((n) => n.start >= r.a && n.start < r.b);
          if (ns.length < 2) continue;
          const a = ns[0].start, b = ns[ns.length - 1].start;
          const ex = M.slursOf(S.score, s).find((sl) => sl.kind === kind && sl.start === a && sl.end === b);
          if (ex) { M.removeSlur(S.score, s, ex); removed++; } else { M.addSlur(S.score, s, a, b, kind); added++; }
        }
      });
      if (!added && !removed) return toast('Sélectionnez au moins deux notes');
      return;
    }
    const n = selNote();
    if (!n) return toast('Aucune note sélectionnée');
    const s = S.sel.s, t = S.sel.t;
    if (M.slurAt(S.score, s, t, kind)) {
      change(() => M.removeSlur(S.score, s, M.slurAt(S.score, s, t, kind)));
      return;
    }
    if (S.mode === 'input') {
      S.pendingSlur = { s, start: t, kind };
      updateUI();
      return;
    }
    const nx = M.nextNote(S.score, s, t);
    if (!nx) return toast('Aucune note suivante');
    change(() => M.addSlur(S.score, s, t, nx.start, kind));
  }
  function breathCommand() {
    let s, t;
    const n = selNote();
    if (n) { s = S.sel.s; t = S.sel.t; }
    else if (S.range) {
      const ns = S.score.staves[S.range.s0].notes.filter((x) => x.start >= S.range.a && x.start < S.range.b);
      if (ns.length) { s = S.range.s0; t = ns[ns.length - 1].start; }
    }
    if (s == null) return toast('Aucune note sélectionnée');
    change(() => { const x = M.noteAt(S.score, s, t); x.breath = !x.breath; });
  }

  // ---- signes : nuances, articulations, ornements, reprises, tempo ----
  function targetNotes() {
    if (S.range) { const out = []; forRangeNotes((n, s) => out.push({ s, n })); return out; }
    const n = selNote();
    return n ? [{ s: S.sel.s, n }] : [];
  }
  // notes d'une portée et de ses voix, dans [a, b)
  function notesOfPart(ps, a, b) {
    const out = [];
    for (const l of M.lanesOf(S.score, ps)) for (const n of S.score.staves[l].notes) if (n.start >= a && n.start < b) out.push(n);
    return out.sort((x, y) => x.start - y.start);
  }
  // ancrages sur les portées principales : début (et dernière note) de la sélection, ou curseur d'écriture
  function anchorPoints() {
    if (S.range) {
      const out = [];
      for (const s of rangeStaves(S.range)) {
        const ps = M.parentIndex(S.score, s);
        if (out.some((o) => o.s === ps)) continue;
        const ts = notesOfPart(ps, S.range.a, S.range.b).map((n) => n.start);
        out.push({ s: ps, t: ts.length ? ts[0] : S.range.a, last: ts.length > 1 ? ts[ts.length - 1] : null });
      }
      return out;
    }
    if (S.sel) return [{ s: M.parentIndex(S.score, S.sel.s), t: S.sel.t }];
    if (S.mode === 'input') return [{ s: M.parentIndex(S.score, S.cursor.s), t: S.cursor.t }];
    return [];
  }
  function dynCommand(v) {
    const pts = anchorPoints();
    if (!pts.length) return toast('Aucune note sélectionnée');
    const on = !pts.every(({ s, t }) => (S.score.staves[s].dyns || []).some((d) => d.t === t && d.v === v));
    change(() => pts.forEach(({ s, t }) => {
      const st = M.staffLists(S.score.staves[s]);
      st.dyns = st.dyns.filter((d) => d.t !== t);
      if (on) st.dyns.push({ t, v });
      st.dyns.sort((a, b) => a.t - b.t);
    }));
  }
  function hairpinCommand(kind) {
    let spans = [];
    if (S.range) spans = anchorPoints().filter((p) => p.last != null).map((p) => ({ s: p.s, start: p.t, end: p.last }));
    else if (selNote()) {
      const ps = M.parentIndex(S.score, S.sel.s);
      const nx = notesOfPart(ps, S.sel.t + 1, Infinity)[0];
      if (nx) spans = [{ s: ps, start: S.sel.t, end: nx.start }];
    }
    if (!spans.length) return toast('Sélectionnez au moins deux notes');
    const on = !spans.every((sp) => (S.score.staves[sp.s].hairpins || []).some((h) => h.start === sp.start && h.end === sp.end && h.kind === kind));
    change(() => spans.forEach((sp) => {
      const st = M.staffLists(S.score.staves[sp.s]);
      st.hairpins = st.hairpins.filter((h) => h.end < sp.start || h.start > sp.end);
      if (on) st.hairpins.push({ start: sp.start, end: sp.end, kind });
      st.hairpins.sort((a, b) => a.start - b.start);
    }));
  }
  const ART_EXCL = { stacc: 'staccmo', staccmo: 'stacc', acc: 'marc', marc: 'acc' };
  function artCommand(a) {
    const tn = targetNotes();
    if (!tn.length) return toast('Aucune note sélectionnée');
    const has = (n) => (a === 'fermata' ? !!n.fermata : (n.arts || []).includes(a));
    const on = !tn.every(({ n }) => has(n));
    change(() => tn.forEach(({ n }) => {
      if (a === 'fermata') { if (on) n.fermata = true; else delete n.fermata; return; }
      let arts = (n.arts || []).filter((x) => x !== a && !(on && x === ART_EXCL[a]));
      if (on) arts.push(a);
      if (arts.length) n.arts = arts; else delete n.arts;
    }));
  }
  function ornCommand(o) {
    const tn = targetNotes();
    if (!tn.length) return toast('Aucune note sélectionnée');
    const on = !tn.every(({ n }) => n.orn === o);
    change(() => tn.forEach(({ n }) => { if (on) n.orn = o; else delete n.orn; }));
  }
  // marques de mesure : début de reprise, segno, coda sur la 1re mesure sélectionnée ; le reste sur la dernière
  function markMeasures() {
    const sm = selMeasures();
    if (sm) return sm;
    if (S.mode === 'input') { const m = measOf(S.cursor.t); return [m, m]; }
    return null;
  }
  function markCommand(key, val) {
    const sm = markMeasures();
    if (!sm) return toast('Aucune mesure sélectionnée');
    const [m0, m1] = sm;
    const mk = (m) => M.markOf(S.score, m) || {};
    change(() => {
      if (key === 'volta') {
        const v = +val, ms = [];
        for (let m = m0; m <= m1; m++) ms.push(m);
        const on = !ms.every((m) => (mk(m).volta || []).join() === String(v));
        ms.forEach((m) => M.setMark(S.score, m, 'volta', on ? [v] : null));
        return;
      }
      const m = key === 'rs' || key === 'segno' || key === 'coda' ? m0 : m1;
      const cur = mk(m)[key];
      let nv;
      if (key === 'jump' || key === 'brk') nv = cur === val ? null : val;
      else if (key === 're') nv = cur ? null : 2;
      else nv = !cur;
      M.setMark(S.score, m, key, nv);
      if (key === 'jump' && nv) { M.setMark(S.score, m, 'fine', null); M.setMark(S.score, m, 'toCoda', null); }
    });
  }
  function tempoCommand(kind) {
    const pts = anchorPoints();
    if (!pts.length) return toast('Aucune note sélectionnée');
    const t = Math.min(...pts.map((p) => p.t));
    const list = S.score.tempos || [];
    const ex = list.find((x) => x.t === t && x.kind === kind);
    const sortT = () => S.score.tempos.sort((a, b) => a.t - b.t);
    if (kind !== 'tempo') {
      change(() => { S.score.tempos = list.filter((x) => x.t !== t || x.kind === 'tempo'); if (!ex) S.score.tempos.push({ t, kind }); sortT(); });
      return;
    }
    const cur = ex ? ex.bpm : Math.round(M.tempoState(S.score, t).bpm);
    let del = false;
    const md = openModal(`<h2>Tempo</h2><div class="body">
      <div class="row"><label>♩ =</label><input type="number" id="tmBpm" min="20" max="400" value="${cur}" style="width:80px"></div>
      </div><div class="foot">${ex ? '<button id="tmDel">Supprimer</button><span style="flex:1"></span>' : ''}<button data-cancel>Annuler</button><button class="primary" data-ok>OK</button></div>`, (m) => {
      const v = clamp(Math.round(+m.querySelector('#tmBpm').value || cur), 20, 400);
      change(() => {
        S.score.tempos = (S.score.tempos || []).filter((x) => !(x.t === t && x.kind === 'tempo'));
        if (!del) S.score.tempos.push({ t, kind: 'tempo', bpm: v });
        sortT();
      });
    });
    const d = md.querySelector('#tmDel');
    if (d) d.onclick = () => { del = true; md.querySelector('[data-ok]').click(); };
  }

  // La note suivante (collée) partage-t-elle au moins une hauteur ?
  function tieTarget(s, n) {
    const nx = M.nextNote(S.score, s, n.start);
    if (!nx || nx.start !== M.noteEnd(n)) return null;
    return nx.pitches.some((q) => n.pitches.some((p) => M.midiOf(p) === M.midiOf(q))) ? nx : null;
  }
  function toggleTie() {
    if (S.range) return tieRange();
    const n = selNote();
    if (!n) return toast('Aucune note sélectionnée');
    const s = S.sel.s, t = S.sel.t;
    if (n.tie && tieTarget(s, n)) {
      change(() => { M.noteAt(S.score, s, t).tie = false; });
      return;
    }
    if (tieTarget(s, n)) {
      change(() => { M.noteAt(S.score, s, t).tie = true; });
      return;
    }
    const end = M.noteEnd(n);
    const nx = M.nextNote(S.score, s, t);
    // Note différente collée juste après : c'est une liaison d'expression, on ne touche à aucune note
    if (nx && nx.start === end) {
      const ex = M.slursOf(S.score, s).find((sl) => sl.kind === 'slur' && sl.start === t && sl.end === nx.start);
      if (ex) { change(() => M.removeSlur(S.score, s, M.slursOf(S.score, s).find((sl) => sl.kind === 'slur' && sl.start === t && sl.end === nx.start))); return; }
      change(() => M.addSlur(S.score, s, t, nx.start, 'slur'));
      return;
    }
    // Place libre après la note : on y crée la même note, liée (sans jamais écraser la suite)
    let L = S.mode === 'input' ? curLen() : n.len;
    let hint = S.mode === 'input' ? curHint() : n.dur ? { dur: n.dur, dots: n.dots || 0 } : null;
    if (nx && nx.start - end < L) { L = nx.start - end; hint = null; }
    change(() => {
      const nn = M.noteAt(S.score, s, t);
      nn.tie = true;
      M.placeNote(S.score, s, end, L, nn.pitches, hint);
      if (S.mode === 'input') extendPendingSlur(s, end);
    }, { noRender: true });
    S.sel = { s, t: end, pi: 0 };
    if (S.mode === 'input') S.cursor = { s, t: end + L };
    renderAll();
    scrollToTick(end);
  }
  // Plage : lie chaque note à la suivante de même hauteur (ou retire si tout est déjà lié).
  // Sans aucune paire de même hauteur, on pose une liaison d'expression sur la plage.
  function tieRange() {
    const r = S.range;
    const pairs = [];
    for (const s of rangeStaves(r)) {
      for (const n of S.score.staves[s].notes) {
        if (n.start < r.a || n.start >= r.b) continue;
        const nx = tieTarget(s, n);
        if (nx && nx.start < r.b) pairs.push(n);
      }
    }
    if (!pairs.length) return slurCommand('slur');
    const allTied = pairs.every((n) => n.tie);
    change(() => {
      // les objets de « pairs » viennent de S.score : on les retrouve après l'instantané
      for (const s of rangeStaves(r)) for (const n of S.score.staves[s].notes) {
        if (n.start < r.a || n.start >= r.b) continue;
        const nx = tieTarget(s, n);
        if (nx && nx.start < r.b) n.tie = !allTied;
      }
    });
  }
  function deleteSelection() {
    if (S.range) {
      const r = S.range;
      change(() => M.deleteRange(S.score, r.s0, r.s1, r.a, r.b));
      return;
    }
    const n = selNote();
    if (n) {
      const { s, t, pi } = S.sel;
      change(() => M.deleteAt(S.score, s, t, pi));
      if (!M.noteAt(S.score, s, t)) S.sel = { s, t, pi: -1, rest: true, len: n.len };
      renderAll();
    }
  }
  function copySel(cut) {
    let r = S.range;
    const n = selNote();
    if (!r && n) { const ps = M.parentIndex(S.score, S.sel.s); r = { s0: ps, s1: ps, a: S.sel.t, b: S.sel.t + n.len }; }
    if (!r) return toast('Rien à copier');
    S.clip = M.copyRange(S.score, r.s0, r.s1, r.a, r.b);
    toast(cut ? 'Coupé' : 'Copié');
    if (cut) change(() => M.deleteRange(S.score, r.s0, r.s1, r.a, r.b));
  }
  function pasteClip() {
    if (!S.clip) return toast('Le presse-papiers est vide');
    let s, t;
    if (S.range) { s = S.range.s0; t = S.range.a; }
    else if (S.sel) { s = S.sel.s; t = S.sel.t; }
    else if (S.mode === 'input') { s = S.cursor.s; t = S.cursor.t; }
    else return toast('Aucune destination sélectionnée');
    s = M.parentIndex(S.score, s);
    change(() => M.paste(S.score, s, t, S.clip));
    const vis = M.visualStaves(S.score);
    S.range = { s0: s, s1: vis[Math.min(vis.length - 1, vis.indexOf(s) + S.clip.nStaves - 1)], a: t, b: t + S.clip.len };
    S.sel = null;
    renderAll();
  }
  // événements dessinés d'une portée, dans l'ordre (pour ← →)
  function staffEventList(s) {
    const out = [];
    for (const sys of S.layout.systems) for (const ML of sys.measures) for (const e of ML.staffEvents[s]) {
      if (!e.rest && out.length && !out[out.length - 1].rest && out[out.length - 1].src === e.src) continue; // morceaux d'une même note
      out.push(e);
    }
    return out;
  }
  function moveSel(dir) {
    if (S.mode === 'input') {
      const list = staffEventList(S.cursor.s);
      let i = list.findIndex((e) => (e.rest ? e.start : e.src) >= S.cursor.t);
      if (i < 0) i = list.length;
      i = clamp(i + dir, 0, list.length - 1);
      const e = list[i];
      if (e) S.cursor = { s: S.cursor.s, t: e.rest ? e.start : e.src };
      return renderAll();
    }
    if (!S.sel) return;
    const list = staffEventList(S.sel.s);
    const i = list.findIndex((e) => (e.rest ? e.start : e.src) === S.sel.t);
    const e = list[clamp(i + dir, 0, list.length - 1)];
    if (!e) return;
    const t = e.rest ? e.start : e.src;
    S.sel = e.rest ? { s: S.sel.s, t, pi: -1, rest: true, len: e.len } : { s: S.sel.s, t, pi: 0 };
    S.playFrom = t;
    if (!e.rest) previewPitch(S.sel.s, M.noteAt(S.score, S.sel.s, t).pitches[0], 0.3);
    renderAll();
  }
  function moveStaff(dir) {
    if (S.mode !== 'input') return;
    const vis = M.visualStaves(S.score);
    const i = clamp(vis.indexOf(M.parentIndex(S.score, S.cursor.s)) + dir, 0, vis.length - 1);
    S.cursor.s = M.laneFor(S.score, vis[i], S.voice, true);
    renderAll();
  }
  // saisie au clavier : lettre A–G
  function letterInput(letter) {
    const step = M.STEP_EN.indexOf(letter);
    if (step < 0) return;
    const s = S.cursor.s, st = S.score.staves[s];
    const ref = S.lastDn != null ? S.lastDn : M.CLEF_TOP[st.clef] - 4;
    let best = null, bd = Infinity;
    for (let oct = 1; oct <= 7; oct++) { const dn = oct * 7 + step; const d = Math.abs(dn - ref); if (d < bd) { bd = d; best = dn; } }
    const p = M.pitchFromDn(best, S.score.fifths);
    if (S.pendingAcc != null) p.alt = S.pendingAcc;
    const t = S.cursor.t;
    const r = writeAt(s, t, [p]);
    if (!r) return renderAll();
    S.sel = { s: r.s, t, pi: 0 };
    S.cursor = { s: r.s, t: t + r.L };
    S.lastDn = best; S.pendingAcc = null;
    previewPitch(s, p);
    renderAll();
    scrollToTick(S.cursor.t);
  }
  function measOf(t) { return Math.min(M.measureAt(S.score, t), S.score.measures - 1); }
  function selMeasures() {
    if (S.range) return [measOf(S.range.a), measOf(S.range.b - 1)];
    if (S.sel) return [measOf(S.sel.t), measOf(S.sel.t)];
    return null;
  }
  function addMeasure() {
    const sm = selMeasures();
    const at = sm ? sm[1] + 1 : S.score.measures;
    change(() => M.insertMeasures(S.score, at, 1));
  }
  function delMeasure() {
    const sm = selMeasures() || [S.score.measures - 1, S.score.measures - 1];
    const [m0, m1] = sm;
    if (S.score.measures - (m1 - m0 + 1) < 1) return toast('Il faut garder au moins une mesure');
    const n0 = M.measureNumber(S.score, m0), n1 = M.measureNumber(S.score, m1);
    change(() => M.deleteMeasures(S.score, m0, m1));
    S.sel = null; S.range = null;
    renderAll();
  }
  function selectAll() {
    const vis = M.visualStaves(S.score);
    S.range = { s0: vis[0], s1: vis[vis.length - 1], a: 0, b: M.totalTicks(S.score) };
    S.sel = null;
    renderAll();
  }
  function setZoom(z) {
    S.zoom = clamp(Math.round(z * 100) / 100, 0.5, 2.5);
    S.autoZoom = false;
    try { localStorage.setItem('partoch-zoom', S.zoom); } catch (e) { /* */ }
    renderAll();
  }
  function scrollToTick(tick) {
    const p = S.layout && xOfTick(tick);
    if (!p) return;
    const svg = scoreEl.querySelector('svg');
    const r = svg.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    const k = r.height / S.layout.height;
    const yTop = r.top + p.sys.top * k, yBot = r.top + p.sys.bottom * k;
    if (yTop < sr.top + 10 || yBot > sr.bottom - 10) scroller.scrollTop += yTop - sr.top - 60;
  }

  // ------------------------------------------------------------------ lecture
  let rafId = null, litEls = [];
  function togglePlay() {
    if (P.player.playing) {
      const ct = P.player.currentTick();
      P.player.stop();
      if (ct && !ct.countIn) S.playFrom = M.beatFloor(S.score, ct.tick);
      stopAnim();
      return;
    }
    if (!P.audio.ready) { toast('Chargement des sons…'); return; }
    let from = S.playFrom || 0;
    if (S.sel) from = S.sel.t;
    else if (S.range) from = S.range.a;
    let loopRange = null;
    if (S.loop && S.range) loopRange = { a: S.range.a, b: S.range.b }; // sinon : tout le morceau, reprises comprises
    P.player.onEnd = () => { stopAnim(); S.playFrom = 0; };
    P.player.start(S.score, { fromTick: from, speed: S.speed, metronome: S.metronome, countIn: S.countIn, muted: mutedStaves(), loop: S.loop, loopRange });
    startAnim();
  }
  function restartIfPlaying() {
    if (!P.player.playing) return;
    const ct = P.player.currentTick();
    P.player.stop();
    S.playFrom = ct ? M.beatFloor(S.score, ct.tick) : S.playFrom;
    const sel = S.sel; S.sel = null;
    togglePlay();
    S.sel = sel;
  }
  // portées coupées (une portée coupée coupe aussi ses voix)
  function mutedStaves() {
    const set = new Set();
    S.score.staves.forEach((_, s) => { if (S.muted.has(M.parentIndex(S.score, s))) set.add(s); });
    return set;
  }
  function startAnim() {
    $('#btnPlay').innerHTML = P.icon('pause');
    $('#btnPlay').classList.add('playing');
    const events = M.playbackEvents(S.score);
    const muted = mutedStaves();
    const frame = () => {
      rafId = requestAnimationFrame(frame);
      const ct = P.player.currentTick();
      if (!ct) return;
      const cur = document.getElementById('playCursor');
      const p = xOfTick(ct.tick);
      if (cur && p) {
        cur.style.display = '';
        const r = cur.firstChild;
        r.setAttribute('x', p.x - 1.5);
        const vs = p.sys.vstaves;
        r.setAttribute('y', vs[0].lineY - 18);
        r.setAttribute('height', vs[vs.length - 1].lineY + 58 - (vs[0].lineY - 18));
        followCursor(p.sys);
      }
      // surbrillance des notes jouées
      litEls.forEach((el) => el.classList.remove('playing'));
      litEls = [];
      if (ct.countIn) return;
      for (const e of events) {
        if (e.tick > ct.tick) break;
        if (ct.tick < e.tick + e.len && !muted.has(e.staff)) {
          const ns = S.layout.noteEls.get(e.staff + ':' + e.src);
          if (ns) for (const n of ns) { const el = n.getSVGElement && n.getSVGElement(); if (el) { el.classList.add('playing'); litEls.push(el); } }
        }
      }
    };
    rafId = requestAnimationFrame(frame);
  }
  let lastFollowSys = null;
  function followCursor(sys) {
    if (sys === lastFollowSys) return;
    lastFollowSys = sys;
    const svg = scoreEl.querySelector('svg');
    const r = svg.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    const k = r.height / S.layout.height;
    const yTop = r.top + sys.top * k, yBot = r.top + sys.bottom * k;
    if (yTop < sr.top || yBot > sr.bottom - 20) scroller.scrollTo({ top: scroller.scrollTop + yTop - sr.top - 40, behavior: 'smooth' });
  }
  function stopAnim() {
    cancelAnimationFrame(rafId);
    litEls.forEach((el) => el.classList.remove('playing'));
    litEls = []; lastFollowSys = null;
    const cur = document.getElementById('playCursor');
    if (cur) cur.style.display = 'none';
    $('#btnPlay').innerHTML = P.icon('play');
    $('#btnPlay').classList.remove('playing');
  }

  // ------------------------------------------------------------------ interface
  function updateUI() {
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    const n = S.mode === 'select' ? selNote() : null;
    const showDur = n ? n.dur || null : S.dur;
    const showDots = n ? n.dots || 0 : S.dots;
    document.querySelectorAll('[data-dur]').forEach((b) => b.classList.toggle('on', b.dataset.dur === showDur));
    $('#btnDot').classList.toggle('on', !!showDots);
    $('#btnRest').classList.toggle('on', S.mode === 'input' && S.restMode);
    document.querySelectorAll('[data-acc]').forEach((b) => b.classList.toggle('on', S.pendingAcc != null && +b.dataset.acc === S.pendingAcc));
    document.querySelectorAll('[data-voice]').forEach((b) => b.classList.toggle('on', +b.dataset.voice === (n && S.mode !== 'input' ? M.voiceNum(S.score, S.sel.s) : S.voice)));
    const tsel = n ? M.tupletAt(S.score, S.sel.s, S.sel.t) : null;
    $('#btnTuplet').classList.toggle('on', S.mode === 'input' ? S.tuplet : !!tsel);
    $('#btnChord').classList.toggle('on', S.mode === 'input' && S.chordMode);
    $('#btnText').classList.toggle('on', S.textTool);
    wrap.classList.toggle('texttool', S.textTool);
    $('#btnGrace').classList.toggle('on', S.mode === 'input' ? S.graceMode : !!(n && n.graces && n.graces.length));
    $('#btnSlur').classList.toggle('on', !!S.pendingSlur && S.pendingSlur.kind === 'slur');
    $('#btnPhrase').classList.toggle('on', !!S.pendingSlur && S.pendingSlur.kind === 'phrase');
    document.querySelectorAll('[data-toggle]').forEach((b) => b.classList.toggle('on', !!S[b.dataset.toggle]));
    wrap.classList.toggle('input', S.mode === 'input');
    $('#zoomVal').textContent = Math.round(S.zoom * 100) + ' %';
    const out = M.countOutOfRange(S.score);
    const rw = $('#rangeWarn');
    rw.hidden = !out;
    rw.innerHTML = P.icon('warn') + out + (out > 1 ? ' notes hors tessiture' : ' note hors tessiture');
  }
  function updateStatus() {
    const info = $('#selInfo');
    const tab = M.measureTable(S.score);
    const where = (t) => {
      const mi = measOf(t), ms = tab[mi];
      const bt = M.sigBeat(ms.sig), off = ms.pickup ? M.sigLen(ms.sig) - ms.len : 0;
      return (ms.pickup ? 'Levée' : 'Mesure ' + M.measureNumber(S.score, mi)) + ', temps ' + frNum(1 + (t - ms.start + off) / bt);
    };
    if (S.range) {
      const m0 = M.measureNumber(S.score, measOf(S.range.a)), m1 = M.measureNumber(S.score, measOf(S.range.b - 1));
      info.textContent = 'Sélection : ' + (m0 === m1 ? 'mesure ' + m0 : 'mesures ' + m0 + ' à ' + m1);
    } else if (S.sel) {
      const n = selNote();
      const inst = M.INSTRUMENTS[S.score.staves[S.sel.s].inst];
      const vn = M.voiceNum(S.score, S.sel.s);
      let txt = where(S.sel.t) + ' · ' + inst.name + (vn > 1 ? ' (voix ' + vn + ')' : '');
      if (n) {
        const names = n.pitches.map((p) => M.pitchName(p)).join(' + ');
        const dn = n.dur ? M.DUR_NAMES[n.dur] + (n.dots ? ' pointée' : '') : '';
        txt = names + (dn ? ' (' + dn + ')' : '') + ' · ' + txt;
        const bad = n.pitches.filter((p) => M.outOfRange(S.score, S.sel.s, p));
        if (bad.length && inst.range) {
          const lo = M.spell(inst.range[0], 0), hi = M.spell(inst.range[1], 0);
          txt += ' · ⚠ hors tessiture (' + M.pitchName(lo) + '–' + M.pitchName(hi) + ')';
        }
      } else txt = 'Silence · ' + txt;
      info.textContent = txt;
    } else if (S.mode === 'input') {
      info.textContent = 'Curseur : ' + where(S.cursor.t) + ' · ' + M.DUR_NAMES[S.dur] + (S.dots ? ' pointée' : '') + (S.tuplet ? ' en triolet' : '') + (S.restMode ? ' (silence)' : '') + (S.voice > 1 ? ' · voix ' + S.voice : '') + (S.graceMode ? ' · petites notes' : '') + (S.chordMode ? ' · accords' : '');
    } else info.textContent = '';
  }
  function buildTracksMenu() {
    const menu = $('#tracksMenu');
    menu.innerHTML = '';
    S.score.staves.forEach((st, s) => {
      if (st.voiceOf) return;
      const def = M.INSTRUMENTS[st.inst];
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !S.muted.has(s);
      cb.onchange = () => { if (cb.checked) S.muted.delete(s); else S.muted.add(s); restartIfPlaying(); };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(def.name + (st.hand ? (st.hand === 'R' ? ' — main droite' : ' — main gauche') : '')));
      menu.appendChild(lab);
    });
  }

  // ------------------------------------------------------------------ fenêtres (dialogues)
  function openModal(html, onOk, opts) {
    const back = $('#modalBack'), modal = $('#modal');
    modal.innerHTML = html;
    back.hidden = false;
    modal.style.width = (opts && opts.width) || '';
    const close = () => { back.hidden = true; modal.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
    const ok = () => { if (onOk(modal) !== false) close(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); if (!opts || !opts.noCancel) close(); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); ok(); }
    }
    document.addEventListener('keydown', onKey, true);
    modal.querySelector('[data-ok]').onclick = ok;
    const c = modal.querySelector('[data-cancel]');
    if (c) c.onclick = close;
    const f = modal.querySelector('input[type=text], input, select');
    if (f) setTimeout(() => f.focus(), 30);
    return modal;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function keyOptions(sel) {
    let h = '';
    for (let f = -7; f <= 7; f++) {
      const k = M.KEYS[f];
      const acc = f === 0 ? 'aucune altération' : Math.abs(f) + (f > 0 ? ' ♯' : ' ♭');
      h += `<option value="${f}" ${f === sel ? 'selected' : ''}>${k[1]} / ${k[2]} (${acc})</option>`;
    }
    return h;
  }
  function instOptions(sel) {
    return Object.entries(M.INSTRUMENTS).map(([k, d]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${d.name}</option>`).join('');
  }

  function scoreDialog(isNew) {
    const sc = isNew ? M.newScore({}) : S.score;
    // lignes d'instruments : {inst, staves:[index existants]}
    let rows = [];
    if (isNew) rows = [{ inst: 'soprano', staves: null }];
    else {
      const seen = new Set();
      S.score.staves.forEach((st, i) => {
        if (st.voiceOf) return;
        if (st.group) {
          if (seen.has(st.group)) return;
          seen.add(st.group);
          rows.push({ inst: st.inst, staves: S.score.staves.map((o, k) => (o.group === st.group ? k : -1)).filter((k) => k >= 0) });
        } else rows.push({ inst: st.inst, staves: [i] });
      });
    }
    const [num, den] = sc.timeSig;
    const html = `
      <h2>${isNew ? 'Nouvelle partition' : 'Propriétés de la partition'}</h2>
      <div class="body">
        <div class="row"><label>Titre</label><input type="text" id="fTitle" value="${esc(isNew ? '' : sc.title)}" placeholder="Sans titre"></div>
        <div class="row"><label>Compositeur</label><input type="text" id="fComposer" value="${esc(isNew ? '' : sc.composer)}"></div>
        <div class="row" style="align-items:start"><label style="padding-top:6px">Instruments</label>
          <div><div class="inst-list" id="fInsts"></div>
          <button id="fAddInst" style="margin-top:6px">+ Instrument</button></div></div>
        <div class="row"><label>Tonalité</label><select id="fKey">${keyOptions(sc.fifths)}</select></div>
        <div class="row"><label>Métrique</label><div class="inline">
          <input type="number" id="fNum" min="1" max="16" value="${num}" style="width:60px"> /
          <select id="fDen">${[2, 4, 8, 16].map((d) => `<option ${d === den ? 'selected' : ''}>${d}</option>`).join('')}</select></div></div>
        <div class="row"><label>Levée</label><select id="fPickup"></select></div>
        <div class="row"><label>Tempo</label><input type="number" id="fTempo" min="20" max="300" value="${sc.tempo}" style="width:80px"></div>
        ${isNew ? `<div class="row"><label>Mesures</label><input type="number" id="fMeasures" min="1" max="500" value="16" style="width:80px"></div>` : ''}
        <div class="row"><label>Son</label><select id="fBank">
          <option value="musyngkite" ${sc.soundBank === 'musyngkite' ? 'selected' : ''}>Doux</option>
          <option value="fluidr3" ${sc.soundBank === 'fluidr3' ? 'selected' : ''}>Brillant</option></select></div>
      </div>
      <div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>${isNew ? 'Créer' : 'Appliquer'}</button></div>`;
    const modal = openModal(html, (m) => {
      const title = m.querySelector('#fTitle').value.trim() || 'Sans titre';
      const composer = m.querySelector('#fComposer').value.trim();
      const fifths = +m.querySelector('#fKey').value;
      const n = clamp(+m.querySelector('#fNum').value || 4, 1, 16);
      const d = +m.querySelector('#fDen').value;
      const tempo = clamp(+m.querySelector('#fTempo').value || 90, 20, 300);
      const bank = m.querySelector('#fBank').value;
      const pickup = (+m.querySelector('#fPickup').value || 0) * (1920 / d);
      if (!rows.length) { toast('Ajoutez au moins un instrument'); return false; }
      if (isNew) {
        const measures = clamp(+m.querySelector('#fMeasures').value || 16, 1, 500);
        loadScore(M.newScore({ title, composer, fifths, timeSig: [n, d], pickup, tempo, measures, soundBank: bank, instruments: rows.map((r) => r.inst) }), null);
        return;
      }
      // partition existante : reconstruit la liste des portées en gardant les notes
      const removedWithNotes = [];
      const used = new Set(rows.flatMap((r) => r.staves || []));
      S.score.staves.forEach((st, i) => { if (!st.voiceOf && !used.has(i) && st.notes.length) removedWithNotes.push(M.INSTRUMENTS[st.inst].name); });
      if (removedWithNotes.length && !confirm('Supprimer ces portées et leurs notes ?\n' + removedWithNotes.join(', '))) return false;
      // garde notes, liaisons, n-olets et identifiant (les voix y sont rattachées)
      const keep = (dst, src) => { if (!src) return; dst.id = src.id; dst.notes = src.notes; dst.slurs = src.slurs || []; dst.tuplets = src.tuplets || []; };
      change(() => {
        const old = S.score.staves;
        const staves = [];
        for (const r of rows) {
          const def = M.INSTRUMENTS[r.inst];
          const src = (r.staves || []).map((i) => old[i]);
          if (def.grand) {
            const g = 'g' + Math.random().toString(36).slice(2, 8);
            const rh = M.newStaff(r.inst, 'R'), lh = M.newStaff(r.inst, 'L');
            rh.group = lh.group = g;
            keep(rh, src[0]); keep(lh, src[1]);
            staves.push(rh, lh);
          } else {
            const st = M.newStaff(r.inst);
            keep(st, src[0]);
            staves.push(st);
          }
        }
        // les voix 2, 3, 4 suivent leur portée
        for (const o of old) {
          if (!o.voiceOf) continue;
          const p = staves.find((x) => x.id === o.voiceOf);
          if (p) staves.push({ ...o, inst: p.inst, clef: p.clef, hand: p.hand });
        }
        S.score.staves = staves;
        S.score.title = title; S.score.composer = composer; S.score.fifths = fifths; S.score.tempo = tempo;
        if (n !== num || d !== den) M.setTimeSig(S.score, n, d);
        if (pickup !== (S.score.pickup || 0)) M.setPickup(S.score, pickup);
        S.score.soundBank = bank;
      });
      S.muted.clear(); S.sel = null; S.range = null;
      validateSel(); buildTracksMenu(); loadBank(); renderAll();
    });
    const list = modal.querySelector('#fInsts');
    const drawRows = () => {
      list.innerHTML = '';
      rows.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'inst-row';
        div.innerHTML = `<select>${instOptions(r.inst)}</select><button title="Monter">↑</button><button title="Descendre">↓</button><button title="Retirer">✕</button>`;
        const [sel, up, down, del] = div.children;
        sel.onchange = () => { r.inst = sel.value; };
        up.onclick = () => { if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; drawRows(); } };
        down.onclick = () => { if (i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; drawRows(); } };
        del.onclick = () => { rows.splice(i, 1); drawRows(); };
        list.appendChild(div);
      });
    };
    drawRows();
    modal.querySelector('#fAddInst').onclick = () => { rows.push({ inst: 'alto', staves: null }); drawRows(); };
    // levée : de 0 à (temps de la mesure − 1), en unités de la métrique choisie
    const pickSel = modal.querySelector('#fPickup');
    const fillPickup = () => {
      const nn = clamp(+modal.querySelector('#fNum').value || 4, 1, 16), dd = +modal.querySelector('#fDen').value;
      const curBeats = Math.round((sc.pickup || 0) / (1920 / dd));
      const unit = { 2: 'blanche', 4: 'noire', 8: 'croche', 16: 'double croche' }[dd] || 'temps';
      let h = '<option value="0">Aucune</option>';
      for (let b = 1; b < nn; b++) h += `<option value="${b}" ${b === curBeats ? 'selected' : ''}>${b} ${unit}${b > 1 ? 's' : ''}</option>`;
      pickSel.innerHTML = h;
    };
    fillPickup();
    modal.querySelector('#fNum').onchange = fillPickup;
    modal.querySelector('#fDen').onchange = fillPickup;
  }

  // Changement de métrique à partir de la mesure sélectionnée
  function timeSigDialog(mArg) {
    const m = mArg != null ? mArg : sigMeasure();
    const cur = M.measureTable(S.score)[m].sig;
    const label = m === 0 ? 'Début de la partition' : 'À partir de la mesure ' + M.measureNumber(S.score, m);
    const html = `<h2>Métrique</h2><div class="body">
      <div class="row"><label>Où</label><div>${esc(label)}</div></div>
      <div class="row"><label>Métrique</label><div class="inline">
        <input type="number" id="sNum" min="1" max="16" value="${cur[0]}" style="width:60px"> /
        <select id="sDen">${[2, 4, 8, 16].map((d) => `<option ${d === cur[1] ? 'selected' : ''}>${d}</option>`).join('')}</select></div></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>Appliquer</button></div>`;
    openModal(html, (md) => {
      const nn = clamp(+md.querySelector('#sNum').value || 4, 1, 16), dd = +md.querySelector('#sDen').value;
      change(() => M.setSigAt(S.score, m, [nn, dd]));
    });
  }

  // ---- triolets ----
  function tupletCommand() {
    if (S.mode === 'input') { S.tuplet = !S.tuplet; updateUI(); updateStatus(); return; }
    const n = selNote();
    if (!n) return toast('Aucune note sélectionnée');
    const s = S.sel.s, t = S.sel.t;
    const sp = M.tupletAt(S.score, s, t);
    if (sp) {
      // retire le triolet : la première note reprend toute la durée
      const first = S.score.staves[s].notes.find((x) => x.start >= sp.start && x.start < sp.start + sp.len);
      change(() => {
        M.removeTuplet(S.score, s, sp);
        const pitches = first ? first.pitches : n.pitches;
        S.score.staves[s].notes = M.clearRange(S.score.staves[s].notes, sp.start, sp.start + sp.len);
        M.placeNote(S.score, s, sp.start, sp.len, pitches, M.hintForTicks(sp.len));
      });
      S.sel = { s, t: sp.start, pi: 0 };
      renderAll();
      return;
    }
    const i = M.DUR_LIST.indexOf(n.dur);
    if (!n.dur || n.dots || i < 0 || i >= M.DUR_LIST.length - 1 || n.len % 3) return toast('Note pointée : impossible');
    const sub = M.DUR_LIST[i + 1];
    change(() => {
      const pitches = n.pitches;
      M.createTuplet(S.score, s, t, n.len, 3, 2);
      M.placeNote(S.score, s, t, n.len / 3, pitches, { dur: sub, dots: 0 });
    });
    S.sel = { s, t, pi: 0 };
    renderAll();
  }

  // ---- enregistrement au micro (étape 3) ----
  const REC_KEY = 'partoch.rec';
  function recPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(REC_KEY) || '{}'); } catch (e) { /* ignore */ }
    return { grid: 120, accomp: false, latencyMs: null, deviceId: '', octave: true, fillGaps: true, ...p };
  }
  function saveRecPrefs(p) { try { localStorage.setItem(REC_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }
  function autoLatencyMs() {
    const ctx = P.audio.ensureCtx();
    return Math.round(((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 + 15);
  }
  function parentStaves() {
    return S.score.staves.map((st, s) => ({ st, s })).filter((o) => !M.isLane(o.st));
  }
  function staffLabel(s) {
    const st = S.score.staves[s], def = M.INSTRUMENTS[st.inst];
    return def.name + (st.hand ? (st.hand === 'R' ? ' — main droite' : ' — main gauche') : '');
  }
  // réglages par défaut tirés de la sélection
  function recDefaults() {
    const ps = parentStaves();
    let s = ps[0].s;
    if (S.sel) s = M.parentIndex(S.score, S.sel.s);
    else if (S.range) s = S.range.s0;
    else if (S.cursor) s = M.parentIndex(S.score, S.cursor.s);
    const sm = selMeasures();
    const m = sm ? sm[0] : S.mode === 'input' && S.cursor ? Math.min(measOf(S.cursor.t), S.score.measures - 1) : 0;
    const last = S.rec && S.rec.cfg;
    return { s, m, tempo: last ? last.tempo : S.score.tempo };
  }

  function recordDialog() {
    if (S.rec) return stopRecording();
    if (!P.mic.supported()) return toast('Le micro n’est pas disponible ici');
    const pr = recPrefs(), d = recDefaults();
    const nums = parentStaves();
    const tab = M.measureTable(S.score);
    const html = `<h2>Enregistrer au micro</h2><div class="body">
      <div class="row"><label>Portée</label><select id="rStaff">${nums.map((o) => `<option value="${o.s}" ${o.s === d.s ? 'selected' : ''}>${esc(staffLabel(o.s))}</option>`).join('')}</select></div>
      <div class="row"><label>Mesure</label><div class="inline"><input type="number" id="rMeas" min="${M.measureNumber(S.score, 0)}" max="${M.measureNumber(S.score, tab.length + 50)}" value="${M.measureNumber(S.score, d.m)}" style="width:70px"></div></div>
      <div class="row"><label>Tempo</label><div class="inline">♩ = <input type="number" id="rTempo" min="30" max="240" value="${d.tempo}" style="width:70px"><span class="help" title="Tempo de l'enregistrement seulement : la partition garde le sien">?</span></div></div>
      <div class="row"><label>Quantification</label><select id="rGrid"><option value="120" ${pr.grid === 120 ? 'selected' : ''}>Double croche</option><option value="240" ${pr.grid === 240 ? 'selected' : ''}>Croche</option></select></div>
      <div class="row"><label>Micro</label><select id="rDev"><option value="">Par défaut</option></select></div>
      <div class="row"><label>Niveau</label><div class="meter"><div id="rMeter"></div></div></div>
      <div class="row"><label></label><label class="check"><input type="checkbox" id="rAcc" ${pr.accomp ? 'checked' : ''}> Accompagnement<span class="help" title="Joue les autres portées pendant l'enregistrement (avec un casque)">?</span></label></div>
      <div class="row"><label></label><label class="check"><input type="checkbox" id="rFill" ${pr.fillGaps ? 'checked' : ''}> Legato<span class="help" title="Prolonge chaque note jusqu’à la suivante, sans petits silences">?</span></label></div>
      <details><summary>Avancé</summary>
        <div class="row"><label>Latence</label><div class="inline"><input type="number" id="rLat" min="0" max="400" value="${pr.latencyMs != null ? pr.latencyMs : autoLatencyMs()}" style="width:70px"> ms<span class="help" title="Décalage entre le jeu et le micro : si les notes tombent trop tard, augmentez ; trop tôt, diminuez">?</span></div></div>
        <div class="row"><label></label><label class="check"><input type="checkbox" id="rOct" ${pr.octave ? 'checked' : ''}> Corriger l’octave<span class="help" title="Ramène les notes dans la tessiture de l'instrument">?</span></label></div>
      </details>
      </div><div class="foot">${S.lastTake ? '<button id="rRedo" title="Avec ces réglages">Retranscrire la dernière prise</button>' : ''}<button data-cancel>Annuler</button><button class="primary rec" data-ok>Enregistrer</button></div>`;
    let meterRaf = 0;
    const md = openModal(html, (m) => {
      cancelAnimationFrame(meterRaf);
      const cfg = readRecForm(m);
      setTimeout(() => startRecording(cfg), 50);
    });
    const readRecForm = (m) => {
      const cfg = {
        s: +m.querySelector('#rStaff').value,
        m: clamp((+m.querySelector('#rMeas').value || 1) - M.measureNumber(S.score, 0), 0, 9999),
        tempo: clamp(+m.querySelector('#rTempo').value || S.score.tempo, 30, 240),
        grid: +m.querySelector('#rGrid').value,
        deviceId: m.querySelector('#rDev').value,
        accomp: m.querySelector('#rAcc').checked,
        fillGaps: m.querySelector('#rFill').checked,
        latencyMs: clamp(+m.querySelector('#rLat').value || 0, 0, 400),
        octave: m.querySelector('#rOct').checked,
      };
      saveRecPrefs({ grid: cfg.grid, accomp: cfg.accomp, latencyMs: cfg.latencyMs, deviceId: cfg.deviceId, octave: cfg.octave, fillGaps: cfg.fillGaps });
      return cfg;
    };
    // micro : liste des entrées + vumètre en direct
    const devSel = md.querySelector('#rDev');
    const openMic = async () => {
      try {
        await P.mic.open(devSel.value || null);
        const list = await P.mic.listDevices();
        const cur = devSel.value || pr.deviceId;
        devSel.innerHTML = '<option value="">Par défaut</option>' + list.filter((x) => x.id && x.id !== 'default').map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
      } catch (e) {
        md.querySelector('#rMeter').parentNode.outerHTML = `<div class="err">Micro inaccessible<span class="help" title="${esc(e.message || e.name)} — Windows : Paramètres → Confidentialité → Microphone">?</span></div>`;
      }
    };
    if (pr.deviceId) devSel.innerHTML += `<option value="${esc(pr.deviceId)}" selected>Micro choisi</option>`;
    devSel.onchange = openMic;
    openMic();
    const meter = () => {
      const el = md.querySelector('#rMeter');
      if (!el || $('#modalBack').hidden) return;
      const lv = P.mic.level();
      el.style.width = Math.min(100, Math.sqrt(lv) * 100) + '%';
      el.className = lv > 0.95 ? 'clip' : '';
      meterRaf = requestAnimationFrame(meter);
    };
    meterRaf = requestAnimationFrame(meter);
    const redo = md.querySelector('#rRedo');
    if (redo) redo.onclick = () => {
      const cfg = readRecForm(md);
      $('#modalBack').hidden = true; md.innerHTML = '';
      cancelAnimationFrame(meterRaf);
      const t = S.lastTake;
      applyTake(t, { ...t.cfg, grid: cfg.grid, latencyMs: cfg.latencyMs, octave: cfg.octave, fillGaps: cfg.fillGaps });
    };
  }

  // R : relance directement avec les derniers réglages (ou ouvre le dialogue la première fois)
  function quickRecord() {
    if (S.rec) return stopRecording();
    const pr = recPrefs();
    if (!S.recUsed) return recordDialog();
    const d = recDefaults();
    startRecording({ ...pr, s: d.s, m: d.m, tempo: d.tempo, latencyMs: pr.latencyMs != null ? pr.latencyMs : autoLatencyMs() });
  }

  async function startRecording(cfg, testInput) {
    closeTuner();
    if (S.rec) return;
    if (!P.audio.ready) return toast('Chargement des sons…');
    if (P.player.playing) { P.player.stop(); stopAnim(); }
    let input = testInput;
    if (!input) {
      try { input = await P.mic.open(cfg.deviceId || null); } catch (e) { return toast('Micro inaccessible : ' + (e.message || e.name), 5000); }
    }
    const sc = S.score;
    const from = M.measureStart(sc, cfg.m);
    // partition de travail prolongée : le métronome continue au-delà de la fin
    const work = JSON.parse(JSON.stringify(sc));
    work.measures = Math.max(sc.measures, cfg.m + 1) + 300;
    const endTick = M.measureStart(work, work.measures);
    const lanes = new Set(M.lanesOf(sc, cfg.s));
    const muted = new Set();
    sc.staves.forEach((_, s) => { if (!cfg.accomp || lanes.has(s) || S.muted.has(M.parentIndex(sc, s))) muted.add(s); });
    const cap = await P.mic.startCapture(input);
    const speed = cfg.tempo / sc.tempo;
    P.player.onEnd = null;
    P.player.start(work, { fromTick: from, speed, metronome: true, countIn: true, muted, endTick });
    S.rec = { cfg, cap, from, zeroTime: P.player.segs[0].time, spt: P.player.spt, work };
    S.recUsed = true;
    S.mode = 'select'; S.sel = null; S.range = null; S.hover = null;
    renderAll();
    startAnim();
    $('#btnRec').classList.add('recording');
    const bar = $('#recBar');
    bar.hidden = false;
    const tick = () => {
      if (!S.rec) return;
      S.rec.raf = requestAnimationFrame(tick);
      const ct = P.player.currentTick();
      const lv = cap.peak;
      $('#recMeter').style.width = Math.min(100, Math.sqrt(lv) * 100) + '%';
      if (!ct) return;
      if (ct.countIn) {
        const left = Math.max(0, S.rec.zeroTime - P.audio.ctx.currentTime);
        const sig = M.measureTable(work)[cfg.m].sig;
        const beatSec = M.sigBeat(sig) * S.rec.spt;
        const nb = Math.round(M.sigLen(sig) / M.sigBeat(sig));
        $('#recText').textContent = 'Décompte… ' + Math.max(1, Math.min(nb, Math.ceil(left / beatSec - 0.05)));
      } else {
        const tab = M.measureTable(work);
        const mi = M.measureAt(work, ct.tick, tab);
        const beats = M.beatsBetween(work, tab[mi].start, ct.tick + 1, tab).length;
        $('#recText').textContent = '● Enregistrement — ' + staffLabel(cfg.s) + ' · mesure ' + M.measureNumber(work, mi) + ', temps ' + Math.max(1, beats);
      }
    };
    tick();
  }

  async function stopRecording() {
    const R = S.rec;
    if (!R) return;
    const ct = P.player.currentTick();
    const stopTick = ct && !ct.countIn ? ct.tick : R.from;
    P.player.stop();
    stopAnim();
    cancelAnimationFrame(R.raf);
    S.rec = null;
    $('#recBar').hidden = true;
    $('#btnRec').classList.remove('recording');
    const take = await P.mic.stopCapture(R.cap);
    if (stopTick <= R.from + 60) { toast('Rien d’enregistré'); return; }
    take.zeroTime = R.zeroTime;
    take.spt = R.spt;
    take.fromTick = R.from;
    take.endTick = stopTick;
    take.cfg = R.cfg;
    S.lastTake = take;
    toast('Analyse…', 800);
    setTimeout(() => applyTake(take, R.cfg), 30);
  }

  // écrit la transcription dans la portée (une seule étape d'annulation)
  function applyTake(take, cfg) {
    const res = P.transcribe.transcribe(take, { grid: cfg.grid || 120, latency: (cfg.latencyMs || 0) / 1000, fillGaps: cfg.fillGaps !== false });
    const sc = S.score;
    const s = cfg.s;
    const def = M.INSTRUMENTS[sc.staves[s].inst];
    let notes = res.notes.map((n) => ({ ...n, w: n.midi - (def.soundShift || 0) }));
    // octave : on choisit le décalage qui met le plus de notes dans la tessiture
    let octShift = 0;
    const range = def.range || (sc.staves[s].clef === 'bass' ? [36, 67] : [55, 91]);
    if (cfg.octave !== false && notes.length) {
      let best = -1;
      for (const k of [0, -12, 12, -24, 24]) {
        const inR = notes.filter((n) => n.w + k >= range[0] && n.w + k <= range[1]).length;
        if (inR > best + (k === 0 ? 0 : 0.5)) { best = inR; octShift = k; }
      }
    }
    // fin de la zone remplacée : fin de la mesure où l'on s'est arrêté
    const tab = M.measureTable(sc);
    const lastTick = Math.max(take.endTick - 1, ...notes.map((n) => n.start + n.len - 1));
    const end = M.measureStart(sc, M.measureAt(sc, lastTick, tab) + 1, tab);
    change(() => {
      const st = sc.staves[s];
      st.notes = M.clearRange(st.notes, take.fromTick, end);
      st.slurs = (st.slurs || []).filter((sl) => sl.end < take.fromTick || sl.start >= end);
      st.tuplets = (st.tuplets || []).filter((sp) => sp.start + sp.len <= take.fromTick || sp.start >= end);
      for (const n of notes) M.placeNote(sc, s, n.start, n.len, [M.spell(n.w + octShift, sc.fifths)], M.hintForTicks(n.len));
      // la partition couvre toute la prise
      if (notes.length) {
        const lastEnd = Math.max(...notes.map((n) => n.start + n.len));
        sc.measures = Math.max(sc.measures, M.measureAt(sc, lastEnd - 1) + 1);
      }
    });
    S.sel = null;
    S.range = { s0: s, s1: s, a: take.fromTick, b: end };
    S.anchor = null;
    S.playFrom = take.fromTick;
    renderAll();
    scrollToTick(take.fromTick);
    const m0 = M.measureNumber(sc, M.measureAt(sc, take.fromTick)), m1 = M.measureNumber(sc, M.measureAt(sc, end - 1));
    if (!notes.length) toast('Aucune note détectée', 4000);
    else toast(notes.length + ' note' + (notes.length > 1 ? 's' : '') + ' (mesures ' + m0 + '–' + m1 + ')' + (octShift ? ', octave corrigée' : ''), 3000);
    return { notes: notes.length, octShift, tuning: res.tuning };
  }
  window.PartochDebug.startRecording = startRecording;
  window.PartochDebug.stopRecording = stopRecording;
  window.PartochDebug.applyTake = applyTake;

  // ---- import d'un enregistrement audio ----
  async function importAudio(name, bytes) {
    const short = name.split(/[\\/]/).pop();
    const title = short.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    let cancelled = false;
    const md = openModal(`<h2>Analyse de l’enregistrement</h2><div class="body">
      <div>${esc(short)}</div>
      <div id="aiStep" class="muted">Lecture du fichier…</div>
      <div class="meter wide"><div id="aiBar"></div></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button data-ok hidden></button></div>`, () => {});
    md.querySelector('[data-cancel]').addEventListener('click', () => { cancelled = true; });
    const step = (t, pct) => {
      const a = md.querySelector('#aiStep'), b = md.querySelector('#aiBar');
      if (a) a.textContent = t;
      if (b && pct != null) b.style.width = Math.round(pct * 100) + '%';
    };
    let ctx;
    try {
      const dec = await P.audioImport.decode(bytes);
      if (cancelled) return;
      if (dec.duration > 15 * 60) throw new Error('enregistrement trop long (15 minutes au maximum)');
      step('Chargement du modèle de reconnaissance…', 0.02);
      await P.audioImport.lib();
      if (cancelled) return;
      step('Détection des notes… 0 %', 0.03);
      const raw = await P.audioImport.analyze(dec.samples, (p) => step('Détection des notes… ' + Math.round(p * 100) + ' %', 0.03 + p * 0.97));
      if (cancelled) return;
      ctx = { raw, duration: dec.duration, notesBySens: {} };
    } catch (e) {
      console.error(e);
      $('#modalBack').hidden = true; md.innerHTML = '';
      if (!cancelled) alert('Impossible d’analyser ce fichier : ' + e.message);
      return;
    }
    $('#modalBack').hidden = true; md.innerHTML = '';
    audioImportDialog(title, short, ctx);
  }

  function audioImportDialog(title, short, ctx) {
    const o = { sens: 'normal', grid: 120, sig: null, voices: 0, bpm: null, T: null, fillGaps: true };
    let manual = {}; // instruments choisis à la main (par voix)
    let res = null;
    const instChoices = ['soprano', 'alto', 'tenor', 'bass', 'melody', 'melodyBass'];
    const md = openModal(`<h2>Importer un enregistrement</h2><div class="body">
      <div class="muted">${esc(short)} — ${Math.floor(ctx.duration / 60)} min ${String(Math.round(ctx.duration % 60)).padStart(2, '0')}</div>
      <div id="aSum" class="summary"></div>
      <div class="row"><label>Métrique</label><select id="aSig"><option value="">Automatique</option>${['2/4', '3/4', '4/4', '6/8', '9/8', '12/8'].map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div class="row"><label id="aTempoLab">Tempo</label><div class="inline"><input type="number" id="aTempo" min="30" max="240" style="width:70px"> <button id="aTempoAuto" title="Tempo détecté">auto</button> <button id="aTempoX2" title="Doubler">×2</button> <button id="aTempoH" title="Diviser par deux">÷2</button></div></div>
      <div class="row"><label>Voix</label><select id="aVoices"><option value="0">Automatique</option><option value="1">1 voix</option><option value="2">2 voix</option><option value="3">3 voix</option><option value="4">4 voix</option></select></div>
      <div class="row"><label>Quantification</label><select id="aGrid"><option value="120">Double croche</option><option value="240">Croche</option></select></div>
      <div class="row"><label>Sensibilité<span class="help" title="Basse : enregistrement bruyant. Haute : notes faibles ou rapides">?</span></label><select id="aSens"><option value="low">Basse</option><option value="normal" selected>Normale</option><option value="high">Haute</option></select></div>
      <div class="row"><label>Transposition</label><select id="aT"></select></div>
      <div class="row top"><label>Instruments</label><div id="aInsts" class="insts"></div></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>Importer</button></div>`, () => {
      if (!res || res.empty) { toast('Aucune note à importer'); return false; }
      const insts = res.voices.map((_, v) => manual[v] || res.insts[v]);
      const sc = P.audioImport.buildScore(res, title, insts);
      loadScore(sc, null);
      setDirty(true);
      toast(`Importé : ${res.voices.reduce((a, v) => a + v.length, 0)} notes sur ${res.voices.length} portée${res.voices.length > 1 ? 's' : ''}`, 4000);
    }, { width: 'min(780px, 94vw)' });
    const $m = (s) => md.querySelector(s);
    const compound = () => !!(res && res.sig && res.sig[1] === 8);
    const refresh = () => {
      res = P.audioImport.compute(ctx, o);
      if (res.empty) { $m('#aSum').textContent = 'Aucune note détectée. Essayez « plus de notes ».'; $m('#aInsts').innerHTML = ''; return; }
      // tempo affiché dans l'unité de la métrique (noire, ou noire pointée en 6/8…)
      $m('#aTempoLab').textContent = compound() ? 'Tempo (♩. =)' : 'Tempo (♩ =)';
      if (document.activeElement !== $m('#aTempo')) $m('#aTempo').value = o.bpm || res.beatBpm;
      const keyTxt = P.audioImport.keyName(res.key.fifths, res.key.minor);
      const nNotes = res.voices.reduce((a, v) => a + v.length, 0);
      $m('#aSum').innerHTML = `<b>${nNotes}</b> notes · <b>${res.nv}</b> voix${o.voices ? '' : ' (détectées)'} · <b>${res.sig.join('/')}</b>${res.autoSig ? ' (détectée)' : ''} · tonalité <b>${esc(keyTxt)}</b>${res.pickup ? ' · levée de ' + (res.pickup / (res.sig[1] === 8 ? 720 : 480)) + ' temps' : ''}`;
      // transpositions
      $m('#aT').innerHTML = res.tr.options.map((op) => {
        const k = P.audioImport.keyName(op.fifths, res.key.minor);
        const lab = (op.T === 0 ? 'Aucune' : (op.T > 0 ? '+' : '') + op.T + ' demi-ton' + (Math.abs(op.T) > 1 ? 's' : '')) + ' → ' + k + ' · ' + Math.round(op.cov * 100) + ' % jouable' + (op.T === res.tr.recommended && op.T !== 0 ? ' (conseillé)' : '');
        return `<option value="${op.T}" ${op.T === res.T ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('');
      // instruments par voix
      $m('#aInsts').innerHTML = res.voices.map((v, i) => {
        const cur = manual[i] || res.insts[i];
        const pitches = v.map((n) => n.pitch);
        const cov = Math.round(P.audioImport.coverage(pitches, cur, res.T) * 100);
        const lo = Math.min(...pitches) + res.T, hi = Math.max(...pitches) + res.T;
        const rng = v.length ? M.pitchName(M.spell(lo, res.fifths)) + ' – ' + M.pitchName(M.spell(hi, res.fifths)) : '';
        return `<div class="instrow"><span class="vn">Voix ${i + 1}</span><select data-v="${i}">${instChoices.map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(M.INSTRUMENTS[k].name)}</option>`).join('')}</select>
          <span class="muted">${v.length} notes · ${esc(rng)} (son réel)${M.INSTRUMENTS[cur].range ? ' · <span class="' + (cov < 90 ? 'warn' : '') + '">' + cov + ' % dans la tessiture</span>' : ''}</span></div>`;
      }).join('');
      $m('#aInsts').querySelectorAll('select').forEach((sel) => { sel.onchange = () => { manual[+sel.dataset.v] = sel.value; refresh(); }; });
    };
    $m('#aSig').onchange = () => { const v = $m('#aSig').value; o.sig = v ? v.split('/').map(Number) : null; o.bpm = null; refresh(); };
    $m('#aTempo').onchange = () => { const v = +$m('#aTempo').value; o.bpm = v >= 30 && v <= 240 ? v : null; refresh(); };
    $m('#aTempoAuto').onclick = () => { o.bpm = null; refresh(); };
    $m('#aTempoX2').onclick = () => { o.bpm = Math.min(240, (o.bpm || res.beatBpm) * 2); refresh(); };
    $m('#aTempoH').onclick = () => { o.bpm = Math.max(30, Math.round((o.bpm || res.beatBpm) / 2)); refresh(); };
    $m('#aVoices').onchange = () => { o.voices = +$m('#aVoices').value; manual = {}; refresh(); };
    $m('#aGrid').onchange = () => { o.grid = +$m('#aGrid').value; refresh(); };
    $m('#aSens').onchange = () => { o.sens = $m('#aSens').value; refresh(); };
    $m('#aT').onchange = () => { o.T = +$m('#aT').value; manual = {}; refresh(); };
    refresh();
  }
  window.PartochDebug.importAudio = importAudio;

  // ---- partitions scannées : scanner (WIA) + reconnaissance (Audiveris) ----
  const isScanImage = (name) => /\.(png|jpe?g|tiff?|bmp|pdf)$/i.test(name || '');
  function scanPrefs() { try { return JSON.parse(localStorage.getItem('partoch.scan')) || {}; } catch (e) { return {}; } }
  function saveScanPrefs(o) { try { localStorage.setItem('partoch.scan', JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function audiverisMissing() {
    const md = openModal(`<h2>Reconnaissance de partitions</h2><div class="body">
      <div>La lecture des partitions scannées nécessite <b>Audiveris</b> (gratuit), qui n’est pas installé.</div>
      </div><div class="foot"><button data-cancel>Fermer</button><button class="primary" data-ok>Ouvrir la page de téléchargement</button></div>`, () => { api.openAudiverisSite(); });
    return md;
  }

  async function scanDialog() {
    if (!api || !api.scanList) return toast('Scanner indisponible ici');
    const st = await api.omrStatus();
    if (!st.windows) return toast('Le scanner n’est disponible que sous Windows');
    if (!st.audiveris) return audiverisMissing();
    const prefs = scanPrefs();
    const pages = []; // { path, url }
    let busy = false;
    const token = {};
    S.scanToken = token;
    const md = openModal(`<h2>Scanner une partition</h2><div class="body">
      <div class="row"><label>Scanner</label><select id="scDev"><option>Recherche…</option></select></div>
      <div class="row"><label>Qualité</label><select id="scDpi"><option value="300">300 ppp</option><option value="400">400 ppp</option><option value="200">200 ppp</option></select></div>
      <div id="scPages" class="scanpages"></div>
      <div id="scState" class="muted"></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button id="scScan">Numériser la page</button><button class="primary" data-ok disabled>Lire la partition</button></div>`, () => {
      if (busy || !pages.length) return false;
      S.scanToken = null;
      omrImport(pages.map((pg) => pg.path), 'Partition scannée');
    }, { width: 'min(640px, 94vw)' });
    const $m = (q) => md.querySelector(q);
    $m('#scDpi').value = String(prefs.dpi || 300);
    const draw = () => {
      $m('#scPages').innerHTML = pages.map((pg, i) => `<div class="scanpage"><img src="${pg.url}" alt=""><span>Page ${i + 1}</span><button data-del="${i}" title="Retirer cette page">×</button></div>`).join('');
      $m('#scPages').querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { pages.splice(+b.dataset.del, 1); draw(); }; });
      $m('[data-ok]').disabled = busy || !pages.length;
      $m('#scScan').disabled = busy || !$m('#scDev').value;
      $m('#scScan').textContent = pages.length ? 'Numériser la page suivante' : 'Numériser la page';
    };
    const r = await api.scanList();
    if (S.scanToken !== token) return;
    const list = r.list || [];
    if (!list.length) {
      $m('#scDev').innerHTML = '<option value="">Aucun scanner trouvé</option>';
      $m('#scState').innerHTML = '<span class="err">Aucun scanner trouvé</span>';
    } else {
      $m('#scDev').innerHTML = list.map((d) => `<option value="${esc(d.id)}">${esc(d.name.replace(/^\S+\s+\((.*)\)$/, '$1'))}</option>`).join('');
      if (prefs.device && list.some((d) => d.id === prefs.device)) $m('#scDev').value = prefs.device;
    }
    draw();
    $m('#scScan').onclick = async () => {
      if (busy) return;
      busy = true; draw();
      const dpi = +$m('#scDpi').value, device = $m('#scDev').value;
      saveScanPrefs({ dpi, device });
      $m('#scState').textContent = `Numérisation de la page ${pages.length + 1}…`;
      const res = await api.scanPage({ deviceId: device, dpi });
      if (S.scanToken !== token) return;
      busy = false;
      if (res.error) {
        $m('#scState').innerHTML = '<span class="err">Échec de la numérisation : ' + esc(res.error) + '</span>';
      } else {
        pages.push({ path: res.path, url: 'data:image/png;base64,' + res.base64 });
        $m('#scState').textContent = `${pages.length} page${pages.length > 1 ? 's' : ''}`;
      }
      draw();
    };
  }

  // Reconnaissance d'une ou plusieurs pages (images ou PDF) → partition
  async function omrImport(files, title) {
    if (!api || !api.omrRun) return alert('La lecture de partitions scannées ne marche que dans l’application Partoch.');
    const st = await api.omrStatus();
    if (!st.audiveris) return audiverisMissing();
    let cancelled = false;
    const md = openModal(`<h2>Lecture de la partition</h2><div class="body">
      <div id="omStep" class="muted">Démarrage…</div>
      <div class="meter wide"><div id="omBar"></div></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button data-ok hidden></button></div>`, () => {}, { noCancel: true });
    md.querySelector('[data-cancel]').onclick = () => { cancelled = true; api.omrCancel(); };
    const off = api.onOmrProgress((pr) => {
      const a = md.querySelector('#omStep'), b = md.querySelector('#omBar');
      if (!a) return;
      const pageTxt = files.length > 1 ? `Page ${pr.file + 1} sur ${files.length}` : `Page ${pr.sheet}`;
      a.textContent = `${pageTxt} — étape ${pr.step} sur ${pr.steps}`;
      const frac = files.length > 1 ? (pr.file + pr.step / pr.steps) / files.length : pr.step / pr.steps;
      b.style.width = Math.round(frac * 100) + '%';
    });
    const t0 = performance.now();
    const res = await api.omrRun(files);
    off();
    $('#modalBack').hidden = true; md.innerHTML = '';
    if (cancelled || res.error === 'CANCELLED') return toast('Lecture annulée');
    if (res.error) {
      const msg = res.error === 'NO_MUSIC' ? 'aucune portée reconnue' : res.error;
      return alert('Impossible de lire la partition : ' + msg);
    }
    try {
      const scores = [], warnings = new Set();
      for (const perFile of res.results) {
        for (const b64 of perFile) {
          const r = await P.io.importBytes('page.mxl', b64ToBytes(b64));
          r.warnings.forEach((w) => warnings.add(w));
          scores.push(r.score);
        }
      }
      if (!scores.length) throw new Error('aucune portée reconnue');
      const merged = scores.length > 1 ? P.io.concatScores(scores) : { score: scores[0], warnings: [] };
      merged.warnings.forEach((w) => warnings.add(w));
      const sc = merged.score;
      const changed = P.io.recordersForUnknownParts(sc);
      if (!sc.title || sc.title === 'Sans titre') sc.title = title || files[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      loadScore(sc, null);
      setDirty(true);
      const nNotes = sc.staves.reduce((a, x) => a + x.notes.length, 0);
      const secs = Math.round((performance.now() - t0) / 1000);
      void changed;
      // parties simples (hors piano) : instrument modifiable tout de suite
      const parts = sc.staves.map((x, i) => i).filter((i) => !sc.staves[i].voiceOf && !sc.staves[i].group);
      const kx = M.KEYS[sc.fifths] || M.KEYS[0];
      const md2 = openModal(`<h2>Partition lue</h2><div class="body">
        <div class="row"><label>Titre</label><input type="text" id="orTitle" value="${esc(sc.title || '')}"></div>
        <div class="row"><label>Compositeur</label><input type="text" id="orComp" value="${esc(sc.composer || '')}"></div>
        ${parts.map((i, k) => `<div class="row"><label>${parts.length > 1 ? 'Partie ' + (k + 1) : 'Instrument'}</label><select data-part="${i}">${instOptions(sc.staves[i].inst)}</select></div>`).join('')}
        <div class="omrsum"><span><b>${sc.measures}</b> mesures</span><span><b>${nNotes}</b> notes</span><span>${sc.timeSig[0]}/${sc.timeSig[1]}</span><span>${esc(kx[1])} / ${esc(kx[2])}</span><span class="muted">${secs} s</span></div>
        ${warnings.size ? `<ul style="margin:0;padding-left:20px;line-height:1.6">${[...warnings].map((w) => '<li>' + esc(w) + '</li>').join('')}</ul>` : ''}
        </div><div class="foot"><button class="primary" data-ok>OK</button></div>`, (m) => {
        const title = m.querySelector('#orTitle').value.trim() || 'Sans titre', comp = m.querySelector('#orComp').value.trim();
        const insts = [...m.querySelectorAll('[data-part]')].map((el) => [+el.dataset.part, el.value]);
        const same = title === S.score.title && comp === (S.score.composer || '') && insts.every(([i, k]) => S.score.staves[i].inst === k);
        if (same) return;
        change(() => {
          S.score.title = title; S.score.composer = comp;
          for (const [i, k] of insts) {
            if (S.score.staves[i].inst === k) continue;
            const ids = new Set([S.score.staves[i].id]);
            for (const st of S.score.staves) if (st.id === S.score.staves[i].id || ids.has(st.voiceOf)) { st.inst = k; st.clef = M.INSTRUMENTS[k].clef; }
          }
        });
        $('#title').textContent = S.score.title; $('#composer').textContent = S.score.composer || '';
      }, { width: 'min(520px, 94vw)' });
      setTimeout(() => { const ti = md2.querySelector('#orTitle'); if (ti) ti.select(); }, 40);
    } catch (e) {
      console.error(e);
      alert('Impossible d’importer la partition lue : ' + e.message);
    }
  }
  window.PartochDebug.omrImport = omrImport;

  // ---- accords ----
  function chordCommand() {
    if (S.mode !== 'input') setMode('input');
    S.chordMode = !S.chordMode;
    if (S.chordMode) S.graceMode = false;
    updateUI(); updateStatus();
  }

  // ---- métrique : menu rapide ----
  function sigMeasure() {
    const sm = selMeasures();
    if (sm) return sm[0];
    if (S.mode === 'input' && S.cursor) return Math.min(measOf(S.cursor.t), S.score.measures - 1);
    return 0;
  }
  function openSigMenu(m, anchor) {
    const menu = $('#sigMenu');
    S.sigM = m == null ? sigMeasure() : m;
    const cur = M.measureTable(S.score)[S.sigM].sig.join('/');
    $('#sigWhere').textContent = S.sigM === 0 ? 'Début de la partition' : 'À partir de la mesure ' + M.measureNumber(S.score, S.sigM);
    menu.querySelectorAll('[data-sig]').forEach((b) => b.classList.toggle('on', b.dataset.sig === cur));
    menu.style.position = anchor ? 'fixed' : '';
    menu.style.left = anchor ? Math.max(8, Math.min(anchor.x, innerWidth - 260)) + 'px' : '';
    menu.style.right = anchor ? 'auto' : '';
    menu.style.top = anchor ? anchor.y + 'px' : '';
    menu.hidden = false;
    $('#tracksMenu').hidden = true; $('#exportMenu').hidden = true;
  }
  function applySig(str) {
    const [nn, dd] = str.split('/').map(Number);
    const m = S.sigM != null ? S.sigM : sigMeasure();
    $('#sigMenu').hidden = true;
    const before = M.measureTable(S.score)[m].sig.join('/');
    if (before === str) return;
    change(() => M.setSigAt(S.score, m, [nn, dd]));
  }

  // ---- petites notes ----
  function graceCommand() {
    if (S.mode === 'input') {
      S.graceMode = !S.graceMode; updateUI(); updateStatus();
      return;
    }
    const n = selNote();
    if (!n) return toast('Aucune note sélectionnée');
    const s = S.sel.s, t = S.sel.t;
    if (n.graces && n.graces.length) {
      change(() => { delete M.noteAt(S.score, s, t).graces; });
      return;
    }
    // par défaut : la note conjointe supérieure, barrée (acciaccature)
    const top = n.pitches[n.pitches.length - 1];
    change(() => { M.noteAt(S.score, s, t).graces = [{ pitches: [M.pitchFromDn(M.dnOf(top) + 1, S.score.fifths)], dur: '8', slash: true }]; });
  }
  function addGraceAt(h, tg) {
    const lane = inputLane(h.s);
    const n = lane >= 0 ? M.noteAt(S.score, lane, tg.t) : null;
    if (!n) return toast('Cliquez sur une note');
    const p = pitchFromPos(lane, h.pos);
    change(() => {
      const nn = M.noteAt(S.score, lane, tg.t);
      nn.graces = nn.graces || [];
      nn.graces.push({ pitches: [p], dur: S.dur === '16' || S.dur === '32' ? '16' : '8', slash: S.dur !== 'q' && S.dur !== 'h' });
    });
    S.sel = { s: lane, t: tg.t, pi: 0 };
    S.pendingAcc = null;
    previewPitch(lane, p);
    renderAll();
  }

  // ---- voix ----
  function setVoice(v) {
    S.voice = v;
    const n = selNote();
    if (S.mode === 'select' && n && M.voiceNum(S.score, S.sel.s) !== v) {
      // déplace la note sélectionnée dans cette voix
      const { s, t } = S.sel;
      let dst = -1;
      change(() => {
        const src = M.noteAt(S.score, s, t);
        dst = M.laneFor(S.score, s, v, true);
        const nn = M.placeNote(S.score, dst, t, src.len, src.pitches, src.dur ? { dur: src.dur, dots: src.dots || 0 } : null);
        if (src.graces) nn.graces = src.graces;
        nn.tie = src.tie; nn.breath = src.breath; if (src.orn) nn.orn = src.orn;
        M.deleteAt(S.score, s, t);
      });
      S.sel = { s: dst, t, pi: 0 };
      renderAll();
      return;
    }
    if (S.mode === 'input') S.cursor.s = M.laneFor(S.score, S.cursor.s, v, true);
    renderAll();
  }

  // ---- Paramètres : raccourcis clavier ----
  function prefsDialog() {
    const groups = [];
    for (const [id, name, , g] of P.keys.ACTIONS) {
      let grp = groups.find((x) => x.g === g);
      if (!grp) groups.push((grp = { g, rows: [] }));
      grp.rows.push([id, name]);
    }
    const html = `<h2>Paramètres</h2><div class="body prefs">
      <div class="prefs-head"><b>Raccourcis clavier</b><button class="link" id="kReset">Tout rétablir</button></div>
      <div class="keylist">${groups.map((grp) => `<div class="kgroup">${esc(grp.g)}</div>` + grp.rows.map(([id, name]) =>
        `<div class="krow" data-id="${id}"><span class="kname">${esc(name)}</span><button class="kbtn" data-id="${id}"></button><button class="kundo" data-id="${id}" data-icon="undo" title="Touche par défaut"></button></div>`).join('')).join('')}</div>
      <div class="note" id="kMsg"></div>
      </div><div class="foot"><button class="primary" data-ok>Fermer</button></div>`;
    let capturing = null;
    const md = openModal(html, () => { stopCapture(); applyShortcuts(); }, { width: '520px' });
    P.applyIcons(md);
    const msg = (t) => { md.querySelector('#kMsg').textContent = t || ''; };
    const refresh = () => {
      md.querySelectorAll('.kbtn').forEach((b) => {
        const ks = P.keys.keysOf(b.dataset.id);
        b.textContent = ks.length ? ks.map(P.keys.label).join(' / ') : '—';
        b.classList.toggle('none', !ks.length);
        b.classList.toggle('capturing', capturing === b.dataset.id);
        if (capturing === b.dataset.id) b.textContent = 'Appuyez sur une touche…';
      });
      md.querySelectorAll('.kundo').forEach((b) => { b.style.visibility = P.keys.isCustom(b.dataset.id) ? 'visible' : 'hidden'; });
      applyShortcuts();
    };
    function onCap(e) {
      if (!capturing) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stopCapture(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { P.keys.set(capturing, null); stopCapture(); return; }
      const combo = P.keys.comboOf(e);
      if (!combo) return; // touche de modification seule : on attend la suite
      const why = P.keys.reservedReason(combo);
      if (why) { msg(P.keys.label(combo) + ' : ' + why); return; }
      const prev = P.keys.find(combo);
      P.keys.set(capturing, combo);
      msg(prev && prev !== capturing ? P.keys.label(combo) + ' retiré de « ' + P.keys.NAMES[prev] + ' »' : '');
      stopCapture();
    }
    function stopCapture() {
      capturing = null;
      window.removeEventListener('keydown', onCap, true);
      if (md.isConnected) refresh();
    }
    md.querySelectorAll('.kbtn').forEach((b) => b.addEventListener('click', () => {
      msg('');
      capturing = b.dataset.id;
      window.removeEventListener('keydown', onCap, true);
      window.addEventListener('keydown', onCap, true);
      refresh();
    }));
    md.querySelectorAll('.kundo').forEach((b) => b.addEventListener('click', () => { P.keys.reset(b.dataset.id); msg(''); refresh(); }));
    md.querySelector('#kReset').addEventListener('click', () => { P.keys.reset(); msg(''); refresh(); });
    md.querySelector('[data-ok]').addEventListener('mousedown', () => stopCapture());
    refresh();
  }

  function transposeDialog() {
    const names = { 0: 'unisson', 1: 'seconde mineure', 2: 'seconde majeure', 3: 'tierce mineure', 4: 'tierce majeure', 5: 'quarte', 6: 'triton', 7: 'quinte', 8: 'sixte mineure', 9: 'sixte majeure', 10: 'septième mineure', 11: 'septième majeure', 12: 'octave' };
    let opts = '';
    for (let i = 12; i >= -12; i--) {
      if (i === 0) continue;
      opts += `<option value="${i}" ${i === 2 ? 'selected' : ''}>${i > 0 ? '+' : '−'}${Math.abs(i)} demi-ton${Math.abs(i) > 1 ? 's' : ''} — ${names[Math.abs(i)]} ${i > 0 ? 'vers le haut' : 'vers le bas'}</option>`;
    }
    const hasRange = !!S.range;
    const html = `<h2>Transposer</h2><div class="body">
      <div class="row"><label>Intervalle</label><select id="tInt">${opts}</select></div>
      <div class="row"><label></label><label class="chk"><input type="checkbox" id="tKey" ${hasRange ? '' : 'checked'}> Changer l'armure</label></div>
      ${hasRange ? '<div class="row"><label></label><label class="chk"><input type="checkbox" id="tSel" checked> Seulement la sélection</label></div>' : ''}
      <div class="note" id="tPreview"></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>Transposer</button></div>`;
    const newFifths = (semis) => {
      let f = S.score.fifths + 7 * semis;
      f = ((f % 12) + 12) % 12;
      if (f > 6) f -= 12;
      return f;
    };
    const modal = openModal(html, (m) => {
      const semis = +m.querySelector('#tInt').value;
      const withKey = m.querySelector('#tKey').checked;
      const onlySel = hasRange && m.querySelector('#tSel').checked;
      change(() => {
        if (onlySel) M.transpose(S.score, semis, S.score.fifths, S.range);
        else M.transpose(S.score, semis, withKey ? newFifths(semis) : S.score.fifths, null);
      });
      toast('Transposé de ' + (semis > 0 ? '+' : '') + semis + ' demi-tons');
    });
    const upd = () => {
      const semis = +modal.querySelector('#tInt').value;
      const f = newFifths(semis);
      modal.querySelector('#tPreview').textContent = 'Tonalité actuelle : ' + M.KEYS[S.score.fifths][1] + ' → ' + M.KEYS[f][1];
    };
    modal.querySelector('#tInt').onchange = upd;
    upd();
  }

  // ------------------------------------------------------------------ fichiers
  function loadScore(score, path) {
    P.player.stop(); stopAnim();
    S.score = score; S.filePath = path;
    S.sel = null; S.range = null; S.cursor = { s: 0, t: 0 }; S.undo = []; S.redo = []; S.muted.clear(); S.playFrom = 0;
    S.lastDn = null; S.pendingSlur = null;
    setDirty(false);
    buildTracksMenu();
    loadBank();
    renderAll();
    scroller.scrollTop = 0;
    scheduleAutosave();
  }
  function confirmDiscard() {
    return !S.dirty || confirm('La partition actuelle a des modifications non enregistrées. Continuer quand même ?');
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // Ouvre n'importe quel format pris en charge (.partoch, MusicXML, .mxl, MIDI)
  async function openBytes(name, bytes, path) {
    if (P.audioImport.isAudio(name)) return importAudio(name, bytes);
    if (isScanImage(name)) {
      if (!path) return alert('Pour lire une partition scannée (image ou PDF), utilisez l’application Partoch.');
      return omrImport([path], name.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''));
    }
    try {
      const res = await P.io.importBytes(name, bytes);
      const short = name.split(/[\\/]/).pop();
      if (res.native) {
        loadScore(res.score, path || null);
        toast('Ouvert : ' + short);
      } else {
        loadScore(res.score, null);
        setDirty(true);
        if (res.warnings.length) {
          openModal(`<h2>Importé : ${esc(short)}</h2><div class="body">
            <ul style="margin:0;padding-left:20px;line-height:1.6">${res.warnings.map((w) => '<li>' + esc(w) + '</li>').join('')}</ul>
</div>
            <div class="foot"><button class="primary" data-ok>OK</button></div>`, () => {});
        } else toast('Importé : ' + short);
      }
    } catch (e) {
      console.error(e);
      alert('Impossible d’ouvrir ce fichier : ' + e.message);
    }
  }
  async function cmdOpen() {
    if (!confirmDiscard()) return;
    if (api) {
      const res = await api.openFile();
      if (!res) return;
      return openBytes(res.path, b64ToBytes(res.base64), res.path);
    }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.partoch,.json,.musicxml,.mxl,.xml,.mid,.midi,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm,.mp4';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      openBytes(f.name, new Uint8Array(await f.arrayBuffer()), null);
    };
    inp.click();
  }
  // glisser-déposer un fichier sur la fenêtre
  document.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !confirmDiscard()) return;
    const path = api && api.pathForFile ? api.pathForFile(f) : null;
    openBytes(f.name, new Uint8Array(await f.arrayBuffer()), path);
  });

  // ------------------------------------------------------------------ exports
  function baseName() { return (S.score.title || 'partition').replace(/[\\/:*?"<>|]+/g, '_'); }
  function download(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function exportXml() {
    const xml = P.io.exportMusicXML(S.score);
    if (!api) return download(baseName() + '.musicxml', xml, 'application/vnd.recordare.musicxml+xml');
    const p = await api.exportFile({ suggested: baseName() + '.musicxml', filterName: 'MusicXML', ext: 'musicxml', data: xml, encoding: 'utf8' });
    if (p) toast('Exporté : ' + p.split(/[\\/]/).pop());
  }
  async function exportMidi() {
    const bytes = P.io.exportMIDI(S.score);
    if (!api) return download(baseName() + '.mid', bytes, 'audio/midi');
    const p = await api.exportFile({ suggested: baseName() + '.mid', filterName: 'MIDI', ext: 'mid', data: bytesToB64(bytes), encoding: 'base64' });
    if (p) toast('Exporté : ' + p.split(/[\\/]/).pop());
  }
  // Mise en page A4 : les systèmes ne sont jamais coupés entre deux pages
  // list : [{ score, name }] pour des parties séparées ; sinon la partition entière
  function buildPrintArea(list) {
    const area = $('#printArea');
    area.innerHTML = '';
    const land = !!(S.score.layout && S.score.layout.landscape);
    let st = document.getElementById('pageStyle');
    if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
    st.textContent = `@media print { @page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 12mm; } }`;
    let total = 0;
    for (const part of list || [{ score: S.score }]) total += addPrintPages(area, part.score, part.name, land, !!list);
    return total;
  }
  function addPrintPages(area, score, partName, land, mmRest) {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute;left:-100000px;top:0;';
    document.body.appendChild(tmp);
    let L;
    try { L = R.render(score, tmp, { zoom: 1, print: true, mmRest }); } finally { R.render.printMode = false; }
    const svg = tmp.querySelector('svg');
    const W = L.width, u = W / 1000;
    // A4 avec 12 mm de marge : 186 × 273 mm (portrait) ; on garde de la place pour le numéro de page
    const PAGE_H = W * (land ? 186 / 273 : 273 / 186) - 38 * u;
    const perLine = 52 * (land ? 1.47 : 1);
    const TITLE_H = (120 + 42 * Math.max(0, Math.ceil((score.title || '').length / perLine) - 1) + (partName ? 26 : 0)) * u; // titre long : sur plusieurs lignes
    const pages = [];
    let cur = null;
    L.systems.forEach((sys, i) => {
      const top = Math.min(sys.ctop, sys.top + 20) - 4, bot = sys.cbot + 4;
      const avail = PAGE_H - (pages.length === 0 ? TITLE_H : 0); // la 1re page porte le titre
      const forced = i > 0 && L.systems[i - 1].brk === 'page';
      if (!cur) cur = { y0: top, y1: bot };
      else if (forced || bot - cur.y0 > avail) { pages.push(cur); cur = { y0: top, y1: bot }; }
      else cur.y1 = bot;
    });
    if (cur) pages.push(cur);
    pages.forEach((pg, i) => {
      const div = document.createElement('div');
      div.className = 'page';
      if (i === 0) {
        div.innerHTML = (partName ? `<div class="ppart">${esc(partName)}</div>` : '') + `<div class="ptitle">${esc(score.title)}</div>` + (score.composer ? `<div class="pcomposer">${esc(score.composer)}</div>` : '');
      }
      const c = svg.cloneNode(true);
      c.setAttribute('viewBox', `0 ${pg.y0} ${W} ${pg.y1 - pg.y0}`);
      c.removeAttribute('width'); c.removeAttribute('height');
      c.style.width = '100%'; c.style.height = 'auto';
      div.appendChild(c);
      if (pages.length > 1) {
        const n = document.createElement('div');
        n.className = 'pnum';
        n.textContent = (i + 1) + ' / ' + pages.length;
        div.appendChild(n);
      }
      area.appendChild(div);
    });
    tmp.remove();
    return pages.length;
  }
  window.PartochDebug.buildPrintArea = buildPrintArea;
  window.PartochDebug.loadScore = (sc) => loadScore(sc, null);
  async function exportPdf() {
    const n = buildPrintArea();
    try {
      if (!api) { window.print(); return; }
      const p = await api.exportPDF(baseName() + '.pdf');
      if (p) {
        toast('PDF exporté (' + n + ' page' + (n > 1 ? 's' : '') + ') : ' + p.split(/[\\/]/).pop(), 3500);
        api.openPath(p);
      }
    } finally { $('#printArea').innerHTML = ''; }
  }
  async function printScore() {
    buildPrintArea();
    try {
      if (api) await api.print();
      else window.print();
    } finally { $('#printArea').innerHTML = ''; }
  }
  async function cmdSave(saveAs) {
    const content = JSON.stringify(S.score, null, 1);
    try {
      if (api) {
        const p = await api.saveFile(saveAs ? null : S.filePath, content, (S.score.title || 'partition') + '.partoch');
        if (!p) return false;
        S.filePath = p;
        setDirty(false);
        scheduleAutosave();
        toast('Enregistré : ' + p.split(/[\\/]/).pop());
        return true;
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        a.download = (S.score.title || 'partition') + '.partoch';
        a.click();
        setDirty(false);
      }
    } catch (e) { alert('Échec de l’enregistrement : ' + e.message); }
  }
  function loadBank() {
    const bank = S.score.soundBank || 'musyngkite';
    const li = $('#loadInfo');
    const go = () => {
      li.textContent = 'Chargement des sons…';
      P.audio.load(bank).then((ok) => { li.textContent = ok ? '' : 'Sons indisponibles'; });
    };
    if (window.PARTOCH_SAMPLES && window.PARTOCH_SAMPLES[bank]) return go();
    const sc = document.createElement('script');
    sc.src = '../assets/sounds/' + bank + '-recorder.js';
    sc.onload = go;
    sc.onerror = () => { li.textContent = 'Sons introuvables'; };
    document.body.appendChild(sc);
  }

  // ---- accordeur ----
  const NOTE_FR = ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'Si♭', 'Si'];
  const tuner = { raf: 0, hist: [] };
  async function openTuner() {
    const menu = $('#tunerMenu');
    try { $('#tnRef').value = localStorage.getItem('partoch-tunerRef') || '440'; } catch (e) { /* */ }
    if (!P.mic.supported()) return toast('Le micro n’est pas disponible ici');
    try { await P.mic.open(null); } catch (e) { return toast('Micro inaccessible'); }
    menu.hidden = false;
    $('#tunerBtn').classList.add('on');
    tuner.hist = [];
    const tick = () => {
      const r = P.mic.pitchNow();
      const note = $('#tnNote'), cents = $('#tnCents'), needle = $('#tnNeedle');
      if (!r) { tuner.hist = []; needle.style.opacity = '0'; return; }
      const ref = +$('#tnRef').value || 440;
      const m = 69 + 12 * Math.log2(r.f0 / ref);
      tuner.hist.push(m);
      if (tuner.hist.length > 5) tuner.hist.shift();
      const sm = tuner.hist.slice().sort((a, b) => a - b)[tuner.hist.length >> 1];
      const n = Math.round(sm), c = Math.round((sm - n) * 100);
      note.textContent = NOTE_FR[((n % 12) + 12) % 12];
      cents.textContent = (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c) + ' c';
      needle.style.opacity = '1';
      needle.style.left = (50 + c) + '%';
      needle.classList.toggle('ok', Math.abs(c) <= 5);
    };
    tuner.raf = setInterval(tick, 60);
  }
  function closeTuner() {
    if (!tuner.raf) { $('#tunerMenu').hidden = true; return; }
    clearInterval(tuner.raf);
    tuner.raf = 0;
    $('#tunerMenu').hidden = true;
    $('#tunerBtn').classList.remove('on');
    $('#tnNote').textContent = '–'; $('#tnCents').textContent = '';
    if (!S.rec) P.mic.close();
  }

  // ---- paroles, accords, basse chiffrée : saisie note par note ----
  const ANN_KIND = { lyrics: 'lyric', chords: 'chord', figures: 'figure' };
  // attaques d'une portée (les notes liées à la précédente ne comptent pas)
  function partOnsets(ps) {
    const set = new Set();
    for (const l of M.lanesOf(S.score, ps)) {
      const ns = S.score.staves[l].notes;
      ns.forEach((n, i) => { const pv = ns[i - 1]; if (!(pv && pv.tie && M.noteEnd(pv) === n.start)) set.add(n.start); });
    }
    return [...set].sort((a, b) => a - b);
  }
  function annCommand(list) {
    const pts = anchorPoints();
    if (!pts.length) return toast('Aucune note sélectionnée');
    const { s, t } = pts[0];
    const n = notesOfPart(s, t, Infinity)[0];
    if (!n) return toast('Aucune note sélectionnée');
    if (S.mode === 'input') setMode('select');
    if (S.textTool) { S.textTool = false; updateUI(); }
    annEdit(list, s, n.start, 0);
  }
  function annEdit(list, ps, t, verse) {
    const prev = wrap.querySelector('input.annEdit');
    if (prev && prev._finish) prev._finish(true, () => {});
    const lane = M.lanesOf(S.score, ps).find((l) => M.noteAt(S.score, l, t));
    S.sel = { s: lane != null ? lane : ps, t, pi: 0 };
    S.range = null;
    renderAll();
    scrollToTick(t);
    const pos = S.layout.annAt && S.layout.annAt(ps, t, ANN_KIND[list], verse);
    const svg = scoreEl.querySelector('svg');
    if (!pos || !svg) return;
    const r = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const k = r.width / S.layout.width;
    const isLyr = list === 'lyrics';
    const cur = (S.score.staves[ps][list] || []).find((x) => x.t === t && (!isLyr || x.v === verse));
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'annEdit ' + list;
    inp.spellcheck = false;
    inp.value = cur ? cur.text + (cur.hyph ? '-' : '') : '';
    const fs = 15 * k;
    inp.style.fontSize = fs + 'px';
    inp.style.top = (r.top - wr.top + pos.y * k - fs * 1.15) + 'px';
    const fit = () => {
      inp.style.width = Math.max(3, inp.value.length + 2) + 'ch';
      const w = inp.offsetWidth;
      inp.style.left = (r.left - wr.left + pos.x * k - (list === 'chords' ? 6 * k : w / 2)) + 'px';
    };
    wrap.appendChild(inp);
    fit();
    inp.addEventListener('input', fit);
    inp.focus();
    inp.select();
    let done = false;
    const commit = (text) => {
      let v = text.trim(), hyph = false;
      if (isLyr && /-$/.test(v)) { hyph = true; v = v.replace(/-+$/, '').trim(); }
      if (cur ? v === cur.text && !!cur.hyph === hyph : !v) return;
      change(() => {
        const st = M.staffLists(S.score.staves[ps]);
        st[list] = st[list].filter((x) => !(x.t === t && (!isLyr || x.v === verse)));
        if (v) { const o = { t, text: v }; if (isLyr) { o.v = verse; o.hyph = hyph; } st[list].push(o); st[list].sort((a, b) => a.t - b.t); }
      }, { noRender: true });
    };
    const finish = (ok, then) => {
      if (done) return;
      done = true;
      const val = inp.value;
      inp.remove();
      if (ok) commit(val);
      if (then) then(); else renderAll();
    };
    inp._finish = finish;
    const go = (dir, v2) => finish(true, () => {
      const on = partOnsets(ps);
      const nt = dir > 0 ? on.find((x) => x > t) : dir < 0 ? on.slice().reverse().find((x) => x < t) : t;
      if (nt == null) { renderAll(); return; }
      annEdit(list, ps, nt, v2 != null ? v2 : verse);
    });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === ' ' || e.key === 'Tab') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      else if (isLyr && e.key === '-' && inp.selectionStart === inp.value.length && inp.value.trim()) { e.preventDefault(); inp.value = inp.value.replace(/-+$/, '') + '-'; go(1); }
      else if (isLyr && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const nv = clamp(verse + (e.key === 'ArrowDown' ? 1 : -1), 0, 4);
        if (nv !== verse) go(0, nv);
      }
      else if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
  }

  // ---- outils d'édition ----
  // durées ×2 ou ÷2 d'un extrait copié ; false si une durée sort des valeurs possibles
  function scaleClip(clip, f) {
    const sc = (x) => Math.round(x * f);
    for (const part of clip.parts) {
      for (const n of part.notes) {
        const i = M.DUR_LIST.indexOf(n.dur);
        n.start = sc(n.start); n.len = sc(n.len);
        if (n.dur && i >= 0) {
          const j = i + (f > 1 ? -1 : 1);
          if (j < 0 || j >= M.DUR_LIST.length) return false;
          n.dur = M.DUR_LIST[j];
        } else {
          const h = M.hintForTicks(n.len);
          if (h) { n.dur = h.dur; n.dots = h.dots; }
        }
        if (n.len < 30) return false;
      }
      part.tuplets = (part.tuplets || []).map((sp) => ({ ...sp, start: sc(sp.start), len: sc(sp.len) }));
      for (const k of M.SPAN_LISTS) part[k] = (part[k] || []).map((sl) => ({ ...sl, start: sc(sl.start), end: sc(sl.end) }));
      for (const k of M.TICK_LISTS) part[k] = (part[k] || []).map((x) => ({ ...x, t: sc(x.t) }));
    }
    clip.len = sc(clip.len);
    return true;
  }
  function durScale(f) {
    if (!S.range) {
      const n = selNote();
      if (!n) return toast('Aucune note sélectionnée');
      const len = Math.round(n.len * f), i = M.DUR_LIST.indexOf(n.dur), j = i + (f > 1 ? -1 : 1);
      const h = n.dur && i >= 0 ? (M.DUR_LIST[j] ? { dur: M.DUR_LIST[j], dots: n.dots || 0 } : null) : M.hintForTicks(len);
      if (!h) return toast('Impossible');
      change(() => M.changeDuration(S.score, S.sel.s, S.sel.t, len, h));
      return;
    }
    const r = S.range;
    const clip = JSON.parse(JSON.stringify(M.copyRange(S.score, r.s0, r.s1, r.a, r.b)));
    if (!scaleClip(clip, f)) return toast('Impossible');
    change(() => { M.deleteRange(S.score, r.s0, r.s1, r.a, r.b); M.paste(S.score, r.s0, r.a, clip); }, { noRender: true });
    S.range = { ...r, b: r.a + clip.len };
    renderAll();
  }
  function repeatSelDialog() {
    let r = S.range;
    const n = selNote();
    if (!r && n) { const ps = M.parentIndex(S.score, S.sel.s); r = { s0: ps, s1: ps, a: S.sel.t, b: S.sel.t + n.len }; }
    if (!r) return toast('Aucune sélection');
    openModal(`<h2>Répéter la sélection</h2><div class="body">
      <div class="row"><label>Nombre de fois</label><input type="number" id="rpN" min="1" max="64" value="1" style="width:80px"></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>OK</button></div>`, (md) => {
      const k = clamp(Math.round(+md.querySelector('#rpN').value || 1), 1, 64);
      const clip = M.copyRange(S.score, r.s0, r.s1, r.a, r.b);
      change(() => { for (let i = 1; i <= k; i++) M.paste(S.score, r.s0, r.a + i * clip.len, clip); }, { noRender: true });
      S.range = { s0: r.s0, s1: r.s1, a: r.a + clip.len, b: r.a + (k + 1) * clip.len };
      S.sel = null;
      renderAll();
      scrollToTick(S.range.b - 1);
    });
  }
  function goToDialog() {
    const tab = M.measureTable(S.score);
    openModal(`<h2>Aller à la mesure</h2><div class="body">
      <div class="row"><label>Mesure</label><input type="number" id="gtN" min="1" style="width:80px"></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>OK</button></div>`, (md) => {
      const want = Math.round(+md.querySelector('#gtN').value);
      if (!want) return;
      let mi = tab.findIndex((_, i) => +M.measureNumber(S.score, i) === want);
      if (mi < 0) mi = want > +M.measureNumber(S.score, tab.length - 1) ? tab.length - 1 : 0;
      if (S.mode === 'input') setMode('select');
      const vis = M.visualStaves(S.score);
      S.range = { s0: vis[0], s1: vis[vis.length - 1], a: tab[mi].start, b: tab[mi].start + tab[mi].len };
      S.sel = null;
      renderAll();
      scrollToTick(tab[mi].start);
    });
  }

  // ---- mise en page ----
  function layoutDialog() {
    const lay = S.score.layout || { mpl: 0, scale: 1, landscape: false };
    const md = openModal(`<h2>Mise en page</h2><div class="body">
      <div class="row"><label>Format</label><select id="lyOr"><option value="p">A4 portrait</option><option value="l" ${lay.landscape ? 'selected' : ''}>A4 paysage</option></select></div>
      <div class="row"><label>Taille des notes</label><div class="inline"><input type="range" id="lySc" min="60" max="160" step="5" value="${Math.round((lay.scale || 1) * 100)}"><span id="lyScV" style="width:48px;text-align:right">${Math.round((lay.scale || 1) * 100)} %</span></div></div>
      <div class="row"><label>Mesures par ligne</label><select id="lyMpl"><option value="0">Auto</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<option ${n === lay.mpl ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div><div class="foot"><button data-cancel>Annuler</button><button class="primary" data-ok>Appliquer</button></div>`, (m) => {
      const nl = { mpl: +m.querySelector('#lyMpl').value || 0, scale: +m.querySelector('#lySc').value / 100, landscape: m.querySelector('#lyOr').value === 'l' };
      change(() => { S.score.layout = nl; });
    });
    md.querySelector('#lySc').addEventListener('input', (e) => { md.querySelector('#lyScV').textContent = e.target.value + ' %'; });
  }

  // ---- parties séparées : une partie par instrument (piano : ses deux portées), silences multi-mesures ----
  function partList() {
    const sc = S.score, out = [], seen = new Set();
    const keyOf = (o) => { const par = o.voiceOf ? sc.staves.find((x) => x.id === o.voiceOf) || o : o; return par.group || par.id; };
    sc.staves.forEach((st) => {
      if (st.voiceOf) return;
      const key = keyOf(st);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ idx: sc.staves.map((o, k) => (keyOf(o) === key ? k : -1)).filter((k) => k >= 0), name: M.INSTRUMENTS[st.inst].name });
    });
    // deux parties du même instrument : numérotées
    const count = {};
    out.forEach((p) => { count[p.name] = (count[p.name] || 0) + 1; });
    const num = {};
    out.forEach((p) => { if (count[p.name] > 1) { num[p.name] = (num[p.name] || 0) + 1; p.name += ' ' + num[p.name]; } });
    return out;
  }
  function partScore(idx) {
    const sc = JSON.parse(JSON.stringify(S.score));
    const keep = new Set(idx), ids = new Set(idx.map((i) => sc.staves[i].id));
    sc.staves = sc.staves.filter((_, i) => keep.has(i));
    sc.texts = (sc.texts || []).filter((x) => ids.has(x.sid));
    return sc;
  }
  async function exportParts() {
    const parts = partList();
    if (parts.length < 2) return exportPdf();
    const list = parts.map((p) => ({ score: partScore(p.idx), name: p.name }));
    if (!api || !api.chooseDir) {
      buildPrintArea(list);
      try { window.print(); } finally { $('#printArea').innerHTML = ''; }
      return;
    }
    const dir = await api.chooseDir();
    if (!dir) return;
    let n = 0;
    try {
      for (const p of list) {
        buildPrintArea([p]);
        if (await api.exportPDFTo(dir, baseName() + ' - ' + p.name + '.pdf')) n++;
      }
    } finally { $('#printArea').innerHTML = ''; }
    if (n) { toast(n + ' parties exportées', 3000); api.openPath(dir); }
  }

  // ------------------------------------------------------------------ événements de l'interface
  const commands = {
    new: () => { if (confirmDiscard()) scoreDialog(true); },
    open: cmdOpen,
    save: (e) => cmdSave(e && e.shiftKey),
    saveAs: () => cmdSave(true),
    undo, redo,
    play: togglePlay,
    rewind: () => { const was = P.player.playing; if (was) { P.player.stop(); stopAnim(); } S.playFrom = 0; S.sel = null; S.range = null; renderAll(); scroller.scrollTop = 0; if (was) togglePlay(); },
    dot: toggleDot, rest: restCommand, tie: toggleTie,
    slur: () => slurCommand('slur'), phrase: () => slurCommand('phrase'), breath: breathCommand, trill: () => ornCommand('tr'), text: textCommand,
    lyrics: () => annCommand('lyrics'), chordSym: () => annCommand('chords'), figures: () => annCommand('figures'),
    cut: () => copySel(true), copy: () => copySel(false), paste: pasteClip, selectAll,
    durDouble: () => durScale(2), durHalve: () => durScale(0.5), repeatSel: repeatSelDialog, goTo: goToDialog,
    layout: layoutDialog, exportParts: () => exportParts(),
    addMeasure, delMeasure, timeSig: () => { $('#sigMenu').hidden = true; timeSigDialog(S.sigM); }, tuplet: tupletCommand, grace: graceCommand, chord: chordCommand, record: recordDialog, scan: scanDialog,
    transpose: transposeDialog,
    props: () => scoreDialog(false),
    zoomIn: () => setZoom(S.zoom * 1.1), zoomOut: () => setZoom(S.zoom / 1.1),
    exportXml, exportMidi, exportPdf, print: printScore,
    prefs: () => prefsDialog(),
  };
  document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', (e) => { b.blur(); commands[b.dataset.cmd](e); }));
  document.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => { b.blur(); setDuration(b.dataset.dur); }));
  document.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => { b.blur(); applyAccidental(+b.dataset.acc); }));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { b.blur(); setMode(b.dataset.mode); }));
  document.querySelectorAll('[data-voice]').forEach((b) => b.addEventListener('click', () => { b.blur(); setVoice(+b.dataset.voice); }));
  document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    b.blur();
    const k = b.dataset.toggle;
    S[k] = !S[k];
    try { localStorage.setItem('partoch-' + k, S[k] ? '1' : '0'); } catch (e) { /* */ }
    updateUI();
    restartIfPlaying();
  }));
  const closePMenus = () => document.querySelectorAll('.pmenu').forEach((m) => { m.hidden = true; });
  $('#tracksBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#tracksMenu'); m.hidden = !m.hidden; $('#exportMenu').hidden = true; closePMenus(); });
  $('#exportBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#exportMenu'); m.hidden = !m.hidden; $('#tracksMenu').hidden = true; closePMenus(); });
  $('#tunerBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#tunerBtn').blur(); if (tuner.raf) closeTuner(); else openTuner(); });
  $('#tnRef').addEventListener('change', (e) => { try { localStorage.setItem('partoch-tunerRef', e.target.value); } catch (er) { /* */ } tuner.hist = []; });
  // menus déroulants de la palette (nuances, articulations…) et Édition
  document.querySelectorAll('.pdd').forEach((dd) => {
    const btn = dd.querySelector('[data-pmenu]'), menu = dd.querySelector('.menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); btn.blur();
      const was = menu.hidden;
      document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !was;
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('button')) menu.hidden = true; });
  });
  document.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => {
    b.blur();
    const [kind, a, c] = b.dataset.do.split(':');
    if (kind === 'dyn') dynCommand(a);
    else if (kind === 'hairpin') hairpinCommand(a);
    else if (kind === 'art') artCommand(a);
    else if (kind === 'orn') ornCommand(a);
    else if (kind === 'tempo') tempoCommand(a);
    else if (kind === 'mark') markCommand(a, c);
  }));
  $('#exportMenu').addEventListener('click', () => { $('#exportMenu').hidden = true; });
  $('#recStop').addEventListener('click', () => stopRecording());
  $('#sigBtn').addEventListener('click', (e) => { e.stopPropagation(); if ($('#sigMenu').hidden) openSigMenu(); else $('#sigMenu').hidden = true; });
  $('#sigMenu').querySelectorAll('[data-sig]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); applySig(b.dataset.sig); }));
  document.addEventListener('click', (e) => {
    if (!$('#tracksDD').contains(e.target)) $('#tracksMenu').hidden = true;
    if (!$('#exportDD').contains(e.target)) $('#exportMenu').hidden = true;
    if (!$('#sigDD').contains(e.target) && !S.sigClick) $('#sigMenu').hidden = true;
    document.querySelectorAll('.pdd').forEach((dd) => { if (!dd.contains(e.target)) dd.querySelector('.menu').hidden = true; });
    if (tuner.raf && !$('#tunerDD').contains(e.target)) closeTuner();
    S.sigClick = false;
  });
  $('#rangeWarn').addEventListener('click', () => {
    // va à la première note hors tessiture
    for (let s = 0; s < S.score.staves.length; s++) for (const n of S.score.staves[s].notes) {
      const pi = n.pitches.findIndex((p) => M.outOfRange(S.score, s, p));
      if (pi >= 0) { S.mode = 'select'; S.sel = { s, t: n.start, pi }; S.range = null; renderAll(); scrollToTick(n.start); return; }
    }
  });
  $('#tempo').addEventListener('change', (e) => {
    const v = clamp(+e.target.value || 90, 20, 300);
    change(() => { S.score.tempo = v; });
    restartIfPlaying();
  });
  $('#speed').addEventListener('input', (e) => {
    S.speed = +e.target.value / 100;
    $('#speedVal').textContent = e.target.value + ' %';
  });
  $('#speed').addEventListener('change', () => restartIfPlaying());
  const editText = (el, key) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } e.stopPropagation(); });
    el.addEventListener('blur', () => {
      const v = el.textContent.trim() || (key === 'title' ? 'Sans titre' : '');
      if (v !== S.score[key]) change(() => { S.score[key] = v; });
      el.textContent = S.score[key];
    });
  };
  editText($('#title'), 'title');
  editText($('#composer'), 'composer');

  // ---- raccourcis clavier (modifiables dans Paramètres) ----
  const K = P.keys;
  const toggleOpt = (k) => {
    S[k] = !S[k];
    try { localStorage.setItem('partoch-' + k, S[k] ? '1' : '0'); } catch (e) { /* */ }
    updateUI();
    restartIfPlaying();
  };
  const keyActions = {
    play: togglePlay, rewind: () => commands.rewind(), record: quickRecord,
    loop: () => toggleOpt('loop'), metronome: () => toggleOpt('metronome'), countIn: () => toggleOpt('countIn'),
    mode: () => setMode(S.mode === 'input' ? 'select' : 'input'),
    dur_w: () => setDuration('w'), dur_h: () => setDuration('h'), dur_q: () => setDuration('q'),
    dur_8: () => setDuration('8'), dur_16: () => setDuration('16'), dur_32: () => setDuration('32'),
    dot: toggleDot, rest: () => { if (S.mode === 'input') placeRestAtCursor(); else restCommand(); },
    tuplet: tupletCommand, grace: graceCommand, chord: chordCommand,
    voice1: () => setVoice(1), voice2: () => setVoice(2),
    sharp: () => applyAccidental(1), flat: () => applyAccidental(-1), natural: () => applyAccidental(0),
    tie: toggleTie, slur: () => slurCommand('slur'), phrase: () => slurCommand('phrase'), breath: breathCommand, trill: () => ornCommand('tr'), text: textCommand,
    staccato: () => artCommand('stacc'), tenuto: () => artCommand('ten'), accent: () => artCommand('acc'), marcato: () => artCommand('marc'), fermata: () => artCommand('fermata'),
    cresc: () => hairpinCommand('cresc'), dim: () => hairpinCommand('dim'),
    lyrics: () => annCommand('lyrics'), chordSym: () => annCommand('chords'), figures: () => annCommand('figures'), tempoMark: () => tempoCommand('tempo'),
    durDouble: () => durScale(2), durHalve: () => durScale(0.5), repeatSel: repeatSelDialog, goTo: goToDialog,
    layout: layoutDialog, exportParts: () => exportParts(),
    addMeasure, delMeasure,
    semiUp: () => shiftPitch('semi', 1), semiDown: () => shiftPitch('semi', -1),
    stepUp: () => shiftPitch('step', 1), stepDown: () => shiftPitch('step', -1),
    octUp: () => shiftPitch('oct', 1), octDown: () => shiftPitch('oct', -1),
    prev: () => moveSel(-1), next: () => moveSel(1), staffUp: () => moveStaff(-1), staffDown: () => moveStaff(1),
    undo, redo, copy: () => copySel(false), cut: () => copySel(true), paste: pasteClip, selectAll, transpose: transposeDialog,
    new: () => commands.new(), open: cmdOpen, save: () => cmdSave(false), saveAs: () => cmdSave(true), exportPdf, print: printScore,
    zoomIn: () => setZoom(S.zoom * 1.1), zoomOut: () => setZoom(S.zoom / 1.1), zoomReset: () => setZoom(1),
  };
  // infobulles « Nom (raccourci) » et raccourcis affichés dans les menus
  function applyShortcuts() {
    document.querySelectorAll('[data-tip]').forEach((el) => {
      const sc = el.dataset.key ? K.shortcut(el.dataset.key) : '';
      el.title = el.dataset.tip + (sc ? ' (' + sc + ')' : '');
    });
    document.querySelectorAll('[data-kbd]').forEach((el) => { el.textContent = K.shortcut(el.dataset.kbd); });
  }
  applyShortcuts();

  document.addEventListener('keydown', (e) => {
    if (!$('#modalBack').hidden) return;
    const combo = K.comboOf(e);
    if (S.rec) {
      // pendant l'enregistrement, seules ces touches comptent
      if (e.key === 'Escape' || (combo && (K.keysOf('play').includes(combo) || K.keysOf('record').includes(combo)))) { e.preventDefault(); stopRecording(); }
      return;
    }
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    const k = e.key;
    const act = combo && K.find(combo);
    let handled = true;
    if (act && keyActions[act]) keyActions[act]();
    else if (k === 'Escape') {
      if (P.player.playing) { P.player.stop(); stopAnim(); }
      else if (S.textTool) { S.textTool = false; updateUI(); }
      else if (S.selText) { S.selText = null; renderAll(); }
      else if (S.pendingSlur) { S.pendingSlur = null; updateUI(); }
      else if (S.mode === 'input') setMode('select');
      else { S.sel = null; S.range = null; renderAll(); }
    }
    else if ((k === 'Delete' || k === 'Backspace') && S.selText) deleteText(S.selText);
    else if ((k === 'Enter' || k === 'F2') && S.selText && textObj(S.selText)) editScoreText(textObj(S.selText), false);
    else if (k === 'Delete' || k === 'Backspace') deleteSelection();
    else if (S.mode === 'input' && !e.ctrlKey && !e.metaKey && !e.altKey && /^[a-gA-G]$/.test(k)) letterInput(k.toUpperCase());
    else handled = false;
    if (handled) e.preventDefault();
  });

  if (api) {
    api.onCommand((cmd) => { if (cmd === 'save-before-quit') cmdSave(false).then((ok) => { if (ok) api.quitNow(); }); });
    api.onOpenPath && api.onOpenPath(async (res) => { if (confirmDiscard()) openBytes(res.path, b64ToBytes(res.base64), res.path); });
  }

  // ------------------------------------------------------------------ démarrage
  function boot() {
    try {
      // premier lancement : la feuille occupe environ 70 % de la largeur de la fenêtre
      const stored = +localStorage.getItem('partoch-zoom');
      S.autoZoom = !stored;
      S.zoom = stored || autoZoomValue();
      for (const k of ['metronome', 'countIn', 'loop']) S[k] = localStorage.getItem('partoch-' + k) === '1';
    } catch (e) { /* */ }
    let restored = null;
    try {
      const raw = localStorage.getItem('partoch-autosave');
      if (raw) { const o = JSON.parse(raw); restored = { score: M.normalizeScore(o.score), filePath: o.filePath || null, dirty: !!o.dirty }; }
    } catch (e) { restored = null; }
    if (restored) {
      loadScore(restored.score, restored.filePath);
      if (restored.dirty) setDirty(true);
    } else {
      loadScore(M.newScore({ title: 'Sans titre', instruments: ['soprano'], measures: 16 }), null);
    }
    window.addEventListener('resize', () => {
      if (S.autoZoom) {
        const z = autoZoomValue();
        if (z !== S.zoom) { S.zoom = z; renderAll(); return; }
      }
      drawOverlay();
    });
  }
  function autoZoomValue() {
    return clamp(Math.round(((scroller.clientWidth * 0.7) / R.PAPER_W) * 10) / 10, 1, 2);
  }
  boot();
})();
