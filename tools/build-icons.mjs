// Génère src/js/icons.js : icônes musicales tirées de la police Bravura (SMuFL, licence SIL OFL,
// contours fournis par VexFlow) + icônes d'interface dessinées à la main, dans un seul style.
// Usage : node tools/build-icons.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { BravuraFont } = await import('file://' + path.join(root, 'node_modules/vexflow/build/esm/src/fonts/bravura_glyphs.js').replace(/\\/g, '/'));
const G = BravuraFont.glyphs;
const SP = 360; // un interligne, en unités des contours

// contour VexFlow (y vers le haut, « b x y c1x c1y c2x c2y ») → chemin SVG (y vers le bas)
function glyphPath(name, dx = 0, dy = 0, s = 1) {
  const t = G[name].o.trim().split(/\s+/);
  let d = '', i = 0;
  const X = (v) => +(dx + s * +v).toFixed(1), Y = (v) => +(-(dy + s * +v)).toFixed(1);
  const pts = [];
  while (i < t.length) {
    const c = t[i++];
    if (c === 'm') { const x = t[i++], y = t[i++]; d += `M${X(x)} ${Y(y)}`; pts.push([X(x), Y(y)]); }
    else if (c === 'l') { const x = t[i++], y = t[i++]; d += `L${X(x)} ${Y(y)}`; pts.push([X(x), Y(y)]); }
    else if (c === 'b') { const x = t[i++], y = t[i++], a = t[i++], b = t[i++], e = t[i++], f = t[i++]; d += `C${X(a)} ${Y(b)} ${X(e)} ${Y(f)} ${X(x)} ${Y(y)}`; pts.push([X(x), Y(y)], [X(a), Y(b)], [X(e), Y(f)]); }
    else if (c === 'q') { const x = t[i++], y = t[i++], a = t[i++], b = t[i++]; d += `Q${X(a)} ${Y(b)} ${X(x)} ${Y(y)}`; pts.push([X(x), Y(y)], [X(a), Y(b)]); }
    else if (c === 'z') d += 'Z';
  }
  return { d, pts };
}
const rect = (x0, y0, x1, y1) => ({ d: `M${x0} ${-y0}H${x1}V${-y1}H${x0}Z`, pts: [[x0, -y0], [x1, -y1]] });

// note complète : tête + hampe + crochets (hampe vers le haut)
function note(head, flags, ox = 0, oy = 0, s = 1) {
  const parts = [glyphPath(head, ox, oy, s)];
  if (head !== 'noteheadWhole') {
    const hx = ox + s * 425, sw = s * 0.12 * SP, top = oy + s * 3.5 * SP;
    parts.push(rect(+(hx - sw).toFixed(1), oy + s * 60, +hx.toFixed(1), +top.toFixed(1)));
    if (flags) parts.push(glyphPath(['', 'flag8thUp', 'flag16thUp', 'flag32ndUp'][flags], hx - sw, top, s));
  }
  return parts;
}

const H = 1500; // hauteur commune de la boîte : toutes les icônes musicales à la même échelle
function music(parts, extra = '', opts = {}) {
  const pts = parts.flatMap((p) => p.pts);
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  if (opts.bbox) [x0, y0, x1, y1] = opts.bbox;
  const pad = 70, w = Math.max(x1 - x0 + 2 * pad, opts.minW || 0);
  const cx = (x0 + x1) / 2, cy = opts.cy != null ? opts.cy : (y0 + y1) / 2;
  const vb = [cx - w / 2, cy - H / 2, w, H].map((v) => +v.toFixed(1));
  return `<svg class="mi" viewBox="${vb.join(' ')}" aria-hidden="true"><path fill="currentColor" d="${parts.map((p) => p.d).join('')}"/>${extra}</svg>`;
}

