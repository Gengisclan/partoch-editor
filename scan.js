// Scanner (WIA, intégré à Windows) et reconnaissance de partitions (Audiveris, installé à part)
// Utilisé par main.js (processus principal) : rien ici n'est accessible directement à la page.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PNG = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}';
const OMR_STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS',
  'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];

function tmpDir(prefix) {
  const d = path.join(os.tmpdir(), 'partoch', prefix + '-' + Date.now().toString(36));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// PowerShell : script passé encodé (aucun souci de guillemets), résultat en JSON sur la sortie
function powershell(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from('$ProgressPreference="SilentlyContinue"; $ErrorActionPreference="Stop"\n' + script, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { p.kill(); reject(new Error('le scanner ne répond pas')); }, timeoutMs || 120000);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try {
        const r = JSON.parse(line);
        if (r && r.error) reject(new Error(r.error)); else resolve(r);
      } catch (e) { reject(new Error((err || out || 'erreur inconnue').trim().slice(0, 300))); }
    });
  });
}
const psStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Messages WIA courants
function wiaMessage(msg) {
  const m = String(msg);
  if (/0x80210006|busy/i.test(m)) return 'le scanner est occupé (une autre application l’utilise ?)';
  if (/0x80210005|offline|0x80210015|0x8021000A/i.test(m)) return 'le scanner est éteint ou injoignable';
  if (/0x80210003|paper/i.test(m)) return 'pas de papier dans le chargeur';
  if (/0x80210064|cancel/i.test(m)) return 'numérisation annulée';
  return m.replace(/^Exception[^:]*:\s*/, '');
}

async function listScanners() {
  if (process.platform !== 'win32') return [];
  const r = await powershell(`
try {
  $dm = New-Object -ComObject WIA.DeviceManager
  $list = @()
  foreach ($d in $dm.DeviceInfos) { if ($d.Type -eq 1) { $list += @{ id = $d.DeviceID; name = $d.Properties.Item('Name').Value } } }
  ConvertTo-Json -Compress -InputObject @{ list = $list }
} catch { ConvertTo-Json -Compress @{ error = $_.Exception.Message } }`, 30000);
  return (r && r.list) || [];
}

// Numérise une page : niveaux de gris, dpi choisi, toute la vitre. Renvoie le chemin du PNG.
async function scanPage({ deviceId, dpi }) {
  const out = path.join(tmpDir('scan'), 'page.png');
  dpi = [200, 300, 400].includes(+dpi) ? +dpi : 300;
  try {
    await powershell(`
try {
  $dm = New-Object -ComObject WIA.DeviceManager
  $info = $null
  foreach ($d in $dm.DeviceInfos) { if ($d.DeviceID -eq ${psStr(deviceId)}) { $info = $d } }
  if (-not $info) { throw 'scanner introuvable' }
  $dev = $info.Connect()
  $item = $dev.Items.Item(1)
  function SetP($id, $v) { foreach ($p in $item.Properties) { if ($p.PropertyID -eq $id) { try { $p.Value = $v } catch {} } } }
  function MaxP($id) { foreach ($p in $item.Properties) { if ($p.PropertyID -eq $id) { try { $p.Value = $p.SubTypeMax } catch {} } } }
  SetP 6146 2          # niveaux de gris
  SetP 6147 ${dpi}     # résolution horizontale
  SetP 6148 ${dpi}     # résolution verticale
  SetP 6149 0; SetP 6150 0
  MaxP 6151; MaxP 6152 # toute la surface de la vitre
  $img = $item.Transfer('${PNG}')
  if ($img.FormatID -ne '${PNG}') {
    $ip = New-Object -ComObject WIA.ImageProcess
    $ip.Filters.Add($ip.FilterInfos.Item('Convert').FilterID)
    $ip.Filters.Item(1).Properties.Item('FormatID').Value = '${PNG}'
    $img = $ip.Apply($img)
  }
  if (Test-Path ${psStr(out)}) { Remove-Item ${psStr(out)} }
  $img.SaveFile(${psStr(out)})
  ConvertTo-Json -Compress @{ path = ${psStr(out)}; w = $img.Width; h = $img.Height }
} catch { ConvertTo-Json -Compress @{ error = ($_.Exception.Message + ' ' + ('{0:X}' -f $_.Exception.HResult)) } }`, 180000);
  } catch (e) { throw new Error(wiaMessage(e.message)); }
  return out;
}

// ---- Audiveris ----
function audiverisPath() {
  const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'Audiveris', 'Audiveris.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let omrProc = null;
// Reconnaît une ou plusieurs images / PDF. Chaque fichier donne un MusicXML compressé (.mxl).
function runOmr(files, onProgress) {
  return new Promise((resolve, reject) => {
    const exe = audiverisPath();
    if (!exe) return reject(new Error('AUDIVERIS_MISSING'));
    const outDir = tmpDir('omr');
    const p = spawn(exe, ['-batch', '-export', '-output', outDir, '--', ...files], { windowsHide: true, cwd: outDir });
    omrProc = p;
    let buf = '', log = '';
    const sheets = new Set();
    let curSheet = '', step = 0, fileIdx = 0;
    const names = files.map((f) => path.basename(f).replace(/\.[^.]+$/, ''));
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        log += line + '\n';
        if (log.length > 200000) log = log.slice(-100000);
        const m = line.match(/\[([^\]#]*)(?:#(\d+))?\]\s+StepMonitoring\s+\d+\s+\|\s+(\w+)/);
        if (!m) continue;
        const key = m[1] + '#' + (m[2] || 1);
        if (key !== curSheet) { curSheet = key; sheets.add(key); const k = names.indexOf(m[1]); if (k >= 0) fileIdx = k; }
        step = Math.max(0, OMR_STEPS.indexOf(m[3]));
        if (onProgress) onProgress({ file: fileIdx, files: files.length, sheet: +(m[2] || 1), step: step + 1, steps: OMR_STEPS.length });
      }
    });
    p.stderr.on('data', (d) => { log += d; });
    p.on('error', (e) => { omrProc = null; reject(e); });
    p.on('close', (code) => {
      omrProc = null;
      if (p.killedByUser) return reject(new Error('CANCELLED'));
      // un .mxl par fichier d'entrée (ou par mouvement : nom.mvt1.mxl…)
      const results = names.map((n) => {
        const found = fs.readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.mxl') && (f === n + '.mxl' || f.startsWith(n + '.mvt'))).sort();
        return found.map((f) => fs.readFileSync(path.join(outDir, f)).toString('base64'));
      });
      if (!results.some((r) => r.length)) {
        const why = /no staves|no staff|Too few|not a music sheet|Could not|invalid/i.exec(log);
        return reject(new Error(why ? 'NO_MUSIC' : 'Audiveris n’a rien produit (code ' + code + ')'));
      }
      resolve({ results, outDir });
    });
  });
}
function cancelOmr() { if (omrProc) { omrProc.killedByUser = true; omrProc.kill(); } }

module.exports = { listScanners, scanPage, audiverisPath, runOmr, cancelOmr };
