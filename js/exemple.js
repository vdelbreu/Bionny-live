// Données d'exemple écrites au format exact du raccourci, pour essayer l'app sans bracelet.
// Elles passent par le même parseImport que les vraies et sont toujours signalées à l'écran.
import { MIN, H, JOUR, parseImport } from './sante.js';

function hasard(graine) {
  return () => {
    graine = graine + 0x6D2B79F5 | 0;
    let t = Math.imul(graine ^ graine >>> 15, 1 | graine);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Même forme que le format « ISO 8601 » de Raccourcis : 2026-10-13T08:12:00+02:00
export function iso(t) {
  const d = new Date(t), off = -d.getTimezoneOffset(), p = n => String(Math.abs(n)).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

export function texteExemple(maintenant = Date.now()) {
  const r = hasard(42);
  const som = [], nuits = [];
  const j0 = new Date(maintenant); j0.setHours(0, 0, 0, 0);

  for (let k = 10; k >= 0; k--) {
    const jour = new Date(j0); jour.setDate(jour.getDate() - k);
    const coucher = jour.getTime() - JOUR + (23 * 60 + 15 + (r() - .5) * 70) * MIN;
    const fin = coucher + (k === 0 ? 6.6 : 7 + r() * 1.3) * H;
    const lit = coucher - (8 + r() * 14) * MIN;
    let t = coucher, cycle = 0;
    while (t < fin) {
      const prof = Math.max(0, 1 - cycle * .3);
      const phases = [
        ['Essentiel', (22 + r() * 15) * MIN],
        ['Profond', (12 + 35 * r()) * prof * MIN],
        ['Essentiel', (15 + r() * 10) * MIN],
        ['Paradoxal', (8 + cycle * 6 + r() * 8) * MIN],
      ];
      for (const [v, d] of phases) {
        if (d < MIN || t >= fin) continue;
        const e = Math.min(fin, t + d);
        som.push([t, e, v]); t = e;
      }
      if (t < fin && r() < .35) { const e = t + (2 + r() * 9) * MIN; som.push([t, e, 'Éveillé']); t = e; }
      cycle++;
    }
    som.push([lit, t + (4 + r() * 12) * MIN, 'Au lit']);
    nuits.push({ debut: coucher, fin: t, k, base: 50 + r() * 4 + (k === 0 ? 4 : 0) });
  }

  // FC toutes les 5 min : plus basse la nuit, une sortie sportive un jour sur deux vers 18 h
  const fc = [], vfc = [], spo2 = [];
  for (let t = j0.getTime() - 11 * JOUR; t <= maintenant; t += 5 * MIN) {
    const n = nuits.find(x => t >= x.debut && t <= x.fin);
    const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    let v;
    if (n) {
      const p = (t - n.debut) / (n.fin - n.debut);
      v = n.base + 24 * (p - .45) ** 2 + (r() - .5) * 3;
    } else {
      v = 70 + 6 * Math.sin((h - 9) / 24 * 2 * Math.PI) + (r() - .5) * 6;
      const jour = Math.floor((t - j0.getTime()) / JOUR);
      if (jour % 2 === 0 && h >= 18 && h < 18.75) v = 138 + (r() - .5) * 18;
    }
    fc.push([t, Math.round(v)]);
  }
  for (const n of nuits) {
    for (const p of [.35, .8]) vfc.push([n.debut + p * (n.fin - n.debut), Math.round((n.k === 0 ? 41 : 52) + (r() - .5) * 14)]);
    for (const p of [.2, .45, .7, .9]) spo2.push([n.debut + p * (n.fin - n.debut), 94 + Math.round(r() * 4)]);
  }

  // Pas groupés par jour, comme avec « Grouper par : Jour »
  const pas = [];
  for (let k = 10; k >= 0; k--) {
    const jour = new Date(j0); jour.setDate(jour.getDate() - k);
    const part = k === 0 ? Math.min(1, Math.max(0, (maintenant - jour) / JOUR - .3) / .6) : 1;
    pas.push([jour.getTime(), Math.round((6500 + r() * 6000) * part)]);
  }

  const passe = x => x[0] <= maintenant && (x.length < 3 || x[1] <= maintenant);
  const S = som.filter(passe), F = fc.filter(passe), V = vfc.filter(passe), O = spo2.filter(passe);
  const bloc = (titre, lignes) => `#${titre}\n${lignes.join('\n')}`;
  return [
    bloc('sommeil_debut', S.map(x => iso(x[0]))),
    bloc('sommeil_fin', S.map(x => iso(x[1]))),
    bloc('sommeil_valeur', S.map(x => x[2])),
    bloc('fc_date', F.map(x => iso(x[0]))),
    bloc('fc_valeur', F.map(x => x[1])),
    bloc('pas_date', pas.map(x => iso(x[0]))),
    bloc('pas_valeur', pas.map(x => x[1].toLocaleString('fr-FR'))),
    bloc('vfc_date', V.map(x => iso(x[0]))),
    bloc('vfc_valeur', V.map(x => x[1])),
    bloc('spo2_date', O.map(x => iso(x[0]))),
    bloc('spo2_valeur', O.map(x => x[1] + ' %')),
  ].join('\n');
}

// Même jeu de données, complété comme le renvoie le bracelet : pas et distance par quart d'heure, stress par demi-heure
export function impExemple(maintenant = Date.now()) {
  const r = hasard(7);
  const imp = parseImport(texteExemple(maintenant));
  const quarts = [];
  for (const { t: minuit, v: total } of imp.pas) {
    // répartition sur la journée : trajets du matin et du soir, midi
    const poids = [];
    for (let q = 0; q < 96; q++) {
      const h = q / 4;
      const p = h < 7 || h >= 23 ? 0 : .2 + Math.exp(-((h - 8.3) ** 2) / .6) + .7 * Math.exp(-((h - 12.5) ** 2) / .5) + 1.2 * Math.exp(-((h - 18.2) ** 2) / .8);
      poids.push(p * (.6 + r() * .8));
    }
    const somme = poids.reduce((a, b) => a + b, 0);
    poids.forEach((p, q) => {
      const t = minuit + q * 15 * MIN, v = Math.round(total * p / somme);
      if (v > 0 && t <= maintenant) quarts.push({ t, v, dist: Math.round(v * .72), cal: 0 });
    });
  }
  imp.pas = quarts.map(({ t, v }) => ({ t, v }));
  imp.activite = quarts;
  imp.stress = [];
  const j0 = new Date(maintenant); j0.setHours(0, 0, 0, 0);
  for (let k = 2; k >= 0; k--) {
    for (let m = 8 * 60; m < 22 * 60; m += 30) {
      const t = j0.getTime() - k * JOUR + m * MIN;
      if (t <= maintenant) imp.stress.push({ t, v: Math.round(25 + 20 * Math.sin(m / 180) + r() * 15) });
    }
  }
  return imp;
}
