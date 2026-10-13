// Génère les icônes PNG (cœur blanc traversé d'un tracé ECG sur fond rouge), sans dépendance.
// Usage : node outils/icones.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROUGE = [212, 42, 60], BLANC = [255, 255, 255];
const ECG = [[.17, .53], [.36, .53], [.42, .41], [.49, .67], [.56, .31], [.62, .53], [.83, .53]];
const EPAISSEUR = .028;

const dansCoeur = (u, v) => {
  // cœur implicite (x² + y² − 1)³ − x² y³ ≤ 0, centré et mis à l'échelle
  const x = (u - .5) / .36, y = -(v - .54) / .36;
  return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
};
function distSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const surEcg = (u, v) => ECG.slice(1).some((b, i) => distSegment(u, v, ECG[i], b) < EPAISSEUR);

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function bloc(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(taille) {
  const SS = 4, lignes = [];
  for (let y = 0; y < taille; y++) {
    const ligne = Buffer.alloc(1 + taille * 3);
    for (let x = 0; x < taille; x++) {
      let blanc = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + .5) / SS) / taille, v = (y + (sy + .5) / SS) / taille;
        if (dansCoeur(u, v) && !surEcg(u, v)) blanc++;
      }
      const a = blanc / (SS * SS);
      for (let c = 0; c < 3; c++) ligne[1 + x * 3 + c] = Math.round(ROUGE[c] * (1 - a) + BLANC[c] * a);
    }
    lignes.push(ligne);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; ihdr[9] = 2;   // 8 bits, RVB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(Buffer.concat(lignes))), bloc('IEND', Buffer.alloc(0))]);
}

mkdirSync('icones', { recursive: true });
for (const t of [180, 512]) writeFileSync(`icones/icone-${t}.png`, png(t));

const pts = ECG.map(([u, v]) => `${(u * 100).toFixed(1)},${(v * 100).toFixed(1)}`).join(' ');
writeFileSync('icones/icone.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="rgb(${ROUGE})"/>
<path fill="#fff" d="M50 84C39 76 18 63 15 45 13 31 22 21 33 21c8 0 13 5 17 10 4-5 9-10 17-10 11 0 20 10 18 24-3 18-24 31-35 39z"/>
<polyline points="${pts}" fill="none" stroke="rgb(${ROUGE})" stroke-width="${EPAISSEUR * 200}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>\n`);
console.log('icones/icone-180.png, icone-512.png, icone.svg');
