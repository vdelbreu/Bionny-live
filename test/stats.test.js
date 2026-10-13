import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journees, repere, comparerSemaines, records, pointsAttention, joursPasses, decalerJour, fiabilite } from '../js/stats.js';
import { vide, nuits, cleJour, MIN, H } from '../js/sante.js';

const jour = (j, h = 0, m = 0) => new Date(2026, 9, j, h, m).getTime();

// Une nuit de 23 h à 7 h et des relevés de FC toutes les 5 min, plus bas la nuit
function donnees(nbJours, { rhr = () => 52, pas = () => 8000 } = {}) {
  const D = vide();
  for (let j = 14 - nbJours + 1; j <= 14; j++) {
    D.sommeil.push({ s: jour(j - 1, 23), e: jour(j, 7), k: 'asleep' });
    let i = 0;
    for (let t = jour(j - 1, 23); t < jour(j, 7); t += 5 * MIN) D.fc.push({ t, v: rhr(j) + (i++ % 3 ? 4 : 0) });
    for (let t = jour(j, 8); t < jour(j, 22); t += 5 * MIN) D.fc.push({ t, v: 75 });
    D.pas[cleJour(jour(j))] = pas(j);
    D.activite.push({ t: jour(j, 10), v: pas(j), dist: pas(j) * .7, cal: 0 });
  }
  D.fc.sort((a, b) => a.t - b.t);
  return D;
}

test('journees : nuit, FC de repos, pas, distance cohérente, charge cardio', () => {
  const D = donnees(3);
  const J = journees(D, nuits(D), 194);
  const j = J.get(cleJour(jour(14)));
  assert.equal(j.sommeil, 8 * H);
  assert.equal(j.rhr, 52);
  assert.equal(j.pas, 8000);
  assert.equal(j.distance, 5600);
  assert.equal(j.fc.max, 75);
  assert.equal(j.fc.intervalle, 5 * MIN);
  assert.equal(j.charge, 0);            // 75 bpm < 50 % de 194 : zone de repos, aucune charge
  assert.equal(j.vfcNuit, null);        // pas de mesure, pas de valeur
});

test('journees : une distance incohérente avec les pas est écartée', () => {
  const D = donnees(1);
  D.activite[0].dist = 99999;
  const J = journees(D, nuits(D), 194);
  assert.equal(J.get(cleJour(jour(14))).distance, null);
});

test('repere : moyenne et écart-type des jours précédents, 5 valeurs minimum', () => {
  const D = donnees(10, { rhr: j => 50 + (j % 2) * 4 });
  const J = journees(D, nuits(D), 194);
  const r = repere(J, cleJour(jour(14)), x => x.rhr);
  assert.equal(r.n, 9);
  assert.ok(r.moy > 50 && r.moy < 54);
  assert.ok(r.et > 1.5 && r.et < 2.5);
  assert.ok(r.bas >= 50 && r.haut <= 54);      // plage bornée aux valeurs observées
  assert.equal(repere(J, cleJour(jour(8)), x => x.rhr), null);
});

test('comparerSemaines et records', () => {
  const D = donnees(14, { pas: j => (j > 7 ? 10000 : 6000) });
  const J = journees(D, nuits(D), 194);
  const c = comparerSemaines(J, jour(14, 12), x => x.pas);
  assert.equal(c.cette.moy, 10000);
  assert.equal(c.precedente.moy, 6000);
  assert.equal(c.ecart, 4000);
  assert.deepEqual(records(J, x => x.pas), { cle: cleJour(jour(8)), v: 10000 });
  const h = comparerSemaines(J, jour(15, 12), x => x.pas, true);   // le 15 (en cours) est exclu
  assert.equal(h.cette.moy, 10000);
});

test('pointsAttention : FC de repos au-dessus de la normale deux nuits de suite', () => {
  const D = donnees(14, { rhr: j => (j >= 13 ? 62 : 50 + (j % 2)) });
  const J = journees(D, nuits(D), 194);
  const p = pointsAttention(J, jour(14, 12), 480);
  assert.equal(p.length, 1);
  assert.match(p[0], /FC de repos au-dessus de ta normale 2 nuits/);
  const calme = journees(donnees(14, { rhr: j => 50 + (j % 2) }), nuits(donnees(14, { rhr: j => 50 + (j % 2) })), 194);
  assert.deepEqual(pointsAttention(calme, jour(14, 12), 480), []);
});

test('fiabilite : une variabilité plate et sans lien avec la FC est écartée, une vraie est gardée', () => {
  const D = donnees(7);
  const ns = nuits(D);
  // bracelet qui renvoie des valeurs au hasard entre 30 et 50 ms, une par heure
  let graine = 1;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const heures = [];
  for (let j = 8; j <= 14; j++) for (let h = 0; h < 24; h++) heures.push(jour(j, h));
  D.vfc = heures.map(t => ({ t, v: 30 + Math.round(hasard() * 20) }));
  assert.equal(fiabilite(D, ns).vfc.fiable, false);
  // vraie variabilité : haute la nuit (FC basse), basse le jour (FC haute)
  D.vfc = heures.map(t => { const h = new Date(t).getHours(); return { t, v: h < 7 || h === 23 ? 70 : 38 }; });
  const f = fiabilite(D, ns);
  assert.equal(f.vfc.fiable, true);
  assert.ok(f.vfc.r < -0.5);
  assert.equal(f.stress.assez, false);          // pas de stress mesuré : pas assez de données, donc non affiché
});

test('joursPasses et decalerJour', () => {
  assert.deepEqual(joursPasses(3, jour(2, 12)), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.equal(decalerJour('2026-10-01', -1), '2026-09-30');
});
