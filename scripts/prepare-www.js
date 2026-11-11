// Copie le site (dossier apercu) dans www, sans les fichiers inutiles ou de test.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'apercu');
const DST = path.join(__dirname, '..', 'www');
const SKIP = new Set(['_test', 'index.v2-carplay.html', 'peugeot307.glb', 'car3d.js', 'drive.js', 'scene.js']);

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP.has(name)) continue;
    const a = path.join(from, name), b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copy(a, b); else fs.copyFileSync(a, b);
  }
}
fs.rmSync(DST, { recursive: true, force: true });
copy(SRC, DST);
console.log('www pret :', fs.readdirSync(DST).join(', '));
