// Raccourcis clavier de Partoch : liste des actions, touches par défaut, réglages de l'utilisateur
(function () {
  const P = (window.P = window.P || {});
  const STORE = 'partoch.keys';

  // [id, nom, touches par défaut, groupe]
  const ACTIONS = [
    ['play', 'Lecture / pause', ['Space'], 'Lecture'],
    ['rewind', 'Revenir au début', ['Home'], 'Lecture'],
    ['record', 'Enregistrer au micro', ['R'], 'Lecture'],
    ['loop', 'Boucle', [], 'Lecture'],
    ['metronome', 'Métronome', [], 'Lecture'],
    ['countIn', 'Décompte', [], 'Lecture'],

    ['mode', 'Sélection / Écriture', ['N'], 'Écriture'],
    ['dur_w', 'Ronde', ['7'], 'Écriture'],
    ['dur_h', 'Blanche', ['6'], 'Écriture'],
    ['dur_q', 'Noire', ['5'], 'Écriture'],
    ['dur_8', 'Croche', ['4'], 'Écriture'],
    ['dur_16', 'Double croche', ['3'], 'Écriture'],
    ['dur_32', 'Triple croche', ['2'], 'Écriture'],
    ['dot', 'Point', ['.'], 'Écriture'],
    ['rest', 'Silence', ['0'], 'Écriture'],
    ['tuplet', 'Triolet', ['Ctrl+3'], 'Écriture'],
    ['grace', 'Petite note', [], 'Écriture'],
    ['chord', 'Accord', [], 'Écriture'],
    ['voice1', 'Voix 1', ['Ctrl+Alt+1'], 'Écriture'],
    ['voice2', 'Voix 2', ['Ctrl+Alt+2'], 'Écriture'],
    ['sharp', 'Dièse', [], 'Écriture'],
    ['flat', 'Bémol', [], 'Écriture'],
    ['natural', 'Bécarre', [], 'Écriture'],
    ['tie', 'Liaison de prolongation', ['T'], 'Écriture'],
    ['slur', "Liaison d'expression", ['S'], 'Écriture'],
    ['phrase', 'Liaison de phrasé', ['P'], 'Écriture'],
    ['breath', 'Respiration', [',', ';'], 'Écriture'],
    ['trill', 'Trille', ['Shift+T'], 'Écriture'],
    ['staccato', 'Staccato', ['Shift+S'], 'Écriture'],
    ['tenuto', 'Tenuto', ['Shift+N'], 'Écriture'],
    ['accent', 'Accent', ['Shift+V'], 'Écriture'],
    ['marcato', 'Marcato', ['Shift+O'], 'Écriture'],
    ['fermata', "Point d'orgue", ['Shift+H'], 'Écriture'],
    ['cresc', 'Crescendo', ['<'], 'Écriture'],
    ['dim', 'Decrescendo', ['>'], 'Écriture'],
    ['text', 'Texte', ['Ctrl+T'], 'Écriture'],
    ['lyrics', 'Paroles', ['Ctrl+L'], 'Écriture'],
    ['chordSym', 'Accord chiffré', ['Ctrl+K'], 'Écriture'],
    ['figures', 'Basse chiffrée', ['Ctrl+G'], 'Écriture'],
    ['tempoMark', 'Indication de tempo', ['Alt+T'], 'Écriture'],
    ['addMeasure', 'Ajouter une mesure', ['Ctrl+B'], 'Écriture'],
    ['delMeasure', 'Supprimer la mesure', [], 'Écriture'],

    ['semiUp', 'Demi-ton plus haut', ['ArrowUp'], 'Déplacement'],
    ['semiDown', 'Demi-ton plus bas', ['ArrowDown'], 'Déplacement'],
    ['stepUp', 'Degré plus haut', ['Alt+ArrowUp'], 'Déplacement'],
    ['stepDown', 'Degré plus bas', ['Alt+ArrowDown'], 'Déplacement'],
    ['octUp', 'Octave plus haut', ['Ctrl+ArrowUp'], 'Déplacement'],
    ['octDown', 'Octave plus bas', ['Ctrl+ArrowDown'], 'Déplacement'],
    ['prev', 'Note précédente', ['ArrowLeft'], 'Déplacement'],
    ['next', 'Note suivante', ['ArrowRight'], 'Déplacement'],
    ['staffUp', 'Portée au-dessus', ['PageUp'], 'Déplacement'],
    ['staffDown', 'Portée en dessous', ['PageDown'], 'Déplacement'],

    ['undo', 'Annuler', ['Ctrl+Z'], 'Édition'],
    ['redo', 'Rétablir', ['Ctrl+Y', 'Ctrl+Shift+Z'], 'Édition'],
    ['copy', 'Copier', ['Ctrl+C'], 'Édition'],
    ['cut', 'Couper', ['Ctrl+X'], 'Édition'],
    ['paste', 'Coller', ['Ctrl+V'], 'Édition'],
    ['selectAll', 'Tout sélectionner', ['Ctrl+A'], 'Édition'],
    ['transpose', 'Transposer', [], 'Édition'],
    ['durDouble', 'Doubler les durées', [], 'Édition'],
    ['durHalve', 'Diviser les durées par deux', [], 'Édition'],
    ['repeatSel', 'Répéter la sélection', ['Ctrl+R'], 'Édition'],
    ['goTo', 'Aller à la mesure', ['Ctrl+F'], 'Édition'],

    ['new', 'Nouvelle partition', ['Ctrl+N'], 'Fichier'],
    ['open', 'Ouvrir', ['Ctrl+O'], 'Fichier'],
    ['save', 'Enregistrer', ['Ctrl+S'], 'Fichier'],
    ['saveAs', 'Enregistrer sous', ['Ctrl+Shift+S'], 'Fichier'],
    ['exportPdf', 'Exporter en PDF', ['Ctrl+E'], 'Fichier'],
    ['print', 'Imprimer', ['Ctrl+P'], 'Fichier'],
    ['layout', 'Mise en page', [], 'Fichier'],
    ['exportParts', 'Exporter les parties', [], 'Fichier'],

    ['zoomIn', 'Zoomer', ['Ctrl++', 'Ctrl+='], 'Affichage'],
    ['zoomOut', 'Dézoomer', ['Ctrl+-'], 'Affichage'],
    ['zoomReset', 'Zoom 100 %', ['Ctrl+0'], 'Affichage'],
  ];
  const DEFAULTS = {};
  const NAMES = {};
  ACTIONS.forEach(([id, name, keys]) => { DEFAULTS[id] = keys; NAMES[id] = name; });

  // touches que l'on ne peut pas attribuer : Échap, Suppr, Entrée… et les lettres A–G (écriture des notes)
  const RESERVED = new Set(['Escape', 'Delete', 'Backspace', 'Enter', 'Tab', 'F2']);
  function reservedReason(combo) {
    if (RESERVED.has(combo)) return 'réservée';
    if (/^(Shift\+)?[A-G]$/.test(combo)) return 'sert à écrire les notes';
    return null;
  }

  let user = {};
  try { user = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { user = {}; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(user)); } catch (e) { /* */ } };

  const keysOf = (id) => (Object.prototype.hasOwnProperty.call(user, id) ? user[id] : DEFAULTS[id]) || [];

  // événement clavier → « Ctrl+Alt+Shift+Touche »
  function comboOf(e) {
    let k = e.key;
    if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Dead') return null;
    const ctrl = e.ctrlKey || e.metaKey, alt = e.altKey;
    // chiffres avec Ctrl/Alt : touche physique (claviers AZERTY)
    if ((ctrl || alt) && /^(Digit|Numpad)[0-9]$/.test(e.code)) k = e.code.slice(-1);
    let shift = e.shiftKey;
    if (k === ' ') k = 'Space';
    else if (k.length === 1) {
      if (/[a-z]/i.test(k)) k = k.toUpperCase();
      else shift = false; // ponctuation, chiffres : le caractère suffit
    }
    return (ctrl ? 'Ctrl+' : '') + (alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + k;
  }

  const KEY_FR = { Space: 'Espace', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Page ↑', PageDown: 'Page ↓', Home: 'Origine', End: 'Fin', Insert: 'Inser' };
  function label(combo) {
    if (!combo) return '';
    let rest = combo;
    const parts = [];
    for (const [m, fr] of [['Ctrl+', 'Ctrl'], ['Alt+', 'Alt'], ['Shift+', 'Maj']]) {
      if (rest.startsWith(m) && rest.length > m.length) { parts.push(fr); rest = rest.slice(m.length); }
    }
    parts.push(KEY_FR[rest] || rest);
    return parts.join('+');
  }

  function find(combo) {
    for (const [id] of ACTIONS) if (keysOf(id).includes(combo)) return id;
    return null;
  }

  function set(id, combo) {
    // la touche est retirée de l'action qui l'avait
    for (const [o] of ACTIONS) {
      if (o === id) continue;
      const ks = keysOf(o);
      if (ks.includes(combo)) user[o] = ks.filter((x) => x !== combo);
    }
    user[id] = combo ? [combo] : [];
    save();
  }
  function reset(id) {
    if (id) delete user[id];
    else user = {};
    save();
  }
  const isCustom = (id) => Object.prototype.hasOwnProperty.call(user, id);

  P.keys = { ACTIONS, NAMES, keysOf, comboOf, label, find, set, reset, isCustom, reservedReason, shortcut: (id) => label(keysOf(id)[0]) };
})();
