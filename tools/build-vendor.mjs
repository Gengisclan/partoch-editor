// Empaquette Basic Pitch (Spotify, Apache-2.0) + TensorFlow.js en un seul script pour la page,
// et intègre le modèle dans un fichier JS (chargement hors ligne, sans accès aux fichiers).
// Usage : npm run build:vendor
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'tools', 'basic-pitch-entry.js');

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"', global: 'window' },
  outfile: path.join(root, 'src', 'vendor', 'basic-pitch.js'),
  logLevel: 'info',
});

const modelDir = path.join(root, 'node_modules', '@spotify', 'basic-pitch', 'model');
const topology = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
const weights = fs.readFileSync(path.join(modelDir, 'group1-shard1of1.bin')).toString('base64');
const out = '// Modèle Basic Pitch (Spotify, Apache-2.0) — généré par tools/build-vendor.mjs\n'
  + 'window.BASIC_PITCH_MODEL = ' + JSON.stringify({ topology, weights }) + ';\n';
fs.writeFileSync(path.join(root, 'assets', 'basic-pitch-model.js'), out);
console.log('modèle : ' + (out.length / 1024).toFixed(0) + ' Ko');
