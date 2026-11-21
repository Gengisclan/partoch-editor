// Partoch editor — processus principal Electron
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const scan = require('./scan.js');

// version portable (clé USB) : partitions, réglages et sauvegarde automatique restent à côté du .exe
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || null;
if (portableDir) app.setPath('userData', path.join(portableDir, 'Partoch - données'));
// mode test : profil séparé pour ne jamais toucher à la sauvegarde automatique de l'utilisateur
if (process.env.PARTOCH_SNAPSHOT) app.setPath('userData', path.join(require('os').tmpdir(), 'partoch-test-profile'));

let win = null;
let dirty = false;
let forceQuit = false;
// dossier des partitions : à côté du .exe (portable), dans Documents (installé), ou dans le projet (développement)
const scoresDir = portableDir ? path.join(portableDir, 'Partitions')
  : app.isPackaged ? path.join(app.getPath('documents'), 'Partoch') : path.join(__dirname, 'Partitions');
let lastDir = scoresDir;

function ensureScoresDir() {
  try { fs.mkdirSync(scoresDir, { recursive: true }); } catch (e) { /* ignore */ }
}
function sanitize(name) {
  return String(name || 'partition').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}
function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(partoch|musicxml|mxl|xml|mid|midi|mp3|wav|m4a|aac|ogg|opus|flac|webm|mp4|png|jpe?g|tiff?|bmp|pdf)$/i.test(a) && fs.existsSync(a)) || null;
}

function createWindow() {
  Menu.setApplicationMenu(null); // pas de menus : tout est dans la barre d'outils
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#17191d', title: 'Partoch editor', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // relaie les erreurs de la page dans le terminal (pratique pour déboguer)
  win.webContents.on('console-message', (e) => {
    const lvl = e.level;
    if (lvl === 'warning' || lvl === 'error' || lvl >= 2) console.log(`[page] ${e.message} (${String(e.sourceId || '').split('/').pop()}:${e.lineNumber})`);
  });
  // mode vérification : PARTOCH_SNAPSHOT=fichier.png → capture + état, puis quitte
  if (process.env.PARTOCH_SNAPSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const state = await win.webContents.executeJavaScript(
        '(async () => JSON.stringify({api: !!window.api, svg: !!document.querySelector("#score svg"), staves: PartochState.score.staves.length, audio: P.audio.ready, samples: Object.keys(P.audio.buffers).length, mic: !!(P.mic && P.mic.supported()), worklet: await P.mic.ensureWorklet().then(() => true, (e) => String(e)), basicPitch: await (async () => { try { await P.audioImport.lib(); const x = new Float32Array(22050 * 2); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 22050) * (i > 2205 && i < 33075 ? 1 : 0); const raw = await P.audioImport.analyze(x, () => {}); return P.audioImport.extractNotes(raw, "normal").map((n) => n.pitch).join(","); } catch (e) { return String(e); } })()}))()');
      console.log('[snapshot] ' + state);
      if (process.env.PARTOCH_PDF) {
        // partition de démonstration longue → PDF, pour vérifier la pagination
        const pages = await win.webContents.executeJavaScript(`(() => {
          const M = P.model, sc = M.newScore({ title: 'Test PDF', composer: 'Partoch', instruments: ['soprano', 'piano'], measures: 48, fifths: 2 });
          for (let i = 0; i < 48 * 4; i++) {
            M.placeNote(sc, 0, i * 480, 480, [M.spell(74 + ((i * 5) % 12), 2)], { dur: 'q', dots: 0 });
            if (i % 2 === 0) M.placeNote(sc, 1, i * 480, 960, [M.spell(67 + (i % 7), 2), M.spell(71 + (i % 7), 2)], { dur: 'h', dots: 0 });
            if (i % 4 === 0) M.placeNote(sc, 2, i * 480, 1920, [M.spell(43 + (i % 5), 2)], { dur: 'w', dots: 0 });
          }
          sc.staves[0].notes[5].pitches = [M.spell(100, 2)];
          PartochDebug.loadScore(sc);
          return PartochDebug.buildPrintArea();
        })()`);
        const pdf = await win.webContents.printToPDF({ printBackground: false, preferCSSPageSize: true });
        fs.writeFileSync(process.env.PARTOCH_PDF, pdf);
        console.log('[pdf] pages=' + pages + ' bytes=' + pdf.length);
      }
      if (process.env.PARTOCH_EVAL) console.log('[eval] ' + await win.webContents.executeJavaScript(process.env.PARTOCH_EVAL)); // tests
      if (process.env.PARTOCH_OMR) {
        // lecture d'une partition scannée (PDF / image), comme « Ouvrir »
        const r = await win.webContents.executeJavaScript(`PartochDebug.omrImport([${JSON.stringify(process.env.PARTOCH_OMR)}], 'Test OMR').then(() => JSON.stringify({ title: PartochState.score.title, measures: PartochState.score.measures, staves: PartochState.score.staves.map((s) => s.inst + ':' + s.notes.length), modal: document.querySelector('#modal h2') && document.querySelector('#modal h2').textContent }))`);
        console.log('[omr] ' + r);
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.PARTOCH_SNAPSHOT, img.toPNG());
      fs.writeFileSync(process.env.PARTOCH_SNAPSHOT + '.txt', `scores=${scoresDir}\nuserData=${app.getPath('userData')}\nportable=${portableDir}\n`);
      forceQuit = true; app.quit();
    }, 4000));
  }
  win.webContents.on('did-finish-load', () => {
    const f = fileFromArgs(process.argv);
    if (f) win.webContents.send('open-path', readForRenderer(f));
  });
  win.webContents.once('did-finish-load', () => setTimeout(checkUpdates, 5000));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (input.key === 'F5' && input.control) win.webContents.reloadIgnoringCache();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (!dirty || forceQuit) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', title: 'Partoch editor',
      buttons: ['Enregistrer', 'Quitter sans enregistrer', 'Annuler'], defaultId: 0, cancelId: 2,
      message: 'Enregistrer les modifications avant de quitter ?',
    });
    if (r === 0) win.webContents.send('command', 'save-before-quit');
    else if (r === 1) { if (updatePending) installUpdate(); else { forceQuit = true; win.close(); } }
    else updatePending = false;
  });
}