const icons = {};
// durées
icons.w = music([glyphPath('noteheadWhole', 0, 0, 1.45)]);
icons.h = music(note('noteheadHalf', 0));
icons.q = music(note('noteheadBlack', 0));
icons['8'] = music(note('noteheadBlack', 1));
icons['16'] = music(note('noteheadBlack', 2));
icons['32'] = music(note('noteheadBlack', 3));
icons.dot = music([glyphPath('augmentationDot', 0, 0, 3)], '', { minW: 700 });
icons.rest = music([glyphPath('restQuarter', 0, 0, 1.15)]);
// altérations
icons.sharp = music([glyphPath('accidentalSharp', 0, 0, 1.45)]);
icons.flat = music([glyphPath('accidentalFlat', 0, 0, 1.45)]);
icons.natural = music([glyphPath('accidentalNatural', 0, 0, 1.45)]);
// petite note barrée : note réduite + barre
{
  const s = 0.62, parts = note('noteheadBlack', 1, 0, 0, s);
  const slash = `<path d="M${-40} ${-0.9 * SP} L${0.62 * 520} ${-2.4 * SP}" stroke="currentColor" stroke-width="45" stroke-linecap="round"/>`;
  icons.grace = music(parts, slash, { bbox: [-60, -2.9 * SP, 420, 0.5 * SP] });
}
// accord : trois têtes empilées
icons.chord = music([glyphPath('noteheadBlack', 0, 0), glyphPath('noteheadBlack', 0, SP), glyphPath('noteheadBlack', 0, 2 * SP),
  rect(425 - 43, 60, 425, 2 * SP + 3.2 * SP)]);
// liaison de prolongation : deux têtes reliées
{
  const parts = [glyphPath('noteheadBlack', 0, 0), glyphPath('noteheadBlack', 1150, 0)];
  const arc = `<path d="M330 290 C 560 560, 1010 560, 1240 290 C 1010 470, 560 470, 330 290 Z" fill="currentColor"/>`;
  icons.tie = music(parts, arc, { bbox: [0, -200, 1575, 560] });
}
// liaison d'expression : arc seul
icons.slur = music([{ d: 'M0 0 C 300 -480, 1300 -480, 1600 0 C 1300 -380, 300 -380, 0 0 Z', pts: [[0, 0], [1600, -480]] }], '', { cy: -240 });
// liaison de phrasé : grand arc au-dessus de trois notes
{
  const parts = [glyphPath('noteheadBlack', 0, 0, 0.7), glyphPath('noteheadBlack', 560, 0.5 * SP, 0.7), glyphPath('noteheadBlack', 1120, 0.25 * SP, 0.7),
    { d: 'M-40 -560 C 350 -1000, 1050 -1000, 1460 -560 C 1050 -900, 350 -900, -40 -560 Z', pts: [[-40, -560], [1460, -1000]] }];
  icons.phrase = music(parts);
}
icons.breath = music([glyphPath('breathMarkComma', 0, 0, 2)]);
icons.trill = music([glyphPath('ornamentTrill', 0, 0, 1.5)]);
// nuances (mf), articulations (accent + staccato), ornements (mordant)
icons.dyn = music([glyphPath('dynamicMezzo', 0, 0, 1.25), glyphPath('dynamicForte', 1.25 * 760, 0, 1.25)]);
icons.artic = music([glyphPath('articAccentAbove', 0, 0.9 * SP, 1.6), glyphPath('articStaccatoAbove', 200, 0, 1.6)]);
icons.orn = music([glyphPath('ornamentMordent', 0, 0, 1.6)]);
icons.fermata = music([glyphPath('fermataAbove', 0, 0, 1.4)]);
// barre de reprise : trait épais, trait fin, deux points
icons.repeat = music([rect(0, -2 * SP, 150, 2 * SP), rect(290, -2 * SP, 340, 2 * SP), glyphPath('augmentationDot', 470, 0.5 * SP, 1.6), glyphPath('augmentationDot', 470, -0.5 * SP, 1.6)], '', { bbox: [0, -2 * SP, 700, 2 * SP] });
// tempo : noire = 
icons.tempo = music([...note('noteheadBlack', 0, 0, 0, 0.85), rect(620, 0.55 * SP, 1050, 0.72 * SP), rect(620, 1.05 * SP, 1050, 1.22 * SP)], '', { bbox: [0, -0.4 * SP, 1050, 3.1 * SP] });
// triolet : crochet + 3
{
  const three = glyphPath('timeSig3', 430, 520, 0.85);
  const br = `<path d="M60 -330 V -560 H 420 M 900 -560 H 1260 V -330" fill="none" stroke="currentColor" stroke-width="55" stroke-linejoin="round"/>`;
  icons.tuplet = music([three], br, { bbox: [40, -1020, 1280, -300] });
}

