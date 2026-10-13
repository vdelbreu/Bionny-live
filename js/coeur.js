// Calculs sur les trames du bracelet (profil Bluetooth standard « Heart Rate »).
// Aucune dépendance au DOM : testé dans test/coeur.test.js.

export const ZONES = [
  { k: 'Z0', nom: 'Repos',   bas: 0,  c: '--z0' },
  { k: 'Z1', nom: 'Léger',   bas: .5, c: '--z1' },
  { k: 'Z2', nom: 'Modéré',  bas: .6, c: '--z2' },
  { k: 'Z3', nom: 'Soutenu', bas: .7, c: '--z3' },
  { k: 'Z4', nom: 'Intense', bas: .8, c: '--z4' },
  { k: 'Z5', nom: 'Maximal', bas: .9, c: '--z5' },
];

// FC max : mesurée si tu la connais, sinon formule de Tanaka (2001), plus juste que 220 − âge
export const fcMaxTanaka = age => Math.round(208 - 0.7 * age);

export function zoneDe(bpm, fcmax) {
  const p = bpm / fcmax;
  let i = 0;
  ZONES.forEach((z, j) => { if (p >= z.bas) i = j; });
  return i;
}

// Caractéristique 0x2A37, little-endian : flags, BPM (8 ou 16 bits), énergie (ignorée), puis 0..n R-R en 1/1024 s
export function parseHR(dv) {
  const f = dv.getUint8(0);
  let i = 1;
  const bpm = f & 1 ? dv.getUint16(i, true) : dv.getUint8(i);
  i += f & 1 ? 2 : 1;
  const contact = f & 4 ? !!(f & 2) : null;
  if (f & 8) i += 2;
  const rr = [];
  if (f & 16) while (i + 1 < dv.byteLength) { rr.push(dv.getUint16(i, true) / 1024 * 1000); i += 2; }
  return { bpm, rr, contact };
}

// Écarte les artefacts : d'abord ce qui s'éloigne de plus de 30 % de la médiane,
// puis tout R-R qui saute de plus de 20 % par rapport au précédent retenu.
export function filtreRR(rr) {
  const v = rr.filter(r => r > 250 && r < 2200);
  if (!v.length) return [];
  const tri = [...v].sort((a, b) => a - b), med = tri[tri.length >> 1];
  const out = [];
  for (const r of v) {
    if (Math.abs(r - med) / med > .3) continue;
    const p = out.at(-1);
    if (p == null || Math.abs(r - p) / p < .2) out.push(r);
  }
  return out;
}

// RMSSD en ms : racine de la moyenne des carrés des écarts entre R-R successifs (10 intervalles minimum)
export function rmssd(rr) {
  if (rr.length < 10) return null;
  let s = 0;
  for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2;
  return Math.sqrt(s / (rr.length - 1));
}

// Charge cardio, méthode TRIMP d'Edwards : minutes passées dans chaque zone × poids de la zone (Z1 = 1 … Z5 = 5).
// mesures = [{ t, v }] triées ; chaque relevé compte jusqu'au suivant, au plus `maxPas` ms (trou = pas compté).
export function trimp(mesures, fcmax, maxPas = 10 * 60e3) {
  const minutes = ZONES.map(() => 0);
  for (let i = 0; i < mesures.length; i++) {
    const suivant = mesures[i + 1]?.t ?? mesures[i].t + Math.min(maxPas, 5 * 60e3);
    const dt = Math.min(suivant - mesures[i].t, maxPas) / 60e3;
    if (dt > 0) minutes[zoneDe(mesures[i].v, fcmax)] += dt;
  }
  return { charge: Math.round(minutes.reduce((a, m, z) => a + m * z, 0)), minutes };
}
