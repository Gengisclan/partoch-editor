// Partoch editor — import / export : MusicXML (.musicxml, .xml, .mxl) et MIDI (.mid)
(function () {
  const P = (window.P = window.P || {});
  const M = P.model;

  const TYPE = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th', '32': '32nd' };
  const TYPE_REV = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32' };
  const BEAMS = { '8': 1, '16': 2, '32': 3 };
  const GM_PROGRAM = { recorder: 74, piano: 0, melody: 73 }; // 0-based

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
  function programFor(inst) {
    const d = M.INSTRUMENTS[inst];
    return d.recorder ? GM_PROGRAM.recorder : inst === 'piano' ? GM_PROGRAM.piano : GM_PROGRAM.melody;
  }
  function beamGroupLen(sig) {
    const [num, den] = sig;
    if (den === 8 && num % 3 === 0) return 720;
    return den === 16 ? 240 : 480;
  }
  // Partie = portée simple ou paire de portées de piano
  // (staves = portées de la partie ; all = portées + leurs voix 2, 3, 4)
  function scoreParts(score) {
    const parts = [];
    score.staves.forEach((st, s) => {
      if (st.voiceOf) return;
      if (st.group) {
        const p = parts.find((x) => x.group === st.group);
        if (p) { p.staves.push(s); return; }
        parts.push({ group: st.group, inst: st.inst, staves: [s] });
      } else parts.push({ inst: st.inst, staves: [s] });
    });
    for (const p of parts) p.all = p.staves.flatMap((s) => M.lanesOf(score, s));
    return parts;
  }

  // ================================================================ MusicXML : export
  function beamInfo(events, measureStart, groupLen) {
    const res = events.map(() => []);
    let group = [];
    const flush = () => {
      if (group.length >= 2) {
        for (let L = 1; L <= 3; L++) {
          let i = 0;
          while (i < group.length) {
            if ((BEAMS[events[group[i]].dur] || 0) < L) { i++; continue; }
            let j = i;
            while (j + 1 < group.length && (BEAMS[events[group[j + 1]].dur] || 0) >= L) j++;
            if (j > i) {
              for (let k = i; k <= j; k++) res[group[k]].push([L, k === i ? 'begin' : k === j ? 'end' : 'continue']);
            } else if (L > 1) {
              res[group[i]].push([L, i === 0 ? 'forward hook' : 'backward hook']);
            }
            i = j + 1;
          }
        }
      }
      group = [];
    };
    let key = null;
    events.forEach((ev, i) => {
      const beamable = !ev.rest && BEAMS[ev.dur];
      const k = Math.floor((ev.start - measureStart) / groupLen);
      if (!beamable || k !== key) flush();
      key = k;
      if (beamable) group.push(i);
    });
    flush();
    return res;
  }

  // ---- signes MusicXML : correspondances ----
  const ART_XML = { stacc: 'staccato', staccmo: 'staccatissimo', ten: 'tenuto', acc: 'accent', marc: 'strong-accent' };
  const ORN_XML = { tr: 'trill-mark', mord: 'mordent', prall: 'inverted-mordent', turn: 'turn' };
  const JUMP_SOUND = { dc: 'dacapo="yes"', dcFine: 'dacapo="yes"', dcCoda: 'dacapo="yes"', ds: 'dalsegno="segno"', dsFine: 'dalsegno="segno"', dsCoda: 'dalsegno="segno"' };
  const HARM_KIND = [
    [/^(maj7|M7|Δ7?|ma7)$/, 'major-seventh'], [/^(m7b5|m7♭5|ø7?|min7b5)$/, 'half-diminished'], [/^(dim7|°7|o7)$/, 'diminished-seventh'],
    [/^(dim|°|o)$/, 'diminished'], [/^(m7|min7|-7)$/, 'minor-seventh'], [/^(m6|min6)$/, 'minor-sixth'], [/^(m9|min9)$/, 'minor-ninth'],
    [/^(maj9|M9)$/, 'major-ninth'], [/^(m|min|-)$/, 'minor'], [/^(aug|\+)$/, 'augmented'], [/^7$/, 'dominant'], [/^9$/, 'dominant-ninth'],
    [/^6$/, 'major-sixth'], [/^5$/, 'power'], [/^sus4?$/, 'suspended-fourth'], [/^sus2$/, 'suspended-second'], [/^(maj|M)?$/, 'major'],
  ];
  const HARM_TXT = { major: '', minor: 'm', 'minor-seventh': 'm7', dominant: '7', 'major-seventh': 'maj7', diminished: 'dim', 'diminished-seventh': 'dim7',
    'half-diminished': 'm7b5', augmented: 'aug', 'augmented-seventh': '+7', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9',
    'minor-ninth': 'm9', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', power: '5', 'dominant-11th': '11', 'dominant-13th': '13', 'minor-major': 'm(maj7)' };
  const accOf = (c) => (c === '#' || c === '♯' ? 1 : c === 'b' || c === '♭' ? -1 : 0);
  const accTxt = (a) => (a > 0 ? '#' : a < 0 ? 'b' : '');
  function harmonyXml(text) {
    const m = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/.exec(String(text).trim());
    if (!m) return `<harmony placement="above"><root><root-step>C</root-step></root><kind text="${esc(text)}">none</kind>%OFF%%STAFF%</harmony>`;
    const suf = m[3].trim();
    const kind = (HARM_KIND.find(([re]) => re.test(suf)) || [null, 'other'])[1];
    const ra = accOf(m[2]), ba = accOf(m[5]);
    return `<harmony placement="above"><root><root-step>${m[1]}</root-step>${ra ? `<root-alter>${ra}</root-alter>` : ''}</root>`
      + `<kind text="${esc(suf)}">${kind}</kind>`
      + (m[4] ? `<bass><bass-step>${m[4]}</bass-step>${ba ? `<bass-alter>${ba}</bass-alter>` : ''}</bass>` : '')
      + '%OFF%%STAFF%</harmony>';
  }
  const FIG_SYM = { '#': 'sharp', '♯': 'sharp', b: 'flat', '♭': 'flat', n: 'natural', '♮': 'natural', '+': 'plus', '/': 'slash', '\\': 'back-slash' };
  const FIG_TXT = { sharp: '#', flat: 'b', natural: 'n', plus: '+', slash: '/', 'back-slash': '\\', 'double-sharp': '##', 'flat-flat': 'bb', cross: '+' };
  function figuresXml(text) {
    const figs = String(text).split(/[\/\s]+/).filter(Boolean).map((f) => {
      const m = /^([#♯b♭n♮+]?)(\d*)([#♯b♭n♮+\\]?)$/.exec(f);
      if (!m) return `<figure><figure-number>${esc(f)}</figure-number></figure>`;
      return '<figure>' + (m[1] ? `<prefix>${FIG_SYM[m[1]]}</prefix>` : '') + (m[2] ? `<figure-number>${m[2]}</figure-number>` : '') + (m[3] ? `<suffix>${FIG_SYM[m[3]]}</suffix>` : '') + '</figure>';
    });
    return `<figured-bass>${figs.join('')}</figured-bass>`;
  }

  function exportMusicXML(score) {
    const tab = M.measureTable(score);
    const parts = scoreParts(score);
    const sm = score.staves.map((_, s) => M.staffMeasures(score, s, tab));
    // séquence complète par portée / voix pour les liaisons
    const flat = sm.map((ms) => ms.flatMap((m) => m.events));
    const counters = score.staves.map(() => 0);
    const ACC = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
    x += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
    x += '<score-partwise version="4.0">\n';
    x += `  <work><work-title>${esc(score.title)}</work-title></work>\n`;
    x += '  <identification>\n';
    if (score.composer) x += `    <creator type="composer">${esc(score.composer)}</creator>\n`;
    x += '    <encoding><software>Partoch editor</software></encoding>\n  </identification>\n';
    {
      const lay = score.layout || {};
      const mm = 7.0556 * (lay.scale || 1);
      const tenths = (v) => Math.round((v / mm) * 40);
      const [pw, ph] = lay.landscape ? [297, 210] : [210, 297];
      x += `  <defaults><scaling><millimeters>${mm.toFixed(4)}</millimeters><tenths>40</tenths></scaling><page-layout><page-height>${tenths(ph)}</page-height><page-width>${tenths(pw)}</page-width></page-layout></defaults>\n`;
    }
    x += '  <part-list>\n';
    parts.forEach((p, i) => {
      const d = M.INSTRUMENTS[p.inst];
      x += `    <score-part id="P${i + 1}"><part-name>${esc(d.name)}</part-name><part-abbreviation>${esc(d.short)}</part-abbreviation>`;
      x += `<score-instrument id="P${i + 1}-I1"><instrument-name>${esc(d.name)}</instrument-name></score-instrument>`;
      x += `<midi-instrument id="P${i + 1}-I1"><midi-channel>${(i % 15) + 1 + (i % 15 >= 9 ? 1 : 0)}</midi-channel><midi-program>${programFor(p.inst) + 1}</midi-program></midi-instrument></score-part>\n`;
    });
    x += '  </part-list>\n';

    // paroles : syllabe (début / milieu / fin de mot) par portée et par instant
    const lyrAt = score.staves.map((st) => {
      const map = new Map();
      const L = (st.lyrics || []).slice().sort((a, b) => a.v - b.v || a.t - b.t);
      L.forEach((ly, i) => {
        const pv = L[i - 1] && L[i - 1].v === ly.v ? L[i - 1] : null;
        const ph = !!(pv && pv.hyph);
        const syl = ly.hyph ? (ph ? 'middle' : 'begin') : (ph ? 'end' : 'single');
        if (!map.has(ly.t)) map.set(ly.t, []);
        map.get(ly.t).push({ v: ly.v, text: ly.text, syl });
      });
      return map;
    });
    const mk = (mi) => M.markOf(score, mi) || {};
    const sameVolta = (a, b) => !!(a.volta && b.volta && a.volta.join() === b.volta.join());
    const pitchXml = (pt, octUp) => `<pitch><step>${M.STEP_EN[pt.step]}</step>${pt.alt ? `<alter>${pt.alt}</alter>` : ''}<octave>${pt.oct + octUp}</octave></pitch>`;

    parts.forEach((p, pi) => {
      x += `  <part id="P${pi + 1}">\n`;
      const multi = p.staves.length > 1;
      for (let m = 0; m < tab.length; m++) {
        const ms = tab[m];
        const glen = beamGroupLen(ms.sig);
        x += `    <measure number="${M.measureNumber(score, m)}"${ms.pickup ? ' implicit="yes"' : ''}>\n`;
        const mm = mk(m), mPrev = m > 0 ? mk(m - 1) : {}, mNext = mk(m + 1);
        if (m > 0 && mPrev.brk) x += `      <print new-${mPrev.brk === 'page' ? 'page' : 'system'}="yes"/>\n`;
        if (m === 0) {
          x += `      <attributes><divisions>${M.TPQ}</divisions><key><fifths>${score.fifths}</fifths></key>`;
          x += `<time><beats>${ms.sig[0]}</beats><beat-type>${ms.sig[1]}</beat-type></time>`;
          if (multi) x += `<staves>${p.staves.length}</staves>`;
          p.staves.forEach((s, k) => {
            const st = score.staves[s], d = M.INSTRUMENTS[st.inst];
            const sign = st.clef === 'bass' ? '<sign>F</sign><line>4</line>' : '<sign>G</sign><line>2</line>';
            x += `<clef${multi ? ` number="${k + 1}"` : ''}>${sign}${d.clefAnn === '8va' ? '<clef-octave-change>1</clef-octave-change>' : ''}</clef>`;
          });
          x += '</attributes>\n';
          if (pi === 0) x += `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>\n`;
        } else if (ms.showSig) {
          x += `      <attributes><time><beats>${ms.sig[0]}</beats><beat-type>${ms.sig[1]}</beat-type></time></attributes>\n`;
        }
        const voltaStart = mm.volta && !sameVolta(mm, mPrev);
        if (mm.rs || voltaStart) {
          x += '      <barline location="left">' + (mm.rs ? '<bar-style>heavy-light</bar-style>' : '')
            + (voltaStart ? `<ending number="${mm.volta.join(', ')}" type="start">${mm.volta.join(', ')}.</ending>` : '')
            + (mm.rs ? '<repeat direction="forward"/>' : '') + '</barline>\n';
        }
        if (pi === 0) {
          if (mm.segno) x += '      <direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>\n';
          if (mm.coda) x += '      <direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>\n';
        }
        let written = false;
        p.staves.forEach((ps, k) => {
          const staffTag = multi ? `<staff>${k + 1}</staff>` : '';
          for (const s of M.lanesOf(score, ps)) {
            const st = score.staves[s];
            const vn = st.voice || 1;
            const meas = sm[s][m];
            if (vn > 1 && meas.full) continue; // voix vide : rien à écrire
            const octUp = M.INSTRUMENTS[st.inst].clefAnn === '8va' ? 1 : 0;
            const voice = k * 4 + vn;
            if (written) x += `      <backup><duration>${ms.len}</duration></backup>\n`;
            written = true;
            if (s === ps) {
              for (const tx of score.texts || []) {
                if (tx.sid !== st.id || tx.t < ms.start || tx.t >= ms.start + ms.len) continue;
                const off = tx.t - ms.start;
                x += `      <direction placement="${tx.dy > 20 ? 'below' : 'above'}"><direction-type><words>${esc(tx.text)}</words></direction-type>${off ? `<offset>${off}</offset>` : ''}${staffTag}</direction>\n`;
              }
            }
            // directions de la portée principale, placées juste avant (ou après) la note concernée
            const dirs = [];
            if (s === ps) {
              const inM = (t) => t >= ms.start && t < ms.start + ms.len;
              for (const d of st.dyns || []) if (inM(d.t)) dirs.push({ t: d.t, xml: `<direction placement="below"><direction-type><dynamics><${d.v}/></dynamics></direction-type>%OFF%%STAFF%</direction>` });
              for (const h of st.hairpins || []) {
                if (inM(h.start)) dirs.push({ t: h.start, xml: `<direction placement="below"><direction-type><wedge type="${h.kind === 'dim' ? 'diminuendo' : 'crescendo'}" number="1"/></direction-type>%OFF%%STAFF%</direction>` });
                if (inM(h.end)) dirs.push({ t: h.end, after: true, xml: '<direction placement="below"><direction-type><wedge type="stop" number="1"/></direction-type>%STAFF%</direction>' });
              }
              if (pi === 0 && k === 0) {
                for (const tm of score.tempos || []) {
                  if (!inM(tm.t)) continue;
                  const body = tm.kind === 'tempo' ? `<metronome><beat-unit>quarter</beat-unit><per-minute>${tm.bpm}</per-minute></metronome>`
                    : `<words font-style="italic">${tm.kind === 'rit' ? 'rit.' : tm.kind === 'accel' ? 'accel.' : 'a tempo'}</words>`;
                  dirs.push({ t: tm.t, xml: `<direction placement="above"><direction-type>${body}</direction-type>%OFF%%STAFF%${tm.kind === 'tempo' ? `<sound tempo="${tm.bpm}"/>` : ''}</direction>` });
                }
              }
              for (const c of st.chords || []) if (inM(c.t)) dirs.push({ t: c.t, xml: harmonyXml(c.text) });
              for (const f of st.figures || []) if (inM(f.t)) dirs.push({ t: f.t, xml: figuresXml(f.text) });
              dirs.sort((a, b) => a.t - b.t);
            }
            const putDir = (d, at) => {
              d.done = true;
              const off = d.t - at;
              x += '      ' + d.xml.replace('%OFF%', off ? `<offset>${off}</offset>` : '').replace('%STAFF%', staffTag) + '\n';
            };
            const dirsBefore = (t) => { for (const d of dirs) if (!d.done && !d.after && d.t <= t) putDir(d, t); };
            const dirsAfter = (t) => { for (const d of dirs) if (!d.done && d.after && d.t === t) putDir(d, ms.start + ms.len); };
            const dirsRest = (at) => { for (const d of dirs) if (!d.done) putDir(d, at); };
            // sauts (D.C., D.S.), Fine, À la Coda : à la fin de la mesure, au-dessus de la portée du haut
            const endDirs = () => {
              if (!(pi === 0 && k === 0 && s === ps)) return;
              if (mm.jump) x += `      <direction placement="above"><direction-type><words>${esc(M.JUMPS[mm.jump])}</words></direction-type><sound ${JUMP_SOUND[mm.jump]}/></direction>\n`;
              else if (mm.toCoda) x += '      <direction placement="above"><direction-type><words>To Coda</words></direction-type><sound tocoda="coda"/></direction>\n';
              if (mm.fine) x += '      <direction placement="above"><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>\n';
            };
            // paroles : sur la voix qui porte une note à cet instant
            const lyrLane = (t) => M.lanesOf(score, ps).find((l) => score.staves[l].notes.some((n) => n.start === t));
            if (meas.full) {
              dirsRest(ms.start);
              x += `      <note><rest measure="yes"/><duration>${ms.len}</duration><voice>${voice}</voice>${staffTag}</note>\n`;
              endDirs();
              continue;
            }
            const beams = beamInfo(meas.events, meas.start, glen);
            const acc = {};
            // début / fin de chaque n-olet
            const tupFirst = new Set(), tupLast = new Set();
            meas.events.forEach((ev, ei) => {
              if (!ev.tuplet) return;
              const prevE = meas.events[ei - 1], nextE = meas.events[ei + 1];
              if (!prevE || prevE.tuplet !== ev.tuplet) tupFirst.add(ei);
              if (!nextE || nextE.tuplet !== ev.tuplet) tupLast.add(ei);
            });
            const tmXml = (ev) => (ev.tuplet ? `<time-modification><actual-notes>${ev.tuplet.num}</actual-notes><normal-notes>${ev.tuplet.den}</normal-notes></time-modification>` : '');
            const tupXml = (ei) => (tupFirst.has(ei) ? '<tuplet type="start" bracket="yes"/>' : '') + (tupLast.has(ei) ? '<tuplet type="stop"/>' : '');
            meas.events.forEach((ev, ei) => {
              const fi = counters[s]++;
              dirsBefore(ev.start);
              const typeTag = `<type>${TYPE[ev.dur]}</type>` + '<dot/>'.repeat(ev.dots || 0);
              if (ev.rest) {
                const tx = tupXml(ei);
                x += `      <note><rest/><duration>${ev.len}</duration><voice>${voice}</voice>${typeTag}${tmXml(ev)}${staffTag}${tx ? '<notations>' + tx + '</notations>' : ''}</note>\n`;
                return;
              }
              // petites notes, avant la note principale
              if (ev.graces && !ev.tiedFromSelf) {
                for (const g of ev.graces) {
                  g.pitches.forEach((pt, j) => {
                    const kk = pt.step + '_' + pt.oct;
                    const cur = kk in acc ? acc[kk] : M.keyAlter(pt.step, score.fifths);
                    const accTag = pt.alt !== cur ? `<accidental>${ACC[pt.alt]}</accidental>` : '';
                    acc[kk] = pt.alt;
                    x += `      <note><grace${g.slash ? ' slash="yes"' : ''}/>${j > 0 ? '<chord/>' : ''}${pitchXml(pt, octUp)}<voice>${voice}</voice><type>${TYPE[g.dur] || 'eighth'}</type>${accTag}${staffTag}</note>\n`;
                  });
                }
              }
              const prev = flat[s][fi - 1], next = flat[s][fi + 1];
              ev.pitches.forEach((pt, i) => {
                const midi = M.midiOf(pt);
                const tieStop = prev && !prev.rest && prev.tie && prev.start + prev.len === ev.start && prev.pitches.some((q) => M.midiOf(q) === midi);
                const tieStart = ev.tie && next && !next.rest && next.start === ev.start + ev.len && next.pitches.some((q) => M.midiOf(q) === midi);
                const kk = pt.step + '_' + pt.oct;
                const cur = kk in acc ? acc[kk] : M.keyAlter(pt.step, score.fifths);
                let accTag = '';
                if (!ev.tiedFromSelf && pt.alt !== cur) accTag = `<accidental>${ACC[pt.alt]}</accidental>`;
                acc[kk] = pt.alt;
                let n = '      <note>' + (i > 0 ? '<chord/>' : '');
                n += pitchXml(pt, octUp);
                n += `<duration>${ev.len}</duration>`;
                if (tieStop) n += '<tie type="stop"/>';
                if (tieStart) n += '<tie type="start"/>';
                n += `<voice>${voice}</voice>${typeTag}${accTag}${tmXml(ev)}${staffTag}`;
                if (i === 0) for (const [L, t] of beams[ei]) n += `<beam number="${L}">${t}</beam>`;
                let nt = (tieStop ? '<tied type="stop"/>' : '') + (tieStart ? '<tied type="start"/>' : '');
                let lyr = '';
                if (i === 0) {
                  if (!ev.tiedFromSelf) {
                    if (ev.orn && ORN_XML[ev.orn]) nt += `<ornaments><${ORN_XML[ev.orn]}/></ornaments>`;
                    const arts = (ev.arts || []).filter((a) => ART_XML[a]).map((a) => `<${ART_XML[a]}/>`).join('');
                    if (arts || ev.breath) nt += `<articulations>${arts}${ev.breath ? '<breath-mark/>' : ''}</articulations>`;
                    const pl = s === lyrLane(ev.start) ? lyrAt[ps].get(ev.start) : null;
                    if (pl) lyr = pl.map((ly) => `<lyric number="${ly.v + 1}"><syllabic>${ly.syl}</syllabic><text>${esc(ly.text)}</text></lyric>`).join('');
                  } else if (ev.breath) nt += '<articulations><breath-mark/></articulations>';
                  if (ev.fermata) nt += '<fermata type="upright"/>';
                  if (!ev.tiedFromSelf) {
                    // liaisons d'expression (n° 1) et de phrasé (n° 2, au-dessus)
                    for (const sl of st.slurs || []) {
                      const num = sl.kind === 'phrase' ? 2 : 1;
                      const pl = sl.kind === 'phrase' ? ' placement="above"' : '';
                      if (sl.end === ev.src) nt += `<slur type="stop" number="${num}"/>`;
                      if (sl.start === ev.src) nt += `<slur type="start" number="${num}"${pl}/>`;
                    }
                  }
                  nt += tupXml(ei);
                }
                if (nt) n += '<notations>' + nt + '</notations>';
                x += n + lyr + '</note>\n';
              });
              dirsAfter(ev.src != null ? ev.src : ev.start);
            });
            dirsRest(ms.start + ms.len);
            endDirs();
          }
        });
        {
          const voltaEnd = mm.volta && !sameVolta(mm, mNext);
          const last = m === tab.length - 1;
          const style = mm.re || last ? 'light-heavy' : mm.fine || mm.jump ? 'light-light' : null;
          if (style || voltaEnd) {
            x += '      <barline location="right">' + (style ? `<bar-style>${style}</bar-style>` : '')
              + (voltaEnd ? `<ending number="${mm.volta.join(', ')}" type="${mm.re ? 'stop' : 'discontinue'}"/>` : '')
              + (mm.re ? `<repeat direction="backward"${mm.re > 2 ? ` times="${mm.re}"` : ''}/>` : '') + '</barline>\n';
          }
        }
        x += '    </measure>\n';
      }
      x += '  </part>\n';
    });
    x += '</score-partwise>\n';
    return x;
  }

  // ================================================================ MusicXML : import
  function childText(el, sel) { const c = el.querySelector(sel); return c ? c.textContent.trim() : null; }

  function guessInstrument(name, numStaves, clefSign, clefOct, program) {
    const n = (name || '').toLowerCase();
    if (numStaves >= 2) return 'piano';
    if (/recorder|fl[uû]te? ?(à|a) ?bec|blockfl|flauto dolce|descant/.test(n) || program === 75) {
      if (/bass|basse/.test(n)) return 'bass';
      if (/t[ée]nor/.test(n)) return 'tenor';
      if (/alto|treble|\balt\b/.test(n)) return 'alto';
      if (/soprano|descant|sopranino/.test(n)) return 'soprano';
      if (clefSign === 'F') return 'bass';
      return clefOct === 1 ? 'soprano' : 'alto';
    }
    return clefSign === 'F' ? 'melodyBass' : 'melody';
  }

  const DYN_ALIAS = { ppp: 'pp', pppp: 'pp', fff: 'ff', ffff: 'ff', sf: 'sfz', sffz: 'sfz', fz: 'sfz', rfz: 'sfz', rf: 'sfz', sfp: 'fp', sfpp: 'fp', sfzp: 'fp' };
  // indications écrites reconnues : sauts, Fine, À la Coda, changements de tempo
  function classifyWords(w) {
    const t = w.trim().toLowerCase().replace(/\s+/g, ' ');
    const dc = /^(d\.? ?c\.?|da capo)/.test(t), ds = /^(d\.? ?s\.?|dal segno)/.test(t);
    if (dc || ds) {
      const tail = t.replace(/^(d\.? ?c\.?|da capo|d\.? ?s\.?|dal segno)/, '').trim();
      const kind = /fine/.test(tail) ? 'Fine' : /coda/.test(tail) ? 'Coda' : '';
      if (!tail || kind) return { jump: (dc ? 'dc' : 'ds') + kind };
    }
    if (/^fine\.?$/.test(t)) return { fine: true };
    if (/^(to coda|à la coda|a la coda|al coda)/.test(t)) return { toCoda: true };
    if (/^(rit|ritard|ritenuto|rall)/.test(t)) return { tempo: 'rit' };
    if (/^(accel|stringendo)/.test(t)) return { tempo: 'accel' };
    if (/^a tempo/.test(t) || /^tempo i(\b|$)|^tempo primo/.test(t)) return { tempo: 'atempo' };
    return null;
  }
  const BEAT_Q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };

  function importMusicXML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Fichier XML illisible');
    const root = doc.documentElement;
    if (root.nodeName === 'score-timewise') throw new Error('Format « timewise » non pris en charge');
    if (root.nodeName !== 'score-partwise') throw new Error('Ce fichier n’est pas une partition MusicXML');
    const warnings = new Set();
    const title = childText(root, 'work > work-title') || childText(root, 'movement-title') || 'Sans titre';
    const composerEl = root.querySelector('identification > creator[type=composer]');
    const composer = composerEl ? composerEl.textContent.trim() : '';
    const partInfo = {};
    root.querySelectorAll('part-list > score-part').forEach((sp) => {
      partInfo[sp.getAttribute('id')] = {
        name: childText(sp, 'part-name') || childText(sp, 'score-instrument > instrument-name') || '',
        program: +(childText(sp, 'midi-instrument > midi-program') || 0),
      };
    });
    let fifths = null, timeSig = null, tempo = null;
    let pickup = 0, measureCount = 0;
    const sigChanges = []; // changements de métrique (lus sur la première partie)
    const fromPartoch = /partoch/i.test(childText(root, 'identification > encoding > software') || '');
    const builtParts = [];
    // signes communs à toute la partition (lus sur la première partie) : reprises, voltas, sauts, tempos
    const marksIn = []; // [mesure, clé, valeur]
    const temposIn = [];
    let openEnding = null;
    // format de page (et taille des notes pour les fichiers Partoch)
    const layoutIn = {};
    {
      const ph = +childText(root, 'defaults > page-layout > page-height'), pw = +childText(root, 'defaults > page-layout > page-width');
      if (ph && pw) layoutIn.landscape = pw > ph;
      const mmS = +childText(root, 'defaults > scaling > millimeters'), tn = +childText(root, 'defaults > scaling > tenths');
      if (fromPartoch && mmS && tn) layoutIn.scale = Math.max(0.6, Math.min(1.6, Math.round(((mmS / tn) * 40 / 7.0556) * 20) / 20));
    }

    for (const part of root.querySelectorAll(':scope > part')) {
      const info = partInfo[part.getAttribute('id')] || { name: '', program: 0 };
      const firstPart = builtParts.length === 0;
      let divisions = 1, numStaves = 1;
      const clefs = { 1: { sign: 'G', oct: 0 } };
      // une « voie » par portée et par voix : notes, liaisons, n-olets, petites notes en attente
      const lanes = {};
      const voiceMap = {};
      const laneOf = (staff, xmlVoice) => {
        const vm = (voiceMap[staff] = voiceMap[staff] || {});
        if (!(xmlVoice in vm)) {
          const n = Object.keys(vm).length + 1;
          if (n > 4) return null;
          vm[xmlVoice] = n;
        }
        const key = staff + ':' + vm[xmlVoice];
        return (lanes[key] = lanes[key] || { staff, voice: vm[xmlVoice], notes: [], slurs: [], tuplets: [], openSlurs: {}, openTup: null, graces: [] });
      };
      const closeTup = (ln) => {
        const sp = ln.openTup;
        ln.openTup = null;
        if (sp && sp.end > sp.start) ln.tuplets.push({ start: sp.start, end: sp.end, num: sp.num, den: sp.den });
      };
      // n-olets : délimités par <tuplet type="start/stop">, sinon par leur durée attendue
      const trackTuplet = (ln, el, start, dur) => {
        const tm = el.querySelector('time-modification');
        if (!tm) { if (ln.openTup) closeTup(ln); return; }
        const an = +childText(tm, 'actual-notes') || 3, nn = +childText(tm, 'normal-notes') || 2;
        const tStart = el.querySelector('notations tuplet[type=start]');
        const tStop = el.querySelector('notations tuplet[type=stop]');
        let sp = ln.openTup;
        if (sp && ((tStart && sp.end > sp.start) || sp.num !== an || sp.den !== nn)) { closeTup(ln); sp = null; }
        if (!sp) {
          const ntype = TYPE_REV[childText(tm, 'normal-type')] || TYPE_REV[childText(el, 'type')] || '8';
          sp = ln.openTup = { start, end: start, num: an, den: nn, useStop: !!tStart, expected: nn * M.DUR_TICKS[ntype] };
        }
        sp.end = Math.max(sp.end, start + dur);
        if (tStop || (!sp.useStop && sp.end - sp.start >= sp.expected - 1)) closeTup(ln);
      };
      let curSig = null;
      const texts = [];
      // annotations par portée : nuances, soufflets, paroles, accords, chiffrages
      const ann = { dyns: [], hairpins: [], lyrics: [], chords: [], figures: [] };
      const openW = {};
      const verseMap = {};
      let measureStart = 0, pos = 0, lastStart = 0;
      let mIndex = 0;
      for (const meas of part.querySelectorAll(':scope > measure')) {
        pos = measureStart;
        let maxPos = 0;
        for (const el of meas.children) {
          const tag = el.nodeName;
          if (tag === 'attributes') {
            const dv = childText(el, 'divisions'); if (dv) divisions = +dv || 1;
            const fx = childText(el, 'key > fifths');
            if (fx != null && fifths == null) fifths = Math.max(-7, Math.min(7, +fx));
            const b = childText(el, 'time > beats'), bt = childText(el, 'time > beat-type');
            if (b && bt) {
              const ts = [parseInt(b, 10) || 4, +bt || 4];
              if (!curSig || mIndex === 0) {
                curSig = ts;
                if (firstPart) timeSig = ts;
              } else if (!M.sameSig(ts, curSig)) {
                curSig = ts;
                if (firstPart) sigChanges.push({ m: mIndex, sig: ts });
              }
            }
            const ns = childText(el, 'staves'); if (ns) numStaves = +ns || 1;
            el.querySelectorAll('clef').forEach((c) => {
              const num = +(c.getAttribute('number') || 1);
              clefs[num] = { sign: childText(c, 'sign') || 'G', oct: +(childText(c, 'clef-octave-change') || 0) };
              if (clefs[num].sign === 'C') warnings.add('Clé d’ut convertie en clé de sol');
            });
          } else if (tag === 'backup') {
            pos -= (+childText(el, 'duration') || 0) * M.TPQ / divisions;
          } else if (tag === 'forward') {
            pos += (+childText(el, 'duration') || 0) * M.TPQ / divisions;
            maxPos = Math.max(maxPos, pos - measureStart);
          } else if (tag === 'direction' || tag === 'sound') {
            const snd = tag === 'sound' ? el : el.querySelector('sound');
            const off = tag === 'direction' ? (+childText(el, 'offset') || 0) * M.TPQ / divisions : 0;
            const t = Math.max(0, pos + off);
            const staff = +(childText(el, 'staff') || 1);
            // tempo : la première indication donne le tempo de départ, les suivantes deviennent des indications
            let bpm = snd && snd.getAttribute('tempo') ? +snd.getAttribute('tempo') : null;
            const mt = tag === 'direction' && el.querySelector('direction-type > metronome');
            if (!bpm && mt && childText(mt, 'per-minute')) {
              const q = (BEAT_Q[childText(mt, 'beat-unit')] || 1) * (mt.querySelector('beat-unit-dot') ? 1.5 : 1);
              bpm = (parseFloat(childText(mt, 'per-minute')) || 0) * q;
            }
            if (bpm > 0) {
              if (tempo == null) tempo = Math.round(bpm);
              else if (firstPart && t > 0) temposIn.push({ t, kind: 'tempo', bpm: Math.round(bpm) });
            }
            let words = '';
            if (tag === 'direction') {
              for (const dy of el.querySelectorAll('direction-type > dynamics')) {
                for (const c of dy.children) {
                  const v = M.DYNAMICS.includes(c.nodeName) ? c.nodeName : DYN_ALIAS[c.nodeName];
                  if (v) ann.dyns.push({ staff, t, v });
                }
              }
              for (const wg of el.querySelectorAll('direction-type > wedge')) {
                const key = staff + ':' + (wg.getAttribute('number') || '1'), ty = wg.getAttribute('type');
                if (ty === 'crescendo' || ty === 'diminuendo') openW[key] = { staff, start: t, kind: ty === 'diminuendo' ? 'dim' : 'cresc' };
                else if (ty === 'stop' && openW[key]) { ann.hairpins.push({ ...openW[key], endPos: t }); delete openW[key]; }
              }
              if (firstPart) {
                if (el.querySelector('direction-type > segno')) marksIn.push([mIndex, 'segno', true]);
                if (el.querySelector('direction-type > coda')) marksIn.push([mIndex, snd && snd.getAttribute('tocoda') ? 'toCoda' : 'coda', true]);
              }
              words = [...el.querySelectorAll('direction-type > words')].map((w) => w.textContent.trim()).filter(Boolean).join(' ');
            }
            // sauts indiqués par le son seul
            if (snd && firstPart && !words) {
              if (snd.getAttribute('dacapo') === 'yes') marksIn.push([mIndex, 'jump', 'dc']);
              else if (snd.getAttribute('dalsegno')) marksIn.push([mIndex, 'jump', 'ds']);
              if (snd.getAttribute('fine') === 'yes' && !(tag === 'direction' && el.querySelector('direction-type > segno, direction-type > coda'))) marksIn.push([mIndex, 'fine', true]);
            }
            const cw = words && classifyWords(words);
            if (cw) {
              if (firstPart) {
                if (cw.jump) marksIn.push([mIndex, 'jump', cw.jump]);
                if (cw.fine) marksIn.push([mIndex, 'fine', true]);
                if (cw.toCoda) marksIn.push([mIndex, 'toCoda', true]);
                if (cw.tempo) temposIn.push({ t, kind: cw.tempo });
              }
            } else if (words) {
              texts.push({ staff, t, text: words, below: el.getAttribute('placement') === 'below' });
            }
          } else if (tag === 'barline') {
            if (firstPart) {
              const rp = el.querySelector('repeat');
              if (rp) {
                if (rp.getAttribute('direction') === 'forward') marksIn.push([mIndex, 'rs', true]);
                else marksIn.push([mIndex, 're', Math.max(2, Math.min(9, +(rp.getAttribute('times') || 2)))]);
              }
              const en = el.querySelector('ending');
              if (en) {
                const nums = (en.getAttribute('number') || '1').split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 9);
                if (en.getAttribute('type') === 'start') openEnding = { nums: nums.length ? nums : [1], from: mIndex };
                else if (openEnding) { for (let q = openEnding.from; q <= mIndex; q++) marksIn.push([q, 'volta', openEnding.nums]); openEnding = null; }
              }
              if (el.querySelector('segno')) marksIn.push([mIndex, 'segno', true]);
              if (el.querySelector('coda')) marksIn.push([mIndex, 'coda', true]);
            }
          } else if (tag === 'print') {
            // sauts de ligne et de page : seulement depuis Partoch (les autres logiciels notent chaque ligne de leur mise en page)
            if (firstPart && fromPartoch && mIndex > 0) {
              if (el.getAttribute('new-page') === 'yes') marksIn.push([mIndex - 1, 'brk', 'page']);
              else if (el.getAttribute('new-system') === 'yes') marksIn.push([mIndex - 1, 'brk', 'line']);
            }
          } else if (tag === 'harmony') {
            const off = (+childText(el, 'offset') || 0) * M.TPQ / divisions;
            const kindEl = el.querySelector('kind');
            const kt = kindEl ? kindEl.getAttribute('text') : null, kv = kindEl ? kindEl.textContent.trim() : 'major';
            let txt;
            if (kv === 'none') txt = kt || 'N.C.';
            else {
              const rs = childText(el, 'root > root-step');
              if (rs) {
                txt = rs + accTxt(+(childText(el, 'root > root-alter') || 0)) + (kt != null ? kt : HARM_TXT[kv] != null ? HARM_TXT[kv] : '');
                const bs = childText(el, 'bass > bass-step');
                if (bs) txt += '/' + bs + accTxt(+(childText(el, 'bass > bass-alter') || 0));
              }
            }
            if (txt) ann.chords.push({ staff: +(childText(el, 'staff') || 1), t: Math.max(0, pos + off), text: txt });
          } else if (tag === 'figured-bass') {
            const figs = [...el.querySelectorAll('figure')].map((f) => (FIG_TXT[childText(f, 'prefix')] || '') + (childText(f, 'figure-number') || '') + (FIG_TXT[childText(f, 'suffix')] || '')).filter(Boolean);
            if (figs.length) ann.figures.push({ staff: 1, t: pos, text: figs.join('/'), fb: true });
          } else if (tag === 'note') {
            const graceEl = el.querySelector('grace');
            const isChord = !!el.querySelector('chord');
            const dur = graceEl ? 0 : (+childText(el, 'duration') || 0) * M.TPQ / divisions;
            const start = isChord ? lastStart : pos;
            if (!isChord && !graceEl) { lastStart = pos; pos += dur; }
            maxPos = Math.max(maxPos, pos - measureStart);
            if (el.querySelector('cue')) continue;
            const staff = +(childText(el, 'staff') || 1);
            if (staff > 2) { warnings.add('Portées au-delà de la 2e ignorées'); continue; }
            const ln = laneOf(staff, childText(el, 'voice') || '1');
            if (!ln) { warnings.add('Voix au-delà de la 4e ignorées'); continue; }
            if (!isChord && !graceEl) trackTuplet(ln, el, start, dur);
            if (el.querySelector('rest')) continue;
            const pe = el.querySelector('pitch');
            if (!pe) continue;
            const step = M.STEP_EN.indexOf((childText(pe, 'step') || 'C').toUpperCase());
            const alt = Math.round(+(childText(pe, 'alter') || 0));
            const clefOct = (clefs[staff] || clefs[1]).oct || 0;
            const pitch = { step, oct: (+childText(pe, 'octave') || 4) - clefOct, alt };
            const type = TYPE_REV[childText(el, 'type')];
            if (graceEl) {
              // petite note : rattachée à la prochaine note de la même voix
              if (isChord && ln.graces.length) ln.graces[ln.graces.length - 1].pitches.push(pitch);
              else ln.graces.push({ pitches: [pitch], dur: type === '16' || type === '32' ? '16' : '8', slash: graceEl.getAttribute('slash') === 'yes' });
              continue;
            }
            const tie = !!el.querySelector('tie[type=start]');
            const dots = el.querySelectorAll('dot').length;
            const list = ln.notes;
            const last = list[list.length - 1];
            const breath = !!el.querySelector('notations articulations breath-mark');
            const orn = el.querySelector('notations ornaments trill-mark') ? 'tr' : el.querySelector('notations ornaments inverted-mordent') ? 'prall'
              : el.querySelector('notations ornaments mordent') ? 'mord' : el.querySelector('notations ornaments turn, notations ornaments inverted-turn') ? 'turn' : null;
            const arts = [['staccato', 'stacc'], ['staccatissimo', 'staccmo'], ['spiccato', 'staccmo'], ['tenuto', 'ten'], ['accent', 'acc'], ['strong-accent', 'marc']]
              .filter(([tg]) => el.querySelector('notations articulations ' + tg)).map(([, a]) => a);
            const fermata = !!el.querySelector('notations fermata');
            let target;
            if (isChord && last && Math.abs(last.start - start) < 1) {
              target = last;
              if (!last.pitches.some((q) => M.midiOf(q) === M.midiOf(pitch))) last.pitches.push(pitch);
              last.tie = last.tie || tie;
              last.breath = last.breath || breath;
            } else {
              target = { start, len: dur, pitches: [pitch], tie, dur: type, dots, breath };
              if (ln.graces.length) { target.graces = ln.graces; ln.graces = []; }
              list.push(target);
            }
            if (orn) target.orn = orn;
            if (arts.length) target.arts = [...new Set((target.arts || []).concat(arts))];
            if (fermata) target.fermata = true;
            for (const ly of el.querySelectorAll(':scope > lyric')) {
              const txt = [...ly.querySelectorAll('text')].map((x) => x.textContent).join(' ').trim();
              if (!txt) continue;
              const key = ly.getAttribute('number') || ly.getAttribute('name') || '1';
              if (!(key in verseMap)) verseMap[key] = Object.keys(verseMap).length;
              if (verseMap[key] > 4) continue;
              const syl = childText(ly, 'syllabic');
              ann.lyrics.push({ staff, t: start, v: verseMap[key], text: txt, hyph: syl === 'begin' || syl === 'middle' });
            }
            // basse chiffrée lue juste avant : sur la portée de cette note
            for (const f of ann.figures) if (f.fb && f.t === start) { f.staff = staff; delete f.fb; }
            // liaisons d'expression / de phrasé
            const open = ln.openSlurs;
            const slurEls = [...el.querySelectorAll('notations slur')];
            for (const se of slurEls) {
              if (se.getAttribute('type') !== 'stop') continue;
              const num = se.getAttribute('number') || '1';
              const o = open[num];
              if (o && start > o.start) ln.slurs.push({ start: o.start, end: start, number: num, above: o.above });
              delete open[num];
            }
            for (const se of slurEls) {
              if (se.getAttribute('type') !== 'start') continue;
              const num = se.getAttribute('number') || '1';
              if (!open[num] || open[num].start !== start) open[num] = { start, above: se.getAttribute('placement') === 'above' };
            }
          }
        }
        for (const ln of Object.values(lanes)) { if (ln.openTup) closeTup(ln); ln.graces = []; }
        // longueur de la mesure : celle de la métrique, sauf levée (première mesure incomplète)
        const nominal = curSig ? M.sigLen(curSig) : maxPos;
        let len = nominal;
        if (mIndex === 0 && (meas.getAttribute('implicit') === 'yes' || (maxPos > 0 && maxPos < nominal))) {
          len = maxPos;
          if (firstPart) pickup = maxPos;
        }
        measureStart += len || nominal;
        mIndex++;
      }
      if (firstPart) {
        measureCount = mIndex;
        if (openEnding) { for (let q = openEnding.from; q < mIndex; q++) marksIn.push([q, 'volta', openEnding.nums]); openEnding = null; }
      }
      for (const f of ann.figures) delete f.fb;
      const staffNums = Object.values(lanes).map((l) => l.staff);
      const staffCount = Math.min(2, Math.max(numStaves, ...staffNums, 1));
      const inst = guessInstrument(info.name, staffCount, clefs[1].sign, clefs[1].oct, info.program);
      builtParts.push({ inst, lanes, clefs, staffCount, texts, ann });
    }

    const sc = M.newScore({ title, composer, fifths: fifths || 0, timeSig: timeSig || [4, 4], tempo: tempo || 90, instruments: builtParts.map((p) => p.inst), measures: Math.max(1, measureCount) });
    const p0 = Math.round(pickup / 30) * 30;
    sc.pickup = p0 > 0 && p0 < M.sigLen(sc.timeSig) ? p0 : 0;
    sc.sigChanges = sigChanges;
    M.normalizeSigs(sc);
    let si = 0;
    for (const p of builtParts) {
      const nStaves = M.INSTRUMENTS[p.inst].grand ? 2 : 1;
      for (let k = 1; k <= nStaves; k++) {
        const ps = si++;
        const st = sc.staves[ps];
        if (!M.INSTRUMENTS[p.inst].grand && p.clefs[1].sign === 'F' && !M.INSTRUMENTS[p.inst].recorder) st.clef = 'bass';
        for (const tx of p.texts.filter((x) => x.staff === k)) {
          sc.texts.push({ id: M.uid(), sid: st.id, t: Math.round(tx.t / 30) * 30, dx: 0, dy: tx.below ? 62 : -28, text: tx.text });
        }
        const lns = Object.values(p.lanes).filter((l) => l.staff === k).sort((a, b) => a.voice - b.voice);
        for (const ln of lns) {
          if (ln.voice > 1 && !ln.notes.length) continue;
          const idx = ln.voice === 1 ? ps : M.laneFor(sc, ps, ln.voice, true);
          const tst = sc.staves[idx];
          const tups = finishTuplets(ln.tuplets);
          tst.tuplets = tups.map((t) => t.span);
          tst.notes = finishNotes(ln.notes, tups);
          tst.slurs = finishSlurs(ln.slurs, tst.notes, fromPartoch);
        }
        // annotations, calées sur les notes de la portée (et de ses voix)
        const starts = [...new Set(M.lanesOf(sc, ps).flatMap((l) => sc.staves[l].notes.map((n) => n.start)))].sort((a, b) => a - b);
        const snap = (t) => {
          let best = null;
          for (const x of starts) if (best == null || Math.abs(x - t) < Math.abs(best - t)) best = x;
          return best != null && Math.abs(best - t) <= 120 ? best : Math.round(t / 30) * 30;
        };
        const A = M.staffLists(st), mine = (x) => x.staff === k;
        const seen = new Set();
        for (const d of p.ann.dyns.filter(mine)) { const t = snap(d.t); if (seen.has(t)) continue; seen.add(t); A.dyns.push({ t, v: d.v }); }
        for (const h of p.ann.hairpins.filter(mine)) {
          const a = snap(h.start);
          const before = starts.filter((x) => x > a && x < h.endPos - 1);
          const e = before.length ? before[before.length - 1] : starts.find((x) => x > a);
          if (e != null) A.hairpins.push({ start: a, end: e, kind: h.kind });
        }
        for (const ly of p.ann.lyrics.filter(mine)) A.lyrics.push({ t: snap(ly.t), v: ly.v, text: ly.text, hyph: ly.hyph });
        for (const c of p.ann.chords.filter(mine)) A.chords.push({ t: snap(c.t), text: c.text });
        for (const f of p.ann.figures.filter(mine)) A.figures.push({ t: snap(f.t), text: f.text });
        for (const key of M.TICK_LISTS) A[key].sort((a, b) => a.t - b.t);
      }
    }
    // reprises, voltas, sauts, sauts de ligne ; tempos
    for (const [mi, key, val] of marksIn) if (mi >= 0 && mi < Math.max(1, measureCount)) M.setMark(sc, mi, key, val);
    const tSeen = new Set();
    sc.tempos = temposIn.map((x) => ({ ...x, t: Math.round(x.t / 30) * 30 })).filter((x) => { const k = x.t + x.kind; if (tSeen.has(k)) return false; tSeen.add(k); return true; });
    if (layoutIn.landscape != null || layoutIn.scale) sc.layout = { ...(sc.layout || { mpl: 0, scale: 1 }), ...layoutIn };
    M.ensureMeasures(sc, M.scoreEndTick(sc));
    M.normalizeSigs(sc);
    return { score: sc, warnings: [...warnings] };
  }

  // n-olets : début et durée calés sur la grille de 60 ticks
  function finishTuplets(list) {
    const out = [];
    for (const t of list.sort((a, b) => a.start - b.start)) {
      const start = Math.round(t.start / 60) * 60;
      const len = Math.max(60, Math.round((t.end - t.start) / 60) * 60);
      const prev = out[out.length - 1];
      if (prev && prev.span.start + prev.span.len > start) continue;
      out.push({ raw: t, span: { start, len, num: t.num, den: t.den } });
    }
    return out;
  }
  // notes hors n-olet : grille de 60 ticks (triple croche) ; dans un n-olet : positions exactes
  function finishNotes(list, tups) {
    tups = tups || [];
    const out = [];
    list.sort((a, b) => a.start - b.start);
    for (const n of list) {
      const tp = tups.find((t) => n.start >= t.raw.start - 1 && n.start < t.raw.end - 1);
      let start, len;
      if (tp) {
        start = tp.span.start + Math.round(n.start - tp.raw.start);
        len = Math.max(1, Math.min(Math.round(n.len), tp.span.start + tp.span.len - start));
      } else {
        start = Math.round(n.start / 60) * 60;
        len = Math.max(60, Math.round(n.len / 60) * 60);
      }
      const prev = out[out.length - 1];
      if (prev && prev.start === start) {
        prev.pitches.push(...n.pitches.filter((p) => !prev.pitches.some((q) => M.midiOf(q) === M.midiOf(p))));
        if (n.arts) prev.arts = [...new Set((prev.arts || []).concat(n.arts))];
        if (n.fermata) prev.fermata = true;
        if (n.orn && !prev.orn) prev.orn = n.orn;
        continue;
      }
      if (prev && prev.start + prev.len > start) { prev.len = start - prev.start; prev.dur = undefined; prev.tie = false; }
      const nn = { start, len, pitches: n.pitches, tie: !!n.tie, breath: !!n.breath };
      if (n.graces) nn.graces = n.graces;
      if (n.orn) nn.orn = n.orn;
      if (n.arts && n.arts.length) nn.arts = n.arts;
      if (n.fermata) nn.fermata = true;
      if (n.dur) {
        const written = M.durTicks(n.dur, n.dots);
        const expect = tp ? Math.round((written * tp.span.den) / tp.span.num) : written;
        if (Math.abs(expect - len) <= 1) { nn.dur = n.dur; nn.dots = n.dots || 0; }
      }
      out.push(nn);
    }
    for (const n of out) n.pitches.sort((a, b) => M.midiOf(a) - M.midiOf(b));
    return out.filter((n) => n.len > 0);
  }

  // Liaisons importées : calées sur les notes ; une liaison qui en englobe une autre devient
  // une liaison de phrasé (Partoch les distingue par le numéro 2)
  function finishSlurs(list, notes, fromPartoch) {
    if (!notes.length) return [];
    const snap = (t) => {
      let best = notes[0].start;
      for (const n of notes) if (Math.abs(n.start - t) < Math.abs(best - t)) best = n.start;
      return best;
    };
    const raw = list.map((sl) => ({ start: snap(sl.start), end: snap(sl.end), number: sl.number })).filter((sl) => sl.end > sl.start);
    const out = [];
    for (const sl of raw) {
      let kind;
      if (fromPartoch) kind = sl.number === '2' ? 'phrase' : 'slur';
      else kind = raw.some((o) => o !== sl && o.start >= sl.start && o.end <= sl.end && (o.start > sl.start || o.end < sl.end)) ? 'phrase' : 'slur';
      if (out.some((o) => o.kind === kind && !(o.end < sl.start || o.start > sl.end))) continue;
      out.push({ start: sl.start, end: sl.end, kind });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // ================================================================ .mxl (zip)
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Archive .mxl invalide');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
      const data = bytes.subarray(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + csize);
      files[name] = { method, data };
      p += 46 + nlen + xlen + clen;
    }
    const read = async (name) => {
      const f = files[name];
      if (!f) return null;
      const raw = f.method === 8 ? await inflateRaw(f.data) : f.data;
      return new TextDecoder().decode(raw);
    };
    return { names: Object.keys(files), read };
  }
  async function mxlToXml(bytes) {
    const z = await unzip(bytes);
    let rootPath = null;
    const container = await z.read('META-INF/container.xml');
    if (container) {
      const d = new DOMParser().parseFromString(container, 'application/xml');
      const rf = d.querySelector('rootfile');
      if (rf) rootPath = rf.getAttribute('full-path');
    }
    if (!rootPath) rootPath = z.names.find((n) => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
    const xml = rootPath && (await z.read(rootPath));
    if (!xml) throw new Error('Aucune partition trouvée dans l’archive .mxl');
    return xml;
  }

  // ================================================================ MIDI : export
  function vlq(n) {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  }
  function str2bytes(s) { return Array.from(new TextEncoder().encode(s)); }
  function trackChunk(events) {
    // events : [{tick, data:[...]}], déjà triés
    const body = [];
    let last = 0;
    for (const e of events) { body.push(...vlq(Math.max(0, Math.round(e.tick - last))), ...e.data); last = e.tick; }
    body.push(0, 0xff, 0x2f, 0x00);
    const len = body.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
  }
  function exportMIDI(score) {
    const tracks = [];
    const usPerQ = Math.round(60000000 / score.tempo);
    const title = str2bytes(score.title || 'Partoch');
    const sf = score.fifths & 0xff;
    const conductor = [
      { tick: 0, data: [0xff, 0x03, ...vlq(title.length), ...title] },
      { tick: 0, data: [0xff, 0x51, 0x03, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255] },
      { tick: 0, data: [0xff, 0x59, 0x02, sf, 0] },
    ];
    // métriques : la levée devient une courte mesure (ex. 1/4), puis chaque changement
    const sigEv = (tick, n, d) => ({ tick, data: [0xff, 0x58, 0x04, n, Math.round(Math.log2(d)), 24, 8] });
    let lastKey = '';
    for (const ms of M.measureTable(score)) {
      let n = ms.sig[0], d = ms.sig[1];
      if (ms.pickup) {
        d = 16; n = Math.max(1, Math.round(ms.len / 120));
        while (d > ms.sig[1] && n % 2 === 0) { n /= 2; d /= 2; }
      }
      const key = n + '/' + d;
      if (key !== lastKey) { conductor.push(sigEv(ms.start, n, d)); lastKey = key; }
    }
    conductor.sort((a, b) => a.tick - b.tick);
    tracks.push(trackChunk(conductor));
    const evs = M.playbackEvents(score);
    // une piste par partie (les deux mains du piano sur la même piste)
    scoreParts(score).forEach((part, pi) => {
      let ch = pi % 15; if (ch >= 9) ch++;
      const d = M.INSTRUMENTS[part.inst];
      const name = str2bytes(d.name);
      const list = [
        { tick: 0, ord: 0, data: [0xff, 0x03, ...vlq(name.length), ...name] },
        { tick: 0, ord: 0, data: [0xc0 | ch, programFor(part.inst)] },
      ];
      for (const e of evs) {
        if (!part.all.includes(e.staff)) continue;
        const midi = Math.max(0, Math.min(127, e.midi));
        list.push({ tick: e.tick, ord: 2, data: [0x90 | ch, midi, 90] });
        list.push({ tick: e.tick + e.len, ord: 1, data: [0x80 | ch, midi, 0] });
      }
      list.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
      tracks.push(trackChunk(list));
    });
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (M.TPQ >> 8) & 255, M.TPQ & 255];
    return new Uint8Array([...header, ...tracks.flat()]);
  }

  // ================================================================ MIDI : import
  function parseMIDI(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (tag(0) !== 'MThd') throw new Error('Ce fichier n’est pas un fichier MIDI');
    const hlen = dv.getUint32(4);
    const ntrks = dv.getUint16(10), division = dv.getUint16(12);
    if (division & 0x8000) throw new Error('Fichiers MIDI à base temporelle SMPTE non pris en charge');
    let p = 8 + hlen;
    const tracks = [];
    let tempo = null, timeSig = null, keySig = null;
    const sigs = [];
    for (let t = 0; t < ntrks && p < bytes.length; t++) {
      if (tag(p) !== 'MTrk') break;
      const len = dv.getUint32(p + 4);
      let q = p + 8;
      const end = q + len;
      let tick = 0, status = 0;
      const tr = { name: '', notes: [], programs: {} };
      const open = {};
      const readVlq = () => { let v = 0, b; do { b = bytes[q++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && q < end); return v; };
      while (q < end) {
        tick += readVlq();
        let b = bytes[q];
        if (b & 0x80) { status = b; q++; } else if (!status) break;
        const type = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          const mt = bytes[q++];
          const l = readVlq();
          const data = bytes.subarray(q, q + l);
          q += l;
          if (mt === 0x03 && !tr.name) tr.name = new TextDecoder().decode(data);
          else if (mt === 0x51 && tempo == null) tempo = Math.round(60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]));
          else if (mt === 0x58) { const sg = [data[0], Math.pow(2, data[1])]; if (!timeSig) timeSig = sg; sigs.push({ tick, sig: sg }); }
          else if (mt === 0x59 && keySig == null) keySig = (data[0] << 24) >> 24;
          status = 0;
        } else if (status === 0xf0 || status === 0xf7) {
          const l = readVlq(); q += l; status = 0;
        } else if (type === 0x90 || type === 0x80) {
          const note = bytes[q++], vel = bytes[q++];
          const key = ch + ':' + note;
          if (type === 0x90 && vel > 0) {
            (open[key] = open[key] || []).push([tick, vel]);
          } else if (open[key] && open[key].length) {
            const st = open[key].shift();
            tr.notes.push({ ch, midi: note, start: st[0], end: tick, vel: st[1] });
          }
        } else if (type === 0xc0) { tr.programs[ch] = bytes[q++]; }
        else if (type === 0xd0) { q += 1; }
        else { q += 2; } // A0, B0, E0
      }
      tracks.push(tr);
      p = end;
    }
    return { division, tracks, tempo, timeSig, keySig, sigs };
  }

  const RECORDER_SOUND = { soprano: [72, 98], alto: [65, 91], tenor: [60, 86], bass: [53, 79] };
  function chooseRecorder(lo, hi, notes) {
    let best = 'alto', bestBad = Infinity;
    for (const k of ['soprano', 'alto', 'tenor', 'bass']) {
      const [a, b] = RECORDER_SOUND[k];
      const bad = notes.filter((n) => n.midi < a || n.midi > b).length;
      if (bad < bestBad) { bestBad = bad; best = k; }
    }
    return best;
  }

  function importMIDI(bytes, opts) {
    opts = opts || {};
    const q = opts.quantize || 120;
    const mid = parseMIDI(bytes);
    const warnings = new Set();
    // regroupe par piste + canal (hors batterie)
    const groups = [];
    mid.tracks.forEach((tr) => {
      const byCh = {};
      for (const n of tr.notes) {
        if (n.ch === 9) { warnings.add('Piste de batterie ignorée'); continue; }
        (byCh[n.ch] = byCh[n.ch] || []).push(n);
      }
      for (const ch in byCh) groups.push({ name: tr.name, program: tr.programs[ch] != null ? tr.programs[ch] : 0, notes: byCh[ch] });
    });
    if (!groups.length) throw new Error('Aucune note trouvée dans ce fichier MIDI');
    // fichier joué en direct (notes hors grille) : on retrouve la pulsation et la métrique
    const live = realignLive(groups, mid);
    const scale = live ? 1 : M.TPQ / mid.division;
    // pas d'armure dans le fichier : on la déduit des notes
    const AI = P.audioImport;
    const fifths = mid.keySig != null ? Math.max(-7, Math.min(7, mid.keySig))
      : AI && AI.detectKey ? AI.detectKey([groups.flatMap((g) => g.notes.map((n) => ({ pitch: n.midi, s: n.start, e: n.end })))]).fifths : 0;
    const insts = [];
    const plans = groups.map((g) => {
      const notes = g.notes.map((n) => ({ midi: n.midi, start: n.start * scale, end: n.end * scale }));
      const lo = Math.min(...notes.map((n) => n.midi)), hi = Math.max(...notes.map((n) => n.midi));
      const name = (g.name || '').toLowerCase();
      let inst;
      const poly = notes.some((a, i) => notes.some((b, j) => j > i && Math.abs(a.start - b.start) < q / 2));
      if ((g.program >= 72 && g.program <= 79) || /recorder|fl[uû]te|blockfl/.test(name)) inst = chooseRecorder(lo, hi, notes);
      else if (g.program < 8 || (poly && hi - lo > 24)) inst = 'piano';
      else inst = (lo + hi) / 2 < 55 ? 'melodyBass' : 'melody';
      return { inst, notes };
    });
    // deux pistes de piano consécutives (main droite puis main gauche) → un seul piano
    const median = (ns) => { const a = ns.map((n) => n.midi).sort((x, y) => x - y); return a[a.length >> 1]; };
    for (let i = 0; i < plans.length - 1; i++) {
      const a = plans[i], b = plans[i + 1];
      if (a.inst === 'piano' && b.inst === 'piano' && !a.rh && !b.rh && median(a.notes) > median(b.notes)) {
        // chaque note va dans la main qui lui convient (une piste « main droite » contient souvent des basses)
        const rh = a.notes.filter((n) => n.midi >= 55).concat(b.notes.filter((n) => n.midi >= 67));
        const lh = b.notes.filter((n) => n.midi < 67).concat(a.notes.filter((n) => n.midi < 55));
        plans.splice(i, 2, { inst: 'piano', rh, lh });
      }
    }
    insts.push(...plans.map((p) => p.inst));
    const sc = M.newScore({ title: opts.title || 'Import MIDI', fifths, timeSig: live ? live.sig : mid.timeSig || [4, 4], tempo: live ? live.bpm : mid.tempo || 90, instruments: insts, measures: 1 });
    if (live && live.pickup) sc.pickup = live.pickup;
    let si = 0;
    for (const pl of plans) {
      const shift = M.INSTRUMENTS[pl.inst].soundShift || 0;
      if (pl.rh) {
        sc.staves[si++].notes = midiToNotes(pl.rh, 0, fifths, q);
        sc.staves[si++].notes = midiToNotes(pl.lh, 0, fifths, q);
      } else if (M.INSTRUMENTS[pl.inst].grand) {
        sc.staves[si++].notes = midiToNotes(pl.notes.filter((n) => n.midi >= 60), 0, fifths, q);
        sc.staves[si++].notes = midiToNotes(pl.notes.filter((n) => n.midi < 60), 0, fifths, q);
      } else {
        sc.staves[si++].notes = midiToNotes(pl.notes, shift, fifths, q);
      }
    }
    if (!live) applyMidiSigs(sc, mid.sigs, scale);
    M.ensureMeasures(sc, M.scoreEndTick(sc));
    M.normalizeSigs(sc);
    return { score: sc, warnings: [...warnings] };
  }
  // Enregistrement joué au clavier (ou à la guitare MIDI) : les attaques ne tombent pas sur une grille.
  // On passe en secondes, on suit les temps comme pour un enregistrement audio, puis on quantifie à la double croche.
  // Les notes des groupes sont réécrites en ticks Partoch (TPQ) ; renvoie null si le fichier est déjà calé.
  function realignLive(groups, mid) {
    const AI = P.audioImport;
    if (!AI || !AI.trackBeats) return null;
    const all = groups.flatMap((g) => g.notes);
    const d = mid.division;
    const starts = [...new Set(all.map((n) => n.start))].sort((a, b) => a - b);
    // attaques regroupées (accords arpégés de quelques ms)
    const ons = [];
    for (const t of starts) if (!ons.length || t - ons[ons.length - 1] > d / 24) ons.push(t);
    if (ons.length < 16) return null;
    const near = (t, g) => { const r = t % g; return Math.min(r, g - r) <= d / 64; };
    const onGrid = ons.filter((t) => near(t, d / 8) || near(t, d / 6)).length / ons.length;
    if (onGrid >= 0.75) return null;
    const spt = 60 / ((mid.tempo || 120) * d);
    const notes = all.map((n) => ({ start: n.start * spt, dur: Math.max(0.03, (n.end - n.start) * spt), amp: (n.vel || 80) / 127, pitch: n.midi, src: n }))
      .sort((a, b) => a.start - b.start);
    const duration = Math.max(...notes.map((n) => n.start + n.dur));
    const bt = AI.trackBeats(notes, duration, null, 0.5);
    const sig = AI.detectMeter(notes, bt.beats);
    const qz = AI.quantize(notes, bt.beats, sig, 120);
    let pickup = qz.pickup, off = 0;
    // un accord plein au début est un premier temps (l'appui de la sarabande sur le 2e temps trompe la détection)
    const s0 = Math.min(...qz.notes.map((q) => q.s));
    const firstChord = notes.filter((n) => n.start - notes[0].start < 0.06).length;
    if (firstChord >= 3) { pickup = 0; off = s0; }
    const keep = new Set();
    for (const q of qz.notes) { q.ref.src.start = q.s - off; q.ref.src.end = q.e - off; keep.add(q.ref.src); }
    for (const g of groups) {
      g.notes = g.notes.filter((n) => keep.has(n));
      // jeu un peu détaché : la note va jusqu'à l'attaque suivante si le trou est court
      // (main droite et main gauche séparément, comme à l'affichage)
      for (const part of [g.notes.filter((n) => n.midi >= 60), g.notes.filter((n) => n.midi < 60)]) {
        const on = [...new Set(part.map((n) => n.start))].sort((a, b) => a - b);
        for (const n of part) {
          const nx = on.find((t) => t > n.start);
          if (nx != null && n.end < nx && nx - n.end <= Math.max(120, (nx - n.start) * 0.34)) n.end = nx;
        }
      }
    }
    return { sig, bpm: Math.max(30, Math.min(240, Math.round(bt.bpm))), pickup };
  }

  // Métriques MIDI → métrique de départ, levée (première mesure courte) et changements
  function applyMidiSigs(sc, raw, scale) {
    const byTick = new Map();
    for (const x of raw || []) byTick.set(Math.round(x.tick * scale), x.sig);
    const sigs = [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, sig]) => ({ tick, sig }));
    if (!sigs.length) return;
    let i = 0, cur = sc.timeSig, t = 0, m = 0;
    if (sigs[0].tick === 0) { cur = sigs[0].sig; i = 1; }
    sc.timeSig = cur;
    const nxt = sigs[i];
    if (nxt && sigs[0].tick === 0 && nxt.tick > 0 && (nxt.tick < M.sigLen(cur) || (nxt.tick === M.sigLen(cur) && nxt.tick < M.sigLen(nxt.sig)))) {
      // levée : la première mesure est plus courte que la suivante
      sc.pickup = sigs[i].tick; sc.timeSig = sigs[i].sig; cur = sigs[i].sig; t = sigs[i].tick; m = 1; i++;
    }
    const changes = [];
    for (; i < sigs.length; i++) {
      while (t < sigs[i].tick) { t += M.sigLen(cur); m++; }
      if (t === sigs[i].tick && !M.sameSig(sigs[i].sig, cur)) changes.push({ m, sig: sigs[i].sig });
      cur = sigs[i].sig;
    }
    sc.sigChanges = changes;
    sc.measures = Math.max(sc.measures, m + 1);
  }

  // Trilles écrits note à note (alternance rapide de deux notes voisines, plus courtes que la grille)
  // → une seule note (la plus grave) avec le signe tr. Sinon, la quantification en ferait des accords de secondes.
  function collapseTrills(list, q) {
    const maxIoi = q * 0.8;
    const notes = list.slice().sort((a, b) => a.start - b.start || a.midi - b.midi);
    const short = (n) => n.end - n.start <= maxIoi * 1.25;
    const used = new Set();
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      const a = notes[i];
      if (used.has(a) || !short(a)) continue;
      const chain = [a];
      let other = null;
      for (let j = i + 1; j < notes.length; j++) {
        const b = notes[j], last = chain[chain.length - 1];
        if (b.start - last.start > maxIoi) break;
        if (used.has(b) || !short(b) || b.start <= last.start) continue;
        const prevPitch = chain.length > 1 ? chain[chain.length - 2].midi : null;
        if (other == null) {
          const d = Math.abs(b.midi - a.midi);
          if (d >= 1 && d <= 2) { other = b.midi; chain.push(b); }
        } else if (b.midi === prevPitch && b.midi !== last.midi && (b.midi === a.midi || b.midi === other)) chain.push(b);
      }
      if (chain.length < 4) continue;
      const lo = Math.min(a.midi, other);
      // petite terminaison (note inférieure puis note réelle) : absorbée
      let end = chain[chain.length - 1].end, lastStart = chain[chain.length - 1].start, extra = 0;
      for (let j = notes.indexOf(chain[chain.length - 1]) + 1; j < notes.length && extra < 2; j++) {
        const b = notes[j];
        if (b.start - lastStart > maxIoi) break;
        if (used.has(b) || !short(b) || Math.abs(b.midi - lo) > 2 || b.start <= lastStart) continue;
        used.add(b); end = b.end; lastStart = b.start; extra++;
      }
      chain.forEach((n) => used.add(n));
      out.push({ start: a.start, end, midi: lo, orn: 'tr' });
    }
    return out.concat(notes.filter((n) => !used.has(n)));
  }

  // Fichiers MIDI « joués » : chaque note est raccourcie d'un même pourcentage (ex. 70 % ou 83 % de sa valeur)
  // pour imiter le détaché. On cherche ce pourcentage (par piste) et on rend aux notes leur valeur écrite,
  // sinon chaque noire devient croche pointée + silence.
  const WRITTEN = [1920, 1440, 960, 720, 480, 360, 240, 180, 120, 90, 60];
  const DOTTED = new Set([1440, 720, 360, 180, 90]);
  function restoreArticulation(list, q) {
    const notes = list.slice().sort((a, b) => a.start - b.start);
    const onsets = [];
    for (const n of notes) if (!onsets.length || n.start - onsets[onsets.length - 1] > q / 2) onsets.push(n.start);
    let k = 0;
    const info = notes.map((n) => {
      while (k < onsets.length && onsets[k] <= n.start + q / 2) k++;
      const nx = k < onsets.length ? onsets[k] : null;
      const len = n.end - n.start;
      const exact = WRITTEN.some((d) => len >= d * 0.95 && len <= d * 1.03);
      const room = nx == null ? Infinity : nx - n.start + q / 4;
      return { n, nx, len, exact, cands: exact || len >= room ? [] : WRITTEN.filter((d) => d > len && d <= room) };
    });
    const loose = info.filter((x) => x.cands.length);
    if (loose.length < 8 || loose.length < notes.length * 0.25) return list;
    // pourcentage de jeu qui explique le plus de notes
    let best = null, bestN = 0;
    for (let g = 0.5; g <= 0.97; g += 0.01) {
      // une valeur simple (non pointée) est plus probable qu'une valeur pointée
      let c = 0;
      for (const x of loose) {
        let w = 0;
        for (const d of x.cands) if (Math.abs(x.len / d - g) < 0.03) w = Math.max(w, DOTTED.has(d) ? 0.8 : 1);
        c += w;
      }
      if (c > bestN) { bestN = c; best = g; }
    }
    const uniform = best && bestN >= loose.length * 0.6;
    return info.map((x) => {
      if (!x.cands.length) return x.n;
      let d = null;
      if (uniform) {
        let err = 0.05;
        for (const c of x.cands) { const e = Math.abs(x.len / c - best); if (e < err) { err = e; d = c; } }
      } else {
        // articulation variable d'une note à l'autre : jusqu'à la note suivante si possible,
        // sinon la valeur simple la plus proche (au moins 60 % de la note écrite)
        const ok = x.cands.filter((c) => x.len / c >= 0.6);
        d = ok.find((c) => x.nx != null && c === x.nx - x.n.start) || ok.filter((c) => !DOTTED.has(c)).pop() || ok.pop() || null;
      }
      return d ? Object.assign({}, x.n, { end: x.n.start + d }) : x.n;
    });
  }

  function midiToNotes(list, shift, fifths, q) {
    const qs = collapseTrills(restoreArticulation(list, q), q).map((n) => {
      const start = Math.round(n.start / q) * q;
      let end = Math.round(n.end / q) * q;
      if (end <= start) end = start + q;
      return { start, end, midi: n.midi - shift, orn: n.orn };
    }).sort((a, b) => a.start - b.start || a.midi - b.midi);
    const groups = [];
    for (const n of qs) {
      const g = groups[groups.length - 1];
      if (g && g.start === n.start) { if (!g.midis.includes(n.midi)) g.midis.push(n.midi); g.end = Math.max(g.end, n.end); if (n.orn) g.orn = n.orn; }
      else groups.push({ start: n.start, end: n.end, midis: [n.midi], orn: n.orn });
    }
    return groups.map((g, i) => {
      const next = groups[i + 1];
      const end = next ? Math.min(g.end, next.start) : g.end;
      const nn = { start: g.start, len: end - g.start, tie: false, pitches: g.midis.sort((a, b) => a - b).map((m) => M.spell(m, fifths)) };
      if (g.orn) nn.orn = g.orn;
      return nn;
    }).filter((n) => n.len > 0);
  }

  // ================================================================ point d'entrée
  async function importBytes(name, bytes) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const base = name.replace(/\.[^.]+$/, '').split(/[\\/]/).pop();
    if (ext === 'partoch' || ext === 'json') {
      return { score: M.normalizeScore(JSON.parse(new TextDecoder().decode(bytes))), warnings: [], native: true };
    }
    if (ext === 'mxl') return importMusicXML(await mxlToXml(bytes));
    if (ext === 'musicxml' || ext === 'xml') return importMusicXML(new TextDecoder().decode(bytes));
    if (ext === 'mid' || ext === 'midi') return importMIDI(bytes, { title: base });
    throw new Error('Format non reconnu : .' + ext);
  }


  // ================================================================ partitions scannées
  // Portées « Mélodie » (instrument inconnu) → la flûte dont la tessiture couvre le mieux les notes écrites
  function recordersForUnknownParts(sc) {
    const changed = [];
    sc.staves.forEach((st, ps) => {
      if (st.voiceOf || (st.inst !== 'melody' && st.inst !== 'melodyBass')) return;
      const lanes = M.lanesOf(sc, ps);
      const midis = [];
      for (const s of lanes) for (const n of sc.staves[s].notes) for (const p of n.pitches) midis.push(M.midiOf(p));
      if (!midis.length) return;
      const cands = st.clef === 'bass' || st.inst === 'melodyBass' ? ['bass'] : ['soprano', 'alto', 'tenor'];
      let best = null, bestOut = Infinity;
      for (const k of cands) {
        const [a, b] = M.INSTRUMENTS[k].range;
        const out = midis.filter((m) => m < a - 2 || m > b + 2).length;
        if (out < bestOut) { bestOut = out; best = k; }
      }
      if (!best || bestOut > midis.length * 0.2) return; // trop de notes hors tessiture : on laisse « Mélodie »
      for (const s of lanes) { sc.staves[s].inst = best; sc.staves[s].clef = M.INSTRUMENTS[best].clef; }
      changed.push(best);
    });
    return changed;
  }

  // Met bout à bout les partitions reconnues page par page (mêmes portées, dans le même ordre)
  function concatScores(list) {
    const base = list[0];
    const warnings = [];
    const baseParents = base.staves.map((st, i) => i).filter((i) => !base.staves[i].voiceOf);
    for (let k = 1; k < list.length; k++) {
      const sc = list[k];
      const offset = M.totalTicks(base, M.measureTable(base));
      const mOff = base.measures;
      const parents = sc.staves.map((st, i) => i).filter((i) => !sc.staves[i].voiceOf);
      if (parents.length !== baseParents.length) warnings.push(`Page ${k + 1} : ${parents.length} portée(s) au lieu de ${baseParents.length} — vérifiez cette page`);
      // métrique : changement au début de la page si besoin
      const endSig = M.sigAt(base, base.measures - 1);
      if (!M.sameSig(endSig, sc.timeSig)) base.sigChanges.push({ m: mOff, sig: sc.timeSig });
      for (const c of sc.sigChanges || []) base.sigChanges.push({ m: c.m + mOff, sig: c.sig });
      const pickupShift = sc.pickup ? M.sigLen(sc.timeSig) - sc.pickup : 0; // une « levée » en milieu de morceau : mesure complète
      parents.forEach((pi, j) => {
        if (j >= baseParents.length) return;
        const bp = baseParents[j];
        for (const s of M.lanesOf(sc, pi)) {
          const src = sc.staves[s];
          const dst = s === pi ? bp : M.laneFor(base, bp, src.voice || 2, true);
          const sh = (t) => t + offset + pickupShift;
          const d = base.staves[dst];
          d.notes = d.notes.concat(src.notes.map((n) => ({ ...n, start: sh(n.start) })));
          d.slurs = (d.slurs || []).concat((src.slurs || []).map((sl) => ({ ...sl, start: sh(sl.start), end: sh(sl.end) })));
          d.tuplets = (d.tuplets || []).concat((src.tuplets || []).map((sp) => ({ ...sp, start: sh(sp.start) })));
        }
        for (const tx of sc.texts || []) if (tx.sid === sc.staves[pi].id) base.texts.push({ ...tx, sid: base.staves[bp].id, t: tx.t + offset + pickupShift });
      });
      base.measures += sc.measures;
    }
    M.normalizeSigs(base);
    M.ensureMeasures(base, M.scoreEndTick(base));
    return { score: base, warnings };
  }

  P.io = { exportMusicXML, importMusicXML, exportMIDI, importMIDI, importBytes, parseMIDI, mxlToXml, recordersForUnknownParts, concatScores };
})();