// ---- icônes d'interface : grille 20×20, trait 1,6, bouts arrondis ----
const ui = (body, vb = '0 0 20 20') => `<svg class="ui" viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
Object.assign(icons, {
  select: ui('<path d="M5 3.5 L5 15.5 L8.2 12.6 L10.4 17 L12.3 16.1 L10.1 11.8 L14.5 11.6 Z"/>'),
  pencil: ui('<path d="M13.5 3.5 l3 3 L7 16 H4 v-3 Z"/><path d="M11.5 5.5 l3 3"/>'),
  undo: ui('<path d="M7.5 6 L4 9.5 L7.5 13"/><path d="M4.5 9.5 H12 a4 4 0 0 1 0 8 H9"/>'),
  redo: ui('<path d="M12.5 6 L16 9.5 L12.5 13"/><path d="M15.5 9.5 H8 a4 4 0 0 0 0 8 H11"/>'),
  rewind: ui('<path d="M5 4.5 V15.5"/><path d="M15.5 4.8 V15.2 L7.5 10 Z" fill="currentColor"/>'),
  play: ui('<path d="M6.5 4.2 V15.8 L16 10 Z" fill="currentColor"/>'),
  pause: ui('<path d="M7 4.5 V15.5 M13 4.5 V15.5" stroke-width="2.6"/>'),
  loop: ui('<path d="M4 9 V8 a3 3 0 0 1 3 -3 H15.5"/><path d="M13.5 2.8 L15.8 5 L13.5 7.2"/><path d="M16 11 V12 a3 3 0 0 1 -3 3 H4.5"/><path d="M6.5 12.8 L4.2 15 L6.5 17.2"/>'),
  metronome: ui('<path d="M7.6 3 H12.4 L16 17 H4 Z"/><path d="M4.8 13.8 H15.2"/><path d="M10 13.8 L14.6 5.6"/>'),
  countin: ui('<circle cx="10" cy="11" r="6"/><path d="M10 11 V7.8 M8 2.8 H12 M15 5.5 L16.3 4.2"/>'),
  tracks: ui('<path d="M3.5 6 H16.5 M3.5 10 H16.5 M3.5 14 H16.5"/><circle cx="7" cy="6" r="1.7" fill="var(--chrome)"/><circle cx="13" cy="10" r="1.7" fill="var(--chrome)"/><circle cx="9" cy="14" r="1.7" fill="var(--chrome)"/>'),
  mic: ui('<rect x="7.2" y="2.8" width="5.6" height="9.4" rx="2.8"/><path d="M4.6 9.6 a5.4 5.4 0 0 0 10.8 0"/><path d="M10 15 V17.5 M7 17.5 H13"/>'),
  record: ui('<circle cx="10" cy="10" r="5" fill="currentColor" stroke="none"/>'),
  stop: ui('<rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none"/>'),
  file: ui('<path d="M5 2.8 H11.5 L15.5 6.8 V17.2 H5 Z"/><path d="M11.3 3 V7 H15.3"/>'),
  open: ui('<path d="M2.8 15.8 V4.5 H7.5 L9.2 6.3 H15.2 V8.5"/><path d="M2.8 15.8 L5.2 9 H17.6 L15.2 15.8 Z"/>'),
  save: ui('<path d="M4 3.5 H13.5 L16.5 6.5 V16.5 H4 Z"/><path d="M7 3.5 V7.5 H12.5 V3.5"/><rect x="6.5" y="11" width="7" height="5.5"/>'),
  scan: ui('<path d="M3 13.5 H17 V16.5 H3 Z"/><path d="M5.5 13.5 V3.5 H12.5 L14.5 5.5 V13.5"/><path d="M1.8 10.8 H18.2" stroke-dasharray="1.6 1.6"/>'),
  exportI: ui('<path d="M10 12.5 V3"/><path d="M6.5 6.5 L10 3 L13.5 6.5"/><path d="M4 11 V16.5 H16 V11"/>'),
  print: ui('<path d="M6 7.5 V3.5 H14 V7.5"/><rect x="3" y="7.5" width="14" height="6.5" rx="1.5"/><path d="M6 12 H14 V16.5 H6 Z" fill="var(--chrome2)"/>'),
  settings: ui('<path d="M3.5 6 H9 M13 6 H16.5 M3.5 14 H6 M10 14 H16.5"/><circle cx="11" cy="6" r="2"/><circle cx="8" cy="14" r="2"/>'),
  transpose: ui('<path d="M7 16 V4 M4 7 L7 4 L10 7"/><path d="M13 4 V16 M10 13 L13 16 L16 13"/>'),
  plus: ui('<path d="M10 4.5 V15.5 M4.5 10 H15.5"/>'),
  minus: ui('<path d="M4.5 10 H15.5"/>'),
  measureAdd: ui('<path d="M3 5 V15 M11 5 V15"/><path d="M3 7.5 H11 M3 10 H11 M3 12.5 H11" stroke-width="1" opacity=".55"/><path d="M15 7 V13 M12 10 H18"/>'),
  measureDel: ui('<path d="M3 5 V15 M11 5 V15"/><path d="M3 7.5 H11 M3 10 H11 M3 12.5 H11" stroke-width="1" opacity=".55"/><path d="M12.5 10 H18"/>'),
  text: ui('<path d="M4.5 5.5 V4 H15.5 V5.5 M10 4 V16 M7.5 16 H12.5"/>'),
  chevron: ui('<path d="M6 8 L10 12 L14 8"/>'),
  close: ui('<path d="M5.5 5.5 L14.5 14.5 M14.5 5.5 L5.5 14.5"/>'),
  menu: ui('<path d="M4 6 H16 M4 10 H16 M4 14 H16"/>'),
  warn: ui('<path d="M10 3 L18 16.5 H2 Z"/><path d="M10 8 V11.5 M10 14 V14.2" stroke-width="1.9"/>'),
  zoom: ui('<circle cx="8.5" cy="8.5" r="5"/><path d="M12.3 12.3 L16.5 16.5"/>'),
  gear: ui(`<path d="${cog(10, 10, 7.2, 5.4, 8)}"/><circle cx="10" cy="10" r="2.3"/>`),
  fork: ui('<path d="M7 2.5 V9 a3 3 0 0 0 6 0 V2.5"/><path d="M10 12 V17.5"/>'),
  keyboard: ui('<rect x="2.5" y="5" width="15" height="10" rx="1.8"/><path d="M5.5 8 H6 M8.3 8 H8.8 M11.2 8 H11.7 M14 8 H14.5 M5.5 10.6 H6 M14 10.6 H14.5 M7.8 12.4 H12.2" stroke-width="1.5"/>'),
});

// roue dentée : n dents, rayon extérieur R, intérieur r
function cog(cx, cy, R, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, step = (Math.PI * 2) / n;
    for (const [f, rad] of [[0.02, r], [0.16, R], [0.46, R], [0.6, r]]) {
      const a = a0 + f * step;
      pts.push((cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2));
    }
  }
  return 'M' + pts.join(' L') + ' Z';
}

const out = `// Icônes de Partoch — fichier généré par tools/build-icons.mjs (ne pas modifier à la main)
// Icônes musicales : police Bravura (SMuFL), © Steinberg Media Technologies, licence SIL Open Font License 1.1.
(function () {
  const P = (window.P = window.P || {});
  const ICONS = ${JSON.stringify(icons, null, 0).replace(/","/g, '",\n    "')};
  P.icons = ICONS;
  P.icon = (name) => ICONS[name] || '';
  // remplit tous les éléments <… data-icon="nom"> (avant le texte éventuel)
  P.applyIcons = (rootEl) => {
    (rootEl || document).querySelectorAll('[data-icon]').forEach((el) => {
      if (el.querySelector(':scope > svg')) return;
      el.insertAdjacentHTML('afterbegin', ICONS[el.dataset.icon] || '');
    });
  };
})();
`;
fs.writeFileSync(path.join(root, 'src', 'js', 'icons.js'), out);
console.log(Object.keys(icons).length + ' icônes → src/js/icons.js (' + (out.length / 1024).toFixed(0) + ' Ko)');
