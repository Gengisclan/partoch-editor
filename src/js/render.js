// Partoch editor — gravure de la partition avec VexFlow + carte des positions (clics)
(function () {
  const P = (window.P = window.P || {});
  const M = P.model;
  const VF = Vex.Flow;

  const PAPER_W = 1000;
  const MARGIN_L = 30, MARGIN_R = 30;
  const STAFF_DIST = 100; // ligne du haut → ligne du haut, entre portées d'un système
  const GRAND_DIST = 90; // entre les deux portées d'un piano
  const SYS_GAP = 80; // espace sous un système
  const TOP_PAD = 70;
  const SPACING = 10;
  // pages A4 à l'écran (210 × 297 mm) : hauteur en unités de la partition, écart entre deux feuilles
  const PAGE_H = Math.round(PAPER_W * 297 / 210), PAGE_GAP = 36, PAGE_MT = 70, PAGE_MB = 80;

  const COLORS = {
    out: '#d62828',
    sel: '#1f6feb',
  };

  function evWidth(ev, fifths) {
    const base = { w: 44, h: 36, q: 30, '8': 26, '16': 23, '32': 21 }[ev.dur] || 28;
    let w = base + (ev.dots || 0) * 7 + (ev.graces ? ev.graces.length * 13 + 6 : 0);
    if (!ev.rest) {
      let acc = 0;
      for (const p of ev.pitches) if (p.alt !== M.keyAlter(p.step, fifths)) acc++;
      w += Math.min(acc, 3) * 10;
    }
    return w;
  }

  function accType(alt) { return { '-2': 'bb', '-1': 'b', '0': 'n', '1': '#', '2': '##' }[alt]; }

  function staffLabel(score, s, full) {
    const st = score.staves[s];
    const def = M.INSTRUMENTS[st.inst];
    return full ? def.name : def.short;
  }

  function render(score, host, opts) {
    opts = opts || {};
    render.printMode = !!opts.print;
    host.innerHTML = '';
    const fifths = score.fifths;
    const nSt = score.staves.length;
    const tab = M.measureTable(score);
    const nM = tab.length;
    // portées visibles, chacune avec ses voix (la voix 1 est la portée elle-même)
    const vis = M.visualStaves(score).map((ps) => ({ ps, lanes: M.lanesOf(score, ps) }));
    const nV = vis.length;
    const visOf = new Map();
    vis.forEach((v, vi) => v.lanes.forEach((s) => visOf.set(s, vi)));
    const parents = vis.map((v) => score.staves[v.ps]);
    const sm = score.staves.map((_, s) => M.staffMeasures(score, s, tab));
    const timeW = 30;
    // format : portrait 1000 × 1414, paysage 1414 × 1000 (unités d'affichage) ; « taille des notes » = échelle
    const lay = score.layout || {};
    const scale = lay.scale || 1;
    const DW = lay.landscape ? PAGE_H : PAPER_W;
    const W = Math.round(DW / scale);
    const PH = Math.round((lay.landscape ? PAPER_W : PAGE_H) / scale);
    const GAP = PAGE_GAP / scale;
    const mk = (m) => M.markOf(score, m) || {};

    // ---- largeur minimale de chaque mesure ----
    const widths = [];
    for (let m = 0; m < nM; m++) {
      let w = 0;
      for (const v of vis) {
        let ws = 0, active = 0;
        for (const s of v.lanes) {
          const meas = sm[s][m];
          if (meas.full) { if (s === v.ps) ws = Math.max(ws, 56); continue; }
          active++;
          ws = Math.max(ws, meas.events.reduce((acc, ev) => acc + evWidth(ev, fifths), 0));
        }
        w = Math.max(w, active > 1 ? ws * 1.2 : ws);
      }
      widths.push(w + 24 + (tab[m].showSig && m > 0 ? timeW : 0) + (mk(m).rs ? 14 : 0) + (mk(m).re ? 8 : 0));
    }

    // ---- silences multi-mesures (parties séparées) : mesures vides consécutives regroupées ----
    const mmr = new Map(); // première mesure → nombre de mesures
    if (opts.mmRest) {
      const tempoIn = (mi) => (score.tempos || []).some((x) => x.t >= tab[mi].start && x.t < tab[mi].start + tab[mi].len);
      const empty = (mi, first) => vis.every((v) => v.lanes.every((s) => sm[s][mi].full)) && !Object.keys(mk(mi)).length
        && !tab[mi].pickup && !tempoIn(mi) && (first || !tab[mi].showSig);
      for (let mi = 0; mi < nM;) {
        let n = 0;
        while (mi + n < nM && empty(mi + n, n === 0)) n++;
        if (n >= 2) { mmr.set(mi, n); widths[mi] = 130 + (tab[mi].showSig && mi > 0 ? timeW : 0); mi += n; } else mi++;
      }
    }

    // ---- place réservée aux annotations de chaque portée ----
    const ann = vis.map((v) => {
      const st = score.staves[v.ps];
      return {
        dyn: (st.dyns || []).length + (st.hairpins || []).length > 0,
        verses: (st.lyrics || []).reduce((acc, x) => Math.max(acc, x.v + 1), 0),
        fig: (st.figures || []).length > 0,
        chd: (st.chords || []).length > 0,
      };
    });
    const below = ann.map((a) => (a.dyn ? 36 : 0) + a.verses * 22 + (a.fig ? 46 : 0));
    const above = ann.map((a) => (a.chd ? 24 : 0));
    const hasTop = (score.tempos || []).length > 0 || Object.values(score.marks || {}).some((k) => k.volta || k.jump || k.segno || k.coda || k.toCoda || k.fine);
    const topX = (hasTop ? 30 : 0) + above[0];

    // ---- positions verticales des portées dans un système ----
    const offs = [0];
    for (let vi = 1; vi < nV; vi++) {
      const sameGroup = parents[vi].group && parents[vi].group === parents[vi - 1].group;
      offs.push(offs[vi - 1] + (sameGroup ? GRAND_DIST : STAFF_DIST) + below[vi - 1] + above[vi]);
    }
    const sysH = offs[nV - 1] + 4 * SPACING + below[nV - 1];

    const firstIndent = 95;
    const laterIndent = nV > 1 ? 45 : 10;
    const keyW = Math.abs(fifths) * 10 + (fifths ? 8 : 0);
    const clefW = 36;

    // ---- répartition des mesures en systèmes ----
    const systems = [];
    let m = 0;
    while (m < nM) {
      const first = systems.length === 0;
      const indent = first ? firstIndent : laterIndent;
      const header = clefW + keyW + (first ? timeW : 0) + 14;
      const avail = W - MARGIN_L - MARGIN_R - indent;
      let used = header;
      const ms = [];
      let brk = null;
      while (m < nM) {
        if (ms.length && (lay.mpl ? ms.length >= lay.mpl : used + widths[m] > avail)) break;
        ms.push(m); used += widths[m]; m += mmr.get(m) || 1;
        if (mk(m - 1).brk) { brk = mk(m - 1).brk; break; }
      }
      const content = used - header;
      let factor = (avail - header) / content;
      const isLast = m >= nM;
      if (isLast && used / avail < 0.7 && !lay.mpl) factor = Math.min(factor, 1.25);
      systems.push({ ms, indent, header, factor, first, brk });
    }

    // ---- hauteur totale (et répartition sur des feuilles A4 : un système n'est jamais coupé) ----
    const paged = !!opts.pages && !opts.print;
    const off = paged ? (opts.pageOffset || 0) * scale : 0; // hauteur du titre, au-dessus de la partition sur la 1re feuille
    const pageTop = (k) => k * (PH + GAP) - off;
    let y = TOP_PAD + topX, page = 0;
    const pages = [];
    systems.forEach((sys, i) => {
      if (paged) {
        const prev = systems[i - 1];
        if (prev && prev.brk === 'page') { page++; y = pageTop(page) + PAGE_MT + 45 + topX; }
        if (y - 45 - topX < pageTop(page) + PAGE_MT && page > 0) y = pageTop(page) + PAGE_MT + 45 + topX;
        if (y + sysH + 45 > pageTop(page) + PH - PAGE_MB && i > 0) { page++; y = pageTop(page) + PAGE_MT + 45 + topX; }
      }
      sys.page = page;
      sys.lineY = offs.map((o) => y + o);
      sys.top = y - 45 - topX;
      sys.bottom = y + sysH + 45;
      y += sysH + SYS_GAP + topX;
    });
    let height = y - SYS_GAP - topX + 70;
    if (paged) {
      for (let k = 0; k <= page; k++) pages.push({ y0: pageTop(k), y1: pageTop(k) + PH });
      height = pageTop(page) + PH;
    }

    const renderer = new VF.Renderer(host, VF.Renderer.Backends.SVG);
    renderer.resize(W, height);
    const ctx = renderer.getContext();
    const svg = host.querySelector('svg');
    const zoom = opts.zoom || 1;
    const unit = DW / W; // unités d'affichage par unité de partition
    svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
    svg.setAttribute('width', W * unit * zoom);
    svg.setAttribute('height', height * unit * zoom);
    svg.style.width = W * unit * zoom + 'px';
    svg.style.height = height * unit * zoom + 'px';

    const layout = { width: W, height, unit, systems: [], noteEls: new Map(), tab, pages, pageH: PH, pageGap: GAP };
    const seq = score.staves.map(() => []); // événements dessinés, dans l'ordre, par portée / voix
    const sel = opts.selection || null;

    // voltas et indications de saut : au-dessus de la portée du haut
    const RT = VF.Repetition.type;
    const JUMP_TYPE = { dc: RT.DC, dcFine: RT.DC_AL_FINE, dcCoda: RT.DC_AL_CODA, ds: RT.DS, dsFine: RT.DS_AL_FINE, dsCoda: RT.DS_AL_CODA };
    function decorateTop(stave, mi, k, sys) {
      const mm = mk(mi);
      if (mm.volta) {
        const same = (o) => o && o.volta && o.volta.join() === mm.volta.join();
        const prevSame = same(mk(mi - 1)), nextSame = same(mk(mi + 1));
        const closed = !nextSame && mm.re;
        const VT = VF.Volta.type;
        let type;
        if (!prevSame) type = closed ? VT.BEGIN_END : VT.BEGIN;
        else type = closed ? VT.END : VT.MID;
        if (prevSame && k === 0 && !closed) type = VT.MID;
        stave.setVoltaType(type, mm.volta.join(', ') + '.', -8);
      }
      if (mm.segno) stave.setRepetitionType(RT.SEGNO_LEFT, 18);
      if (mm.coda) stave.setRepetitionType(RT.CODA_LEFT, 18);
      if (mm.jump) stave.setRepetitionType(JUMP_TYPE[mm.jump], -12);
      else if (mm.toCoda) stave.setRepetitionType(RT.TO_CODA, -12);
      else if (mm.fine) stave.setRepetitionType(RT.FINE, -12);
    }

    systems.forEach((sys, si) => {
      const x0 = MARGIN_L + sys.indent;
      const L = { top: sys.top, bottom: sys.bottom, x0, x1: W - MARGIN_R, staves: [], vstaves: [], measures: [], page: sys.page, brk: sys.brk };
      for (let s = 0; s < nSt; s++) {
        const vi = visOf.has(s) ? visOf.get(s) : 0;
        L.staves.push({ s, lineY: sys.lineY[vi], spacing: SPACING, clef: parents[vi].clef });
      }
      vis.forEach((v, vi) => L.vstaves.push({ s: v.ps, lineY: sys.lineY[vi], spacing: SPACING, clef: parents[vi].clef }));

      // noms des portées
      ctx.save();
      ctx.setFont('Segoe UI', sys.first ? 13 : 11, '');
      ctx.setFillStyle('#222');
      const doneGroups = new Set();
      vis.forEach((v, vi) => {
        const st = parents[vi];
        if (!sys.first && nV === 1) return;
        let yy = sys.lineY[vi] + 2 * SPACING + 4;
        if (st.group) {
          if (doneGroups.has(st.group)) return;
          doneGroups.add(st.group);
          const v2 = parents.findIndex((o, k) => k > vi && o.group === st.group);
          if (v2 > 0) yy = (sys.lineY[vi] + sys.lineY[v2] + 4 * SPACING) / 2 + 4;
        }
        const label = staffLabel(score, v.ps, sys.first);
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, x0 - (st.group ? 22 : 10) - tw, yy);
      });
      ctx.restore();

      let x = x0;
      sys.ms.forEach((mi, k) => {
        const ms = tab[mi];
        const gN = mmr.get(mi) || 1, lastM = mi + gN - 1;
        const tsStr = ms.sig[0] + '/' + ms.sig[1];
        const w = (k === 0 ? sys.header : 0) + widths[mi] * sys.factor;
        const staves = parents.map((st, vi) => {
          const def = M.INSTRUMENTS[st.inst];
          const stave = new VF.Stave(x, sys.lineY[vi] - 4 * SPACING, w);
          if (k === 0) {
            // VexFlow ne sait pas placer le « 8 » au-dessus d'une clé de fa : on le dessine nous-mêmes
            const ownAnn = st.clef === 'bass' && def.clefAnn === '8va';
            stave.addClef(st.clef, 'default', ownAnn ? undefined : def.clefAnn);
            if (ownAnn) stave.ownOctave = true;
            if (fifths) stave.addKeySignature(M.KEYS[fifths][0]);
          }
          if (ms.showSig) stave.addTimeSignature(tsStr);
          const mm = mk(mi);
          if (mm.rs) stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
          if (mm.re) stave.setEndBarType(VF.Barline.type.REPEAT_END);
          else if (lastM === nM - 1) stave.setEndBarType(VF.Barline.type.END);
          else if (mm.fine || mm.jump) stave.setEndBarType(VF.Barline.type.DOUBLE);
          if (vi === 0) decorateTop(stave, mi, k, sys);
          if (vi === 0 && k === 0 && mi > 0) stave.setMeasure(M.measureNumber(score, mi));
          return stave;
        });
        const startX = Math.max(...staves.map((st) => st.getNoteStartX()));
        staves.forEach((st, vi) => {
          st.setNoteStartX(startX); st.setContext(ctx).draw();
          if (st.ownOctave) {
            ctx.save();
            ctx.setFont('Georgia', 13, 'italic');
            ctx.setFillStyle('#000');
            ctx.fillText('8', x + 14, sys.lineY[vi] - 5);
            ctx.restore();
          }
        });
        const noteEndX = staves[0].getNoteEndX();

        // liaisons verticales (accolades / barres)
        drawConnectors(parents, ctx, staves, k === 0, lastM === nM - 1);
        if (gN > 1) {
          staves.forEach((st) => { try { new VF.MultiMeasureRest(gN, { number_of_measures: gN }).setStave(st).setContext(ctx).draw(); } catch (e) { /* ignore */ } });
          const ML0 = { m: mi, x, w, noteStartX: startX, noteEndX, start: ms.start, len: tab[lastM].start + tab[lastM].len - ms.start, staffEvents: score.staves.map(() => []), mmr: gN };
          L.measures.push(ML0);
          x += w;
          return;
        }

        const beamGroups = VF.Beam.getDefaultBeamGroups(tsStr);
        const allVoices = [], staveVoices = [], allBeams = [], tuplets = [];
        const perLane = new Map();
        vis.forEach((v, vi) => {
          const clef = parents[vi].clef;
          // deux voix ou plus dans la mesure : hampes vers le haut (voix 1, 3) ou vers le bas (voix 2, 4)
          const multi = v.lanes.some((s) => M.voiceNum(score, s) > 1 && !sm[s][mi].full);
          const vlist = [];
          // notes de chaque voix, pour écarter les silences des autres voix
          const laneNotes = new Map();
          if (multi) for (const s of v.lanes) laneNotes.set(s, sm[s][mi].full ? [] : sm[s][mi].events.filter((e) => !e.rest));
          for (const s of v.lanes) {
            const vn = M.voiceNum(score, s);
            const meas = sm[s][mi];
            if (vn > 1 && meas.full) { perLane.set(s, { hidden: true }); continue; }
            const dir = multi ? (vn % 2 === 1 ? 1 : -1) : 0;
            const accState = {};
            const items = [];
            const others = [];
            laneNotes.forEach((l, o) => { if (o !== s) others.push(...l); });
            if (meas.full) {
              const n = new VF.StaveNote({ clef, keys: [restKey(clef, 'w', dir, others, meas.start, meas.len)], duration: 'wr', align_center: true });
              items.push({ ev: { rest: true, start: meas.start, len: meas.len, full: true }, n });
            } else {
              for (const ev of meas.events) items.push({ ev, n: makeNote(score, s, ev, clef, fifths, accState, sel, dir, others) });
            }
            const notes = items.map((it) => it.n);
            notes.forEach((n) => n.setStave(staves[vi]));
            // n-olets : créés avant d'ajouter les notes à la voix (ils changent leur durée)
            const groups = new Map();
            items.forEach((it) => {
              const g = it.ev.tuplet;
              if (!g) return;
              if (!groups.has(g.start)) groups.set(g.start, { g, notes: [] });
              groups.get(g.start).notes.push(it.n);
            });
            for (const { g, notes: tn } of groups.values()) {
              try {
                tuplets.push(new VF.Tuplet(tn, { num_notes: g.num, notes_occupied: g.den, ratioed: false, location: dir === -1 ? -1 : 1 }));
              } catch (e) { /* ignore */ }
            }
            const voice = new VF.Voice({ num_beats: ms.sig[0], beat_value: ms.sig[1] }).setMode(VF.Voice.Mode.SOFT);
            voice.addTickables(notes);
            vlist.push(voice);
            allVoices.push({ voice, vi });
            if (!meas.full) {
              try { allBeams.push(...VF.Beam.generateBeams(notes, dir ? { groups: beamGroups, stem_direction: dir } : { groups: beamGroups })); } catch (e) { /* pas de ligature */ }
            }
            perLane.set(s, { items });
          }
          staveVoices.push(vlist);
        });
        const fmt = new VF.Formatter();
        staveVoices.forEach((vl) => { if (vl.length) fmt.joinVoices(vl); });
        fmt.format(allVoices.map((v) => v.voice), Math.max(20, noteEndX - startX - 12));
        allVoices.forEach(({ voice, vi }) => voice.draw(ctx, staves[vi]));
        allBeams.forEach((b) => b.setContext(ctx).draw());
        tuplets.forEach((t) => { try { t.setContext(ctx).draw(); } catch (e) { /* ignore */ } });

        // carte des positions
        const ML = { m: mi, x, w, noteStartX: startX, noteEndX, start: ms.start, len: ms.len, staffEvents: [] };
        for (let s = 0; s < nSt; s++) {
          const pl = perLane.get(s);
          if (!pl) { ML.staffEvents.push([]); continue; }
          if (pl.hidden) {
            // voix vide : silence invisible, mais on peut y écrire
            const ev = { rest: true, full: true, start: ms.start, len: ms.len };
            ML.staffEvents.push([{ start: ms.start, len: ms.len, x: (startX + noteEndX) / 2, rest: true, ev, hidden: true }]);
            continue;
          }
          ML.staffEvents.push(pl.items.map((it) => {
            const ex = it.ev.full ? (startX + noteEndX) / 2 : (it.n.getNoteHeadBeginX() + it.n.getNoteHeadEndX()) / 2;
            const rec = { start: it.ev.start, len: it.ev.len, x: ex, rest: !!it.ev.rest, src: it.ev.src, ev: it.ev, n: it.n };
            if (!it.ev.rest) {
              const key = s + ':' + it.ev.src;
              if (!layout.noteEls.has(key)) layout.noteEls.set(key, []);
              layout.noteEls.get(key).push(it.n);
              seq[s].push({ ev: it.ev, n: it.n, sys: si, m: mi, mEnd: x + w });
            } else {
              seq[s].push({ ev: it.ev, n: it.n, sys: si, rest: true });
            }
            return rec;
          }));
        }
        L.measures.push(ML);
        x += w;
      });
      // limites réelles du contenu (notes très aiguës ou graves, lignes supplémentaires)
      L.ctop = sys.lineY[0] - 40;
      L.cbot = sys.lineY[nV - 1] + 4 * SPACING + 40;
      for (const ML of L.measures) for (const evs of ML.staffEvents) for (const e of evs) {
        if (!e.n) continue;
        try {
          const bb = e.n.getBoundingBox();
          if (bb) { L.ctop = Math.min(L.ctop, bb.getY() - 6); L.cbot = Math.max(L.cbot, bb.getY() + bb.getH() + 6); }
        } catch (err) { /* pas de boîte */ }
      }
      layout.systems.push(L);
    });

    // ---- liaisons de prolongation ----
    seq.forEach((list) => {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.rest || !a.ev.tie) continue;
        const b = list[i + 1];
        if (!b || b.rest || b.ev.start !== a.ev.start + a.ev.len) continue;
        const fi = [], li = [];
        a.ev.pitches.forEach((p, pi) => {
          const j = b.ev.pitches.findIndex((q) => M.midiOf(q) === M.midiOf(p));
          if (j >= 0) { fi.push(pi); li.push(j); }
        });
        if (!fi.length) continue;
        try {
          if (a.sys === b.sys) {
            new VF.StaveTie({ first_note: a.n, last_note: b.n, first_indices: fi, last_indices: li }).setContext(ctx).draw();
          } else {
            new VF.StaveTie({ first_note: a.n, last_note: null, first_indices: fi, last_indices: fi }).setContext(ctx).draw();
            new VF.StaveTie({ first_note: null, last_note: b.n, first_indices: li, last_indices: li }).setContext(ctx).draw();
          }
        } catch (e) { /* ignore */ }
      }
    });

    // ---- liaisons d'expression / de phrasé, puis respirations ----
    score.staves.forEach((st, s) => {
      const list = seq[s];
      for (const sl of st.slurs || []) {
        const items = list.filter((it) => !it.rest && it.ev.src >= sl.start && it.ev.src <= sl.end);
        if (items.length < 2) continue;
        try { drawSlur(ctx, layout, s, items, sl.kind); } catch (e) { /* ignore */ }
      }
      list.forEach((it, i) => {
        if (it.rest || !it.ev.breath) return;
        const sysL = layout.systems[it.sys];
        const next = list[i + 1];
        let bx = Math.min(it.n.getNoteHeadEndX() + 12, it.mEnd - 7); // reste avant la barre de mesure
        if (next && next.sys === it.sys && next.m === it.m) bx = (it.n.getNoteHeadEndX() + next.n.getNoteHeadBeginX()) / 2 + 2;
        const ly = sysL.staves[s].lineY;
        ctx.save();
        ctx.setFont('Georgia', 34, 'bold');
        ctx.setFillStyle('#000');
        ctx.fillText(',', bx - 4, ly - 12);
        ctx.restore();
      });
    });

    drawAnnotations(ctx, score, layout, seq, vis, visOf, ann);

    // ---- notes textuelles libres ----
    layout.texts = [];
    const NS = 'http://www.w3.org/2000/svg';
    for (const tx of score.texts || []) {
      const s = score.staves.findIndex((st) => st.id === tx.sid);
      if (s < 0) continue;
      const pos = tickToPos(layout, tx.t);
      if (!pos) continue;
      const x = pos.x + tx.dx, y = pos.sys.staves[s].lineY + tx.dy;
      const el = document.createElementNS(NS, 'text');
      el.setAttribute('class', 'ptext');
      el.setAttribute('data-text-id', tx.id);
      el.setAttribute('x', x); el.setAttribute('y', y);
      el.setAttribute('font-family', 'Georgia, serif');
      el.setAttribute('font-size', '15');
      const isSel = !render.printMode && opts.selText === tx.id;
      el.setAttribute('fill', isSel ? COLORS.sel : '#111');
      String(tx.text).split('\n').forEach((line, i) => {
        const ts = document.createElementNS(NS, 'tspan');
        ts.setAttribute('x', x);
        if (i) ts.setAttribute('dy', '18');
        ts.textContent = line || ' ';
        el.appendChild(ts);
      });
      svg.appendChild(el);
      let bb = null;
      try { bb = el.getBBox(); } catch (e) { /* hors document */ }
      if (!bb || !bb.width) bb = { x, y: y - 13, width: 8 * String(tx.text).length, height: 18 };
      if (isSel) {
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', bb.x - 3); r.setAttribute('y', bb.y - 2); r.setAttribute('width', bb.width + 6); r.setAttribute('height', bb.height + 4);
        r.setAttribute('fill', 'none'); r.setAttribute('stroke', COLORS.sel); r.setAttribute('stroke-dasharray', '3 2'); r.setAttribute('rx', 3);
        svg.insertBefore(r, el);
      }
      pos.sys.ctop = Math.min(pos.sys.ctop, bb.y - 4);
      pos.sys.cbot = Math.max(pos.sys.cbot, bb.y + bb.height + 4);
      layout.texts.push({ id: tx.id, x: bb.x, y: bb.y, w: bb.width, h: bb.height, sys: pos.sys });
    }

    return layout;
  }

  // ---- annotations : nuances, soufflets, paroles, accords, basse chiffrée, indications de tempo ----
  const prettyAcc = (t) => String(t).replace(/([A-G])b/g, '$1♭').replace(/#/g, '♯');
  function drawAnnotations(ctx, score, layout, seq, vis, visOf, ann) {
    const headX = (n) => (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2;
    // étendue verticale des notes, par système et par portée
    const ext = new Map();
    seq.forEach((list, s) => {
      const vi = visOf.get(s);
      for (const it of list) {
        if (it.rest || !it.n) continue;
        let b;
        try { b = it.n.getBoundingBox(); } catch (e) { continue; }
        if (!b) continue;
        const key = it.sys + ':' + vi;
        const o = ext.get(key) || { hi: Infinity, lo: -Infinity };
        o.hi = Math.min(o.hi, b.getY()); o.lo = Math.max(o.lo, b.getY() + b.getH());
        ext.set(key, o);
      }
    });
    const sysIndex = (sys) => layout.systems.indexOf(sys);
    const lowOf = (sys, vi) => { const L = sys.vstaves[vi]; const o = ext.get(sysIndex(sys) + ':' + vi); return Math.max(L.lineY + 4 * SPACING + 26, o ? o.lo + 20 : -Infinity); };
    const highOf = (sys, vi) => { const L = sys.vstaves[vi]; const o = ext.get(sysIndex(sys) + ':' + vi); return Math.min(L.lineY - 30, o ? o.hi - 22 : Infinity); };
    // position d'une note (tête) de la portée ps à l'instant t
    const anchor = (ps, t) => {
      for (const s of M.lanesOf(score, ps)) {
        const it = seq[s].find((x) => !x.rest && x.ev.start === t && !x.ev.tiedFromSelf);
        if (it) return { x: headX(it.n), sys: layout.systems[it.sys], n: it.n };
      }
      const p = tickToPos(layout, t);
      return p ? { x: p.x, sys: p.sys } : null;
    };
    const text = (str, x, y, font, size, weight, style, align) => {
      ctx.save();
      ctx.setFont(font, size, weight || '', style || '');
      ctx.setFillStyle('#000');
      const w = ctx.measureText(str).width;
      ctx.fillText(str, align === 'left' ? x : x - w / 2, y);
      ctx.restore();
      return w;
    };
    vis.forEach((v, vi) => {
      const st = score.staves[v.ps];
      const a = ann[vi];
      const dynY = (sys) => lowOf(sys, vi) + 4;
      const lyrY = (sys, verse) => lowOf(sys, vi) + (a.dyn ? 34 : 6) + verse * 22;
      const figY = (sys) => lowOf(sys, vi) + (a.dyn ? 34 : 6) + a.verses * 22;
      // nuances
      for (const d of st.dyns || []) {
        const p = anchor(v.ps, d.t);
        if (!p) continue;
        text(d.v, p.x, dynY(p.sys) + 6, 'Times New Roman', 20, 'bold', 'italic');
      }
      // soufflets
      for (const hp of st.hairpins || []) {
        const p0 = anchor(v.ps, hp.start), p1 = anchor(v.ps, hp.end);
        if (!p0 || !p1) continue;
        // une nuance sur la note de départ ou d'arrivée : le soufflet commence après / s'arrête avant
        const dynW = (t) => {
          const d = (st.dyns || []).find((x) => x.t === t);
          if (!d) return 0;
          ctx.save(); ctx.setFont('Times New Roman', 20, 'bold', 'italic');
          const w = ctx.measureText(d.v).width; ctx.restore();
          return w;
        };
        const w0 = dynW(hp.start), w1 = dynW(hp.end);
        const xStart = w0 ? p0.x + w0 / 2 + 6 : p0.x - 4;
        const x1end = w1 ? p1.x - w1 / 2 - 6 : p1.n ? p1.n.getNoteHeadEndX() + 10 : p1.x + 14;
        const pieces = p0.sys === p1.sys ? [[p0.sys, xStart, x1end, true, true]]
          : [[p0.sys, xStart, p0.sys.x1 - 4, true, false], [p1.sys, p1.sys.measures[0].noteStartX - 6, x1end, false, true]];
        for (const [sys, xa, xb, isStart, isEnd] of pieces) {
          if (xb - xa < 8) continue;
          const y = dynY(sys) - 1, hw = 6;
          const open = hp.kind === 'cresc';
          const w0 = open ? (isStart ? 0 : hw * 0.5) : (isStart ? hw : hw * 0.5);
          const w1 = open ? (isEnd ? hw : hw * 0.5) : (isEnd ? 0 : hw * 0.5);
          ctx.save();
          ctx.setStrokeStyle('#000'); ctx.setLineWidth(1.3);
          ctx.beginPath(); ctx.moveTo(xa, y - w0); ctx.lineTo(xb, y - w1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(xa, y + w0); ctx.lineTo(xb, y + w1); ctx.stroke();
          ctx.restore();
        }
      }
      // paroles
      const lyr = (st.lyrics || []).slice().sort((x, y) => x.v - y.v || x.t - y.t);
      lyr.forEach((ly, i) => {
        const p = anchor(v.ps, ly.t);
        if (!p) return;
        const y = lyrY(p.sys, ly.v);
        const w = text(ly.text, p.x, y, 'Georgia', 15, '', '');
        if (ly.hyph) {
          const nx = lyr[i + 1] && lyr[i + 1].v === ly.v ? lyr[i + 1] : null;
          const pn = nx && anchor(v.ps, nx.t);
          let hx = p.x + w / 2 + 10;
          if (pn && pn.sys === p.sys) hx = (p.x + w / 2 + pn.x - ctx.measureText(nx.text).width / 2) / 2;
          text('-', hx, y, 'Georgia', 15, '', '');
        }
      });
      // basse chiffrée : chiffres empilés (séparés par « / » ou des espaces)
      for (const f of st.figures || []) {
        const p = anchor(v.ps, f.t);
        if (!p) continue;
        String(f.text).split(/[\/\s]+/).filter(Boolean).forEach((line, k) => text(prettyAcc(line.replace(/^b/, '♭').replace(/^n/, '♮')), p.x, figY(p.sys) + 4 + k * 15, 'Georgia', 14, 'bold', ''));
      }
      // accords (au-dessus)
      for (const c of st.chords || []) {
        const p = anchor(v.ps, c.t);
        if (!p) continue;
        text(prettyAcc(c.text), p.x - 4, highOf(p.sys, vi) - 4, 'Segoe UI', 15, 'bold', '', 'left');
      }
    });
    layout.annAt = (ps, t, kind, verse) => {
      const vi = vis.findIndex((v) => v.ps === ps);
      if (vi < 0) return null;
      const p = anchor(ps, t);
      if (!p) return null;
      const a = ann[vi];
      if (kind === 'lyric') return { x: p.x, y: lowOf(p.sys, vi) + (a.dyn ? 34 : 6) + (verse || 0) * 22 };
      if (kind === 'figure') return { x: p.x, y: lowOf(p.sys, vi) + (a.dyn ? 34 : 6) + a.verses * 22 + 4 };
      return { x: p.x, y: highOf(p.sys, vi) - 4 };
    };
    // indications de tempo : au-dessus de la portée du haut
    for (const tm of score.tempos || []) {
      const p = anchor(vis[0].ps, tm.t);
      if (!p) continue;
      const y = highOf(p.sys, 0) - 8 - (ann[0].chd ? 22 : 0);
      if (tm.kind === 'tempo') {
        text('♩', p.x - 6, y, 'Segoe UI Symbol', 17, '', '', 'left');
        text('= ' + tm.bpm, p.x + 6, y, 'Georgia', 14, 'bold', '', 'left');
      } else text(tm.kind === 'rit' ? 'rit.' : tm.kind === 'accel' ? 'accel.' : 'a tempo', p.x - 4, y, 'Georgia', 15, 'bold', 'italic', 'left');
    }
  }

  // Courbe de liaison dessinée à la main : contrôle total de la position et des coupures de ligne
  function drawSlur(ctx, layout, s, items, kind) {
    const headC = (n) => (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2;
    const bbox = (n) => { const b = n.getBoundingBox(); return { top: b.getY(), bot: b.getY() + b.getH() }; };
    const headTop = (n) => Math.min(...n.getYs()) - 5;
    const headBot = (n) => Math.max(...n.getYs()) + 5;
    const stemDir = (n) => { try { return n.hasStem() ? n.getStemDirection() : 0; } catch (e) { return 0; } };
    // placement : phrasé toujours au-dessus ; liaison à l'opposé des hampes
    let above = true;
    if (kind === 'slur') {
      const up = items.filter((it) => stemDir(it.n) === 1).length;
      above = up < items.length / 2;
    }
    const sign = above ? -1 : 1;
    const extra = kind === 'phrase' ? 10 : 0;
    const endY = (n) => {
      const d = stemDir(n);
      if (above) return (d === 1 || kind === 'phrase' ? bbox(n).top : headTop(n)) - 4 - extra;
      return (d === -1 ? bbox(n).bot : headBot(n)) + 4;
    };
    // découpe par système
    const groups = [];
    for (const it of items) {
      const g = groups[groups.length - 1];
      if (g && g.sys === it.sys) g.items.push(it); else groups.push({ sys: it.sys, items: [it] });
    }
    groups.forEach((g, gi) => {
      const L = layout.systems[g.sys];
      const first = g.items[0].n, last = g.items[g.items.length - 1].n;
      const openStart = gi > 0, openEnd = gi < groups.length - 1;
      const xs = openStart ? L.measures[0].noteStartX - 14 : headC(first) + 1;
      const xe = openEnd ? L.x1 - 4 : headC(last) - 1;
      if (xe - xs < 6) return;
      let ys = endY(first);
      let ye = endY(last);
      if (openStart) ys = ye; if (openEnd) ye = ys;
      // les notes intermédiaires ne doivent pas toucher la courbe
      let need = above ? Math.min(ys, ye) : Math.max(ys, ye);
      for (const it of g.items) {
        const b = bbox(it.n);
        need = above ? Math.min(need, b.top - 6 - extra) : Math.max(need, b.bot + 6);
      }
      const span = xe - xs;
      const arch = Math.min(kind === 'phrase' ? 26 : 20, Math.max(kind === 'phrase' ? 10 : 7, span * 0.08));
      const base = (ys + ye) / 2;
      const peak = above ? Math.min(need, base - arch) : Math.max(need, base + arch);
      const ctrl = base + (peak - base) / 0.75;
      const thick = kind === 'phrase' ? 2.2 : 2.6;
      const c1x = xs + span * 0.22, c2x = xe - span * 0.22;
      ctx.save();
      ctx.setFillStyle('#000');
      ctx.setStrokeStyle('#000');
      ctx.setLineWidth(0.6);
      ctx.beginPath();
      ctx.moveTo(xs, ys);
      ctx.bezierCurveTo(c1x, ctrl, c2x, ctrl, xe, ye);
      ctx.bezierCurveTo(c2x, ctrl + sign * thick, c1x, ctrl + sign * thick, xs, ys);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  // hauteur des silences : décalés vers le haut (voix 1) ou le bas (voix 2) quand deux voix se partagent la portée
  // et écartés des notes de l'autre voix qui sonnent en même temps (comme MuseScore)
  const REST_EXT = { w: [1, 0], h: [0, 1], q: [3, 3], 8: [2, 2], 16: [3, 3], 32: [4, 3] }; // [vers le bas, vers le haut] en degrés
  function restKey(clef, dur, dir, others, start, len) {
    const whole = dur === 'w';
    let key;
    if (dir === 1) key = clef === 'bass' ? (whole ? 'a/3' : 'g/3') : whole ? 'f/5' : 'e/5';
    else if (dir === -1) key = clef === 'bass' ? (whole ? 'b/2' : 'a/2') : whole ? 'g/4' : 'f/4';
    else return whole ? (clef === 'bass' ? 'f/3' : 'd/5') : clef === 'bass' ? 'd/3' : 'b/4';
    if (!others || !others.length) return key;
    let lim = null;
    for (const n of others) {
      if (!(n.start < start + len && n.start + n.len > start)) continue;
      for (const p of n.pitches) { const d = p.oct * 7 + p.step; lim = lim === null ? d : dir === 1 ? Math.max(lim, d) : Math.min(lim, d); }
    }
    if (lim === null) return key;
    const [l, o] = key.split('/');
    let k = +o * 7 + M.STEP_EN.indexOf(l.toUpperCase());
    const ext = REST_EXT[dur] || [3, 3];
    const lineRest = dur === 'w' || dur === 'h'; // ces silences s'accrochent à une ligne (degrés pairs)
    if (dir === 1) { const min = lim + 2 + ext[0]; if (k < min) { k = min; if (lineRest && k % 2) k++; } }
    else { const max = lim - 2 - ext[1]; if (k > max) { k = max; if (lineRest && k % 2) k--; } }
    return M.STEP_EN[((k % 7) + 7) % 7].toLowerCase() + '/' + Math.floor(k / 7);
  }
  const ORN_CODE = { tr: 'tr', mord: 'mordent_inverted', prall: 'mordent', turn: 'turn' };
  const ART_CODE = { stacc: 'a.', staccmo: 'av', ten: 'a-', acc: 'a>', marc: 'a^' };
  function vfKey(p) { return M.STEP_EN[p.step].toLowerCase() + '/' + p.oct; }

  function makeNote(score, s, ev, clef, fifths, accState, sel, dir, others) {
    if (ev.rest) {
      const n = new VF.StaveNote({ clef, keys: [restKey(clef, ev.dur, dir, others, ev.start, ev.len)], duration: ev.dur + 'r', dots: ev.dots });
      if (ev.dots) VF.Dot.buildAndAttach([n], { all: true });
      return n;
    }
    const o = { clef, keys: ev.pitches.map(vfKey), duration: ev.dur, dots: ev.dots };
    if (dir) o.stem_direction = dir; else o.auto_stem = true;
    const n = new VF.StaveNote(o);
    // petites notes (appoggiatures, acciaccatures)
    if (ev.graces && !ev.tiedFromSelf) {
      try {
        const gns = ev.graces.map((g) => {
          const gn = new VF.GraceNote({ clef, keys: g.pitches.map(vfKey), duration: g.dur || '8', slash: !!g.slash });
          g.pitches.forEach((p, i) => {
            const k = p.step + '_' + p.oct;
            const cur = k in accState ? accState[k] : M.keyAlter(p.step, fifths);
            if (p.alt !== cur) gn.addModifier(new VF.Accidental(accType(p.alt)), i);
            accState[k] = p.alt;
          });
          return gn;
        });
        const grp = new VF.GraceNoteGroup(gns, false);
        if (gns.length > 1) grp.beamNotes();
        n.addModifier(grp, 0);
      } catch (e) { /* ignore */ }
    }
    ev.pitches.forEach((p, i) => {
      const k = p.step + '_' + p.oct;
      const cur = k in accState ? accState[k] : M.keyAlter(p.step, fifths);
      if (!ev.tiedFromSelf && p.alt !== cur) n.addModifier(new VF.Accidental(accType(p.alt)), i);
      accState[k] = p.alt;
      if (!render.printMode && M.outOfRange(score, s, p)) n.setKeyStyle(i, { fillStyle: COLORS.out, strokeStyle: COLORS.out });
    });
    if (ev.orn && !ev.tiedFromSelf) { try { n.addModifier(new VF.Ornament(ORN_CODE[ev.orn] || 'tr'), 0); } catch (e) { /* ignore */ } }
    if ((ev.arts && ev.arts.length) || ev.fermata) {
      let up = true;
      try { up = n.getStemDirection() === 1; } catch (e) { /* ronde */ }
      const Pos = VF.Modifier.Position;
      for (const a of ev.arts || []) {
        const code = ART_CODE[a];
        if (!code) continue;
        try { n.addModifier(new VF.Articulation(code).setPosition(a === 'marc' ? Pos.ABOVE : up ? Pos.BELOW : Pos.ABOVE), 0); } catch (e) { /* ignore */ }
      }
      if (ev.fermata) { try { n.addModifier(new VF.Articulation('a@a').setPosition(Pos.ABOVE), 0); } catch (e) { /* ignore */ } }
    }
    if (ev.dots) VF.Dot.buildAndAttach([n], { all: true });
    if (sel && sel.s === s && sel.t === ev.src) {
      const style = { fillStyle: COLORS.sel, strokeStyle: COLORS.sel };
      if (sel.pi != null && sel.pi >= 0 && sel.pi < ev.pitches.length && ev.pitches.length > 1) n.setKeyStyle(sel.pi, style);
      else n.setStyle(style);
    }
    return n;
  }

  function drawConnectors(parents, ctx, staves, firstOfSystem, lastMeasure) {
    const nSt = staves.length;
    const conn = (a, b, type) => {
      try { new VF.StaveConnector(staves[a], staves[b]).setType(type).setContext(ctx).draw(); } catch (e) { /* ignore */ }
    };
    if (firstOfSystem && nSt > 1) conn(0, nSt - 1, 'singleLeft');
    // groupes piano : accolade + barres traversantes
    for (let s = 0; s < nSt - 1; s++) {
      const g = parents[s].group;
      if (g && parents[s + 1].group === g) {
        if (firstOfSystem) conn(s, s + 1, 'brace');
        conn(s, s + 1, lastMeasure ? 'boldDoubleRight' : 'singleRight');
      }
    }
    // crochet pour un ensemble de flûtes
    if (firstOfSystem) {
      let s = 0;
      while (s < nSt) {
        if (M.INSTRUMENTS[parents[s].inst].recorder) {
          let e = s;
          while (e + 1 < nSt && M.INSTRUMENTS[parents[e + 1].inst].recorder) e++;
          if (e > s) conn(s, e, 'bracket');
          s = e + 1;
        } else s++;
      }
    }
  }

  function measureIndex(tab, tick) {
    let lo = 0, hi = tab.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tab[mid].start <= tick) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // Position x (et système) d'un tick absolu, pour le curseur de lecture
  function tickToPos(layout, tick) {
    const mi = measureIndex(layout.tab, tick);
    for (const sys of layout.systems) {
      for (const ML of sys.measures) {
        if (ML.m !== mi) continue;
        const pts = [];
        ML.staffEvents.forEach((evs) => evs.forEach((e) => { if (!e.ev.full) pts.push([e.start, e.x]); }));
        pts.sort((a, b) => a[0] - b[0]);
        if (!pts.length || pts[0][0] > ML.start) pts.unshift([ML.start, ML.noteStartX]);
        pts.push([ML.start + ML.len, ML.noteEndX]);
        let xx = pts[0][1];
        for (let i = 0; i < pts.length - 1; i++) {
          const [t0, x0] = pts[i], [t1, x1] = pts[i + 1];
          if (tick >= t0 && tick <= t1) { xx = t1 === t0 ? x0 : x0 + ((tick - t0) / (t1 - t0)) * (x1 - x0); break; }
        }
        return { x: xx, sys };
      }
    }
    return null;
  }

  P.render = { render, tickToPos, measureIndex, PAPER_W, SPACING };
})();
