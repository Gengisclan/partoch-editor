// Icône de l'application (build/icon.png, 512 × 512) : la noire blanche du logo sur fond bleu.
// Usage : npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="16" y="16" width="480" height="480" rx="112" fill="#4a8af4"/>
  <g fill="#fff">
    <ellipse cx="214" cy="356" rx="74" ry="54" transform="rotate(-24 214 356)"/>
    <rect x="270" y="96" width="24" height="262" rx="6"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  fs.writeFileSync(path.join(out, 'icon.svg'), SVG);
  console.log('icône → build/icon.png');
  app.quit();
});