// ------------------------------------------------------------------ mises à jour
// version installée : téléchargement discret puis « Redémarrer » ; version portable : simple avis
const RELEASES_URL = 'https://github.com/Gengisclan/partoch-editor/releases/latest';
let updater = null;
let updatePending = false;
function sendUpdate(u) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('update-status', u);
  // essai : PARTOCH_UPDATE_DRYRUN=1 affiche le bouton obtenu puis quitte sans rien installer
  if (process.env.PARTOCH_UPDATE_DRYRUN) setTimeout(async () => {
    const ui = '[update] ui ' + await win.webContents.executeJavaScript("(b => b.hidden ? 'hidden' : b.textContent)(document.querySelector('#updBtn'))");
    console.log(ui);
    if (/[\\/]/.test(process.env.PARTOCH_UPDATE_DRYRUN)) fs.appendFileSync(process.env.PARTOCH_UPDATE_DRYRUN, ui + '\n');
    forceQuit = true; app.quit();
  }, 1000);
}
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
async function checkPortableUpdate() {
  try {
    const { net } = require('electron');
    const r = await net.fetch('https://api.github.com/repos/Gengisclan/partoch-editor/releases/latest', { headers: { 'User-Agent': 'Partoch-editor', Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const tag = String((await r.json()).tag_name || '');
    if (/^v?\d+\.\d+\.\d+$/.test(tag) && newer(tag, app.getVersion())) sendUpdate({ kind: 'available', version: tag.replace(/^v/, '') });
  } catch (e) { /* hors ligne : rien */ }
}
function checkUpdates() {
  if (!app.isPackaged || process.env.PARTOCH_SNAPSHOT) return;
  if (portableDir) { checkPortableUpdate(); return; }
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = !process.env.PARTOCH_UPDATE_DRYRUN;
    updater.logger = null;
    updater.on('update-downloaded', (info) => { console.log('[update] ready ' + info.version); sendUpdate({ kind: 'ready', version: info.version }); });
    updater.on('update-available', (info) => console.log('[update] available ' + info.version));
    updater.on('update-not-available', () => console.log('[update] none'));
    updater.on('error', (err) => console.log('[update] error ' + (err && err.message)));
    updater.checkForUpdates().catch(() => {});
  } catch (e) { /* ignore */ }
}
function installUpdate() {
  if (!updater) return;
  forceQuit = true;
  updater.quitAndInstall(true, true);
}

function readForRenderer(p) {
  // images et PDF : la reconnaissance lit le fichier elle-même, inutile de l'envoyer à la page
  if (/\.(png|jpe?g|tiff?|bmp|pdf)$/i.test(p)) return { path: p, base64: '' };
  return { path: p, base64: fs.readFileSync(p).toString('base64') };
}
ipcMain.handle('open-file', async () => {
  ensureScoresDir();
  const r = await dialog.showOpenDialog(win, {
    title: 'Ouvrir une partition', defaultPath: lastDir, properties: ['openFile'],
    filters: [
      { name: 'Partitions, enregistrements et images', extensions: ['partoch', 'musicxml', 'mxl', 'xml', 'mid', 'midi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'webm', 'mp4', 'pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'] },
      { name: 'Partition Partoch', extensions: ['partoch'] },
      { name: 'MusicXML', extensions: ['musicxml', 'mxl', 'xml'] },
      { name: 'MIDI', extensions: ['mid', 'midi'] },
      { name: 'Enregistrement audio (transcription)', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'webm', 'mp4'] },
      { name: 'Partition scannée ou photographiée (PDF, image)', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  lastDir = path.dirname(p);
  return readForRenderer(p);
});
ipcMain.handle('read-path', async (e, p) => (p && fs.existsSync(p) ? readForRenderer(p) : null));

ipcMain.handle('export-file', async (e, { suggested, filterName, ext, data, encoding }) => {
  ensureScoresDir();
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter', defaultPath: path.join(lastDir, sanitize(suggested)),
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8'));
  lastDir = path.dirname(r.filePath);
  return r.filePath;
});

ipcMain.handle('export-pdf', async (e, { suggested }) => {
  ensureScoresDir();
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter en PDF', defaultPath: path.join(lastDir, sanitize(suggested)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const pdf = await win.webContents.printToPDF({ printBackground: false, preferCSSPageSize: true });
  fs.writeFileSync(r.filePath, pdf);
  lastDir = path.dirname(r.filePath);
  return r.filePath;
});

// parties séparées : un dossier choisi par l'utilisateur, puis un PDF par partie (uniquement dans ce dossier)
let partsDir = null;
ipcMain.handle('choose-dir', async () => {
  ensureScoresDir();
  const r = await dialog.showOpenDialog(win, { title: 'Dossier des parties', defaultPath: lastDir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  partsDir = lastDir = r.filePaths[0];
  return partsDir;
});
ipcMain.handle('export-pdf-to', async (e, { dir, name }) => {
  if (!partsDir || dir !== partsDir) return null;
  const file = path.join(partsDir, sanitize(String(name || 'partie.pdf')));
  if (path.dirname(file) !== partsDir || !/\.pdf$/i.test(file)) return null;
  const pdf = await win.webContents.printToPDF({ printBackground: false, preferCSSPageSize: true });
  fs.writeFileSync(file, pdf);
  return file;
});

ipcMain.handle('print', async () => new Promise((resolve) => {
  win.webContents.print({ printBackground: false }, (ok, reason) => resolve(ok ? true : reason));
}));

ipcMain.handle('open-external-path', async (e, p) => { if (p && fs.existsSync(p)) await shell.openPath(p); });

ipcMain.handle('save-file', async (e, { path: p, content, suggested }) => {
  if (!p) {
    ensureScoresDir();
    const r = await dialog.showSaveDialog(win, {
      title: 'Enregistrer la partition', defaultPath: path.join(lastDir, sanitize(suggested)),
      filters: [{ name: 'Partition Partoch', extensions: ['partoch'] }],
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, content, 'utf8');
  lastDir = path.dirname(p);
  return p;
});

// ---- scanner et reconnaissance de partitions ----
const OMR_EXT = /\.(png|jpe?g|tiff?|bmp|pdf)$/i;
ipcMain.handle('omr-status', async () => ({ audiveris: !!scan.audiverisPath(), windows: process.platform === 'win32' }));
ipcMain.handle('scan-list', async () => {
  try { return { list: await scan.listScanners() }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('scan-page', async (e, opts) => {
  try {
    const p = await scan.scanPage(opts || {});
    return { path: p, base64: fs.readFileSync(p).toString('base64') };
  } catch (err) { return { error: err.message }; }
});
ipcMain.handle('omr-run', async (e, files) => {
  files = (Array.isArray(files) ? files : []).filter((f) => typeof f === 'string' && OMR_EXT.test(f) && fs.existsSync(f));
  if (!files.length) return { error: 'aucun fichier à lire' };
  try {
    const r = await scan.runOmr(files, (pr) => { if (!e.sender.isDestroyed()) e.sender.send('omr-progress', pr); });
    try { fs.rmSync(r.outDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
    return { results: r.results };
  } catch (err) { return { error: err.message }; }
});
ipcMain.handle('omr-cancel', async () => scan.cancelOmr());
ipcMain.handle('open-audiveris-site', async () => shell.openExternal('https://github.com/Audiveris/audiveris/releases/latest'));
// fichiers temporaires (pages scannées, résultats) : effacés en quittant
app.on('will-quit', () => { try { fs.rmSync(path.join(require('os').tmpdir(), 'partoch'), { recursive: true, force: true }); } catch (e) { /* ignore */ } });

ipcMain.on('dirty', (e, d) => { dirty = !!d; });
ipcMain.on('quit-now', () => { if (updatePending) { installUpdate(); return; } forceQuit = true; if (win) win.close(); });
ipcMain.on('update-restart', () => {
  if (!updater) return;
  updatePending = true;
  if (dirty) win.close(); else installUpdate();
});
ipcMain.handle('open-releases', async () => shell.openExternal(RELEASES_URL));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileFromArgs(argv);
    if (f) win.webContents.send('open-path', readForRenderer(f));
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
