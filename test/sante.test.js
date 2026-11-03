import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, parseNum, stade, parseImport, lireHash, fusionner, vide, union, soustraire, total,
  analyseNuit, nuits, recuperation, resume, reveilAuPouls, siestesFaites, siestesProbables, sansCopies, nuitMuette, silenceBracelet,
  MIN, H, JOUR,
} from '../js/sante.js';
import { texteExemple } from '../js/exemple.js';

test('parseDate lit le format ISO 8601 de Raccourcis, avec ou sans fuseau', () => {
  assert.equal(parseDate('2026-10-13T08:12:00+02:00'), Date.UTC(2026, 9, 13, 6, 12));
  assert.equal(parseDate('2026-10-13T08:12:00+0200'), Date.UTC(2026, 9, 13, 6, 12));
  assert.equal(parseDate('2026-10-13T06:12:00Z'), Date.UTC(2026, 9, 13, 6, 12));
  assert.equal(parseDate('2026-10-13T08:12'), new Date(2026, 9, 13, 8, 12).getTime());
  assert.equal(parseDate('2026-10-13'), null);
});

test('parseDate accepte les formats français par défaut', () => {
  assert.equal(parseDate('13 oct. 2026 à 23:14'), new Date(2026, 9, 13, 23, 14).getTime());
  assert.equal(parseDate('13 octobre 2026 à 23:14:05'), new Date(2026, 9, 13, 23, 14, 5).getTime());
  assert.equal(parseDate('1 juil. 2026 à 07:02'), new Date(2026, 6, 1, 7, 2).getTime());
  assert.equal(parseDate('13/10/2026 23:14'), new Date(2026, 9, 13, 23, 14).getTime());
  assert.equal(parseDate('‹Sommeil · Date de début›'), null);
});

test('parseNum gère virgule décimale, espaces insécables et unités', () => {
  assert.equal(parseNum('72,5'), 72.5);
  assert.equal(parseNum('8 542'), 8542);
  assert.equal(parseNum('8,542', true), 8542);
  assert.equal(parseNum('97 %'), 97);
  assert.equal(parseNum('64 bpm'), 64);
  assert.equal(parseNum('abc'), null);
});

test('stade reconnaît les libellés FR, EN et les codes HealthKit', () => {
  assert.equal(stade('Au lit'), 'inBed');
  assert.equal(stade('Éveillé'), 'awake');
  assert.equal(stade('Paradoxal'), 'rem');
  assert.equal(stade('Sommeil profond'), 'deep');
  assert.equal(stade('Essentiel'), 'core');
  assert.equal(stade('Endormi'), 'asleep');
  assert.equal(stade('REM'), 'rem');
  assert.equal(stade('4'), 'deep');
  assert.equal(stade('n’importe quoi'), null);
});

test('lireHash décode le fragment posé par le raccourci', () => {
  const t = '#sommeil_debut\n2026-10-13T00:00:00+02:00\nAu lit';
  assert.equal(lireHash('#d=' + encodeURIComponent(t)), t);
  assert.equal(lireHash('#jour'), null);
  assert.equal(lireHash('#d=100%25%20ok%'), '100% ok%');
});

const MODELE = `
#sommeil_debut
2026-10-12T23:30:00+02:00
2026-10-12T23:40:00+02:00
2026-10-13T02:00:00+02:00
2026-10-13T02:10:00+02:00
#sommeil_fin
2026-10-13T07:15:00+02:00
2026-10-13T02:00:00+02:00
2026-10-13T02:10:00+02:00
2026-10-13T07:00:00+02:00
#sommeil_valeur
Au lit
Essentiel
Éveillé
Profond
#fc_date
2026-10-13T08:00:00+02:00
#fc_valeur
61
#pas_date
2026-10-12T00:00:00+02:00
2026-10-13T00:00:00+02:00
#pas_valeur
9 120
2 004
#vfc_date
‹VFC · Date de début›
#vfc_valeur
‹VFC · Valeur›`;

test('parseImport aligne les listes et ignore un bloc laissé en modèle', () => {
  const d = parseImport(MODELE);
  assert.equal(d.sommeil.length, 4);
  assert.deepEqual(d.sommeil.map(x => x.k), ['inBed', 'core', 'awake', 'deep']);
  assert.equal(d.fc.length, 1);
  assert.deepEqual(d.pas.map(x => x.v), [9120, 2004]);
  assert.equal(d.vfc.length, 0);
  assert.deepEqual(d.avertissements, []);
});

test('parseImport signale des dates sans heure et des listes de tailles différentes', () => {
  const d = parseImport('#fc_date\n2026-10-13\n#fc_valeur\n60');
  assert.match(d.avertissements[0], /ISO 8601 avec l'heure/);
  const e = parseImport('#fc_date\n2026-10-13T08:00:00Z\n2026-10-13T08:05:00Z\n#fc_valeur\n60');
  assert.equal(e.fc.length, 1);
  assert.match(e.avertissements[0], /2 dates pour 1 valeurs/);
});

test('parseImport accepte une liste de dates collée sur une ligne', () => {
  const d = parseImport('#fc_date\n2026-10-13T08:00:00Z, 2026-10-13T08:05:00Z\n#fc_valeur\n60, 62');
  assert.deepEqual(d.fc.map(x => x.v), [60, 62]);
});

test('union et soustraire', () => {
  const u = union([{ s: 0, e: 10 }, { s: 5, e: 20 }, { s: 30, e: 40 }]);
  assert.deepEqual(u, [{ s: 0, e: 20 }, { s: 30, e: 40 }]);
  assert.deepEqual(soustraire(u, [{ s: 2, e: 4 }, { s: 15, e: 35 }]), [{ s: 0, e: 2 }, { s: 4, e: 15 }, { s: 35, e: 40 }]);
  assert.equal(total(u), 30);
});

test('analyseNuit : durée, efficacité, réveils, latence, stades', () => {
  const n = analyseNuit(parseImport(MODELE).sommeil);
  assert.equal(n.tst, 7 * H + 10 * MIN);           // 23:40 → 07:00 moins 10 min d'éveil
  assert.equal(n.lit, 7 * H + 45 * MIN);           // 23:30 → 07:15
  assert.equal(n.latence, 10 * MIN);
  assert.equal(n.reveils, 1);
  assert.equal(n.stades.deep, 4 * H + 50 * MIN);
  assert.equal(n.stades.core, 2 * H + 20 * MIN);
  assert.ok(n.aDesStades);
});

test('nuits : une sieste n\'est pas une nuit, deux sources qui se recouvrent ne comptent pas double', () => {
  const t0 = Date.UTC(2026, 9, 12, 21, 0);  // 23:00 à Paris
  const sommeil = [
    { s: t0, e: t0 + 8 * H, k: 'asleep' },             // bracelet
    { s: t0 + 30 * MIN, e: t0 + 7 * H, k: 'asleep' },  // autre source
    { s: t0 + 16 * H, e: t0 + 16 * H + 40 * MIN, k: 'asleep' },  // sieste de l'après-midi
  ];
  const ns = nuits({ ...vide(), sommeil });
  assert.equal(ns.length, 1);
  assert.equal(ns[0].tst, 8 * H);
});

test('fusionner : l\'import remplace la période qu\'il couvre et garde l\'historique plus ancien', () => {
  const now = Date.UTC(2026, 9, 13, 8);
  const base = { ...vide(), fc: [{ t: now - 5 * JOUR, v: 60 }, { t: now - JOUR, v: 99 }], pas: { '2026-10-01': 5000 } };
  const imp = { ...parseImport(''), fc: [{ t: now - 2 * JOUR, v: 58 }, { t: now - JOUR, v: 62 }] };
  const d = fusionner(base, imp, now);
  assert.deepEqual(d.fc.map(x => x.v), [60, 58, 62]);
  assert.equal(d.pas['2026-10-01'], 5000);
});

test('fusionner parJour : une synchro interrompue n\'efface pas un jour déjà enregistré', () => {
  const now = Date.UTC(2026, 9, 13, 8);
  const base = { ...vide(), fc: [{ t: now - 2 * JOUR, v: 60 }, { t: now - JOUR, v: 61 }, { t: now - 3600e3, v: 62 }] };
  // la synchro n'a rapporté que l'avant-veille : la veille et aujourd'hui sont gardés
  const imp = { ...parseImport(''), fc: [{ t: now - 2 * JOUR, v: 70 }] };
  assert.deepEqual(fusionner(base, imp, now, { parJour: true }).fc.map(x => x.v), [70, 61, 62]);
  assert.deepEqual(fusionner(base, imp, now).fc.map(x => x.v), [70]);
});

test('les données d\'exemple passent sans avertissement et donnent un verdict', () => {
  const now = new Date(2026, 9, 13, 9, 30).getTime();
  const imp = parseImport(texteExemple(now));
  assert.deepEqual(imp.avertissements, []);
  const d = fusionner(vide(), imp, now);
  const ns = nuits(d);
  assert.equal(ns.length, 11);
  assert.ok(ns.every(n => n.tst > 6 * H && n.tst < 9.5 * H));
  assert.ok(ns.every(n => n.fcNuit && n.fcNuit.repos >= 48 && n.fcNuit.repos <= 62));
  const r = recuperation(ns, 480, now);
  assert.ok(r);
  assert.notEqual(r.niveau, 'ok');            // la dernière nuit d'exemple est courte avec une FC plus haute
  const s = resume(ns, 480, now);
  assert.equal(s.n, 7);
  assert.ok(s.regCoucher < 40);
});

/* ---------- Réveil corrigé et siestes ---------- */

// nuit de 0 h à 8 h 10 (le bracelet s'arrête à la synchro de 8 h 10), pouls de 54 la nuit
function nuitReveil({ pouls = [], synchro = null, reveils = {} } = {}) {
  const t0 = new Date(2026, 9, 21, 0, 0).getTime(), fin = t0 + 8 * H + 10 * MIN;
  const fc = [];
  for (let t = t0; t < fin; t += 5 * MIN) fc.push({ t, v: 54 });
  for (const [hhmm, v] of pouls) { const [h, m] = hhmm.split(':').map(Number); const t = t0 + h * H + m * MIN; const x = fc.find(y => y.t === t); if (x) x.v = v; }
  return { ...vide(), sommeil: [{ s: t0, e: fin, k: 'core' }], fc, synchros: synchro ? [synchro] : [], reveils };
}

test("nuits : l'heure de réveil reste celle du bracelet, même si le pouls remonte avant (comme l'app Bionny)", () => {
  const d = nuitReveil({ pouls: [['08:00', 75], ['08:05', 72]] });
  const n = nuits(d)[0];
  assert.equal(n.finSource, 'bracelet');
  assert.equal(n.fin, n.finBracelet);
  assert.equal(new Date(n.fin).getMinutes(), 10);                // 8 h 10, comme le bracelet
  // la détection au pouls existe toujours, mais n'est plus appliquée
  assert.equal(new Date(reveilAuPouls(n, d.fc)).getHours(), 8);
  assert.equal(reveilAuPouls(nuits(nuitReveil({ pouls: [['07:30', 85], ['07:35', 55]] }))[0], []), null);
});

test('réveil corrigé par toi : il passe avant le pouls, et peut aussi prolonger la nuit', () => {
  const t = new Date(2026, 9, 21, 7, 45).getTime();
  const n = nuits(nuitReveil({ pouls: [['08:00', 75], ['08:05', 72]], reveils: { '2026-10-21': t } }))[0];
  assert.equal(n.finSource, 'toi');
  assert.equal(n.fin, t);
  assert.equal(n.tst, 7 * H + 45 * MIN);
  const plus = nuits(nuitReveil({ reveils: { '2026-10-21': new Date(2026, 9, 21, 8, 30).getTime() } }))[0];
  assert.equal(plus.tst, 8 * H + 30 * MIN);
  const absurde = nuits(nuitReveil({ reveils: { '2026-10-21': new Date(2026, 9, 21, 0, 20).getTime() } }))[0];
  assert.equal(absurde.finSource, 'bracelet');                   // moins d'1 h après l'endormissement : ignoré
});

test('nuit arrêtée par une synchro : signalée comme provisoire', () => {
  const synchro = new Date(2026, 9, 21, 8, 14).getTime();
  assert.equal(nuits(nuitReveil({ synchro }))[0].finProvisoire, true);
  assert.equal(nuits(nuitReveil({ synchro: synchro + 2 * H }))[0].finProvisoire, false);
});

// journée du 21 : pouls de 75, sauf un creux à 55 de 14 h à 14 h 40 ; pas par heure
function journee({ pasA14 = 0, refus = [] } = {}) {
  const d = nuitReveil();
  const j = new Date(2026, 9, 21, 9, 0).getTime();
  for (let t = j; t < j + 10 * H; t += 5 * MIN) {
    const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    d.fc.push({ t, v: h >= 14 && h < 14 + 40 / 60 ? 55 : 75 });
  }
  d.activite = [{ t: new Date(2026, 9, 21, 12).getTime(), v: 800, dist: 0, cal: 0 }];
  if (pasA14) d.activite.push({ t: new Date(2026, 9, 21, 14).getTime(), v: pasA14, dist: 0, cal: 0 });
  d.nonSiestes = refus;
  return d;
}

test('siestes probables : un creux de pouls sans pas est proposé, à confirmer', () => {
  const d = journee(), soir = new Date(2026, 9, 21, 20).getTime();
  const p = siestesProbables(d, nuits(d), soir);
  assert.equal(p.length, 1);
  assert.equal(new Date(p[0].debut).getHours(), 14);
  assert.equal(p[0].fin - p[0].debut, 40 * MIN);
  assert.equal(siestesFaites(d).length, 0);                      // proposée seulement : ne compte pas
  assert.equal(siestesProbables(journee({ pasA14: 900 }), nuits(d), soir).length, 0);   // tu marchais
  assert.equal(siestesProbables(journee({ refus: [p[0].debut] }), nuits(d), soir).length, 0);   // tu as dit non
  d.siestes = [{ debut: p[0].debut, fin: p[0].fin, source: 'confirmee' }];
  assert.equal(siestesProbables(d, nuits(d), soir).length, 0);   // confirmée : plus proposée
  assert.equal(siestesFaites(d).length, 1);
});

test('siestes : une courte période de sommeil du bracelet en journée en est une, pas une nuit', () => {
  const d = nuitReveil();
  const s = new Date(2026, 9, 21, 15, 0).getTime();
  d.sommeil.push({ s, e: s + 40 * MIN, k: 'core' });
  assert.equal(nuits(d).length, 1);
  assert.deepEqual(siestesFaites(d).map(x => [x.source, x.fin - x.debut]), [['bracelet', 40 * MIN]]);
});

/* ---------- Nuits vérifiées au pouls ---------- */

const le = (j, h, m = 0) => new Date(2026, 9, j, h, m).getTime();
const hm = t => `${String(new Date(t).getHours()).padStart(2, '0')}:${String(new Date(t).getMinutes()).padStart(2, '0')}`;
// 10 nuits de minuit à 8 h, pouls 50 à 54 endormi, 69 à 75 éveillé, un relevé toutes les 5 min ; le bracelet note
// chaque nuit. pouls11(t) remplace le pouls de la dernière nuit.
function dixNuits({ pouls11 = null, dort = (t) => new Date(t).getHours() < 8 } = {}) {
  const d = vide();
  let i = 0;
  for (let t = le(1, 12); t < le(11, 20); t += 5 * MIN, i++) {
    const v = dort(t) ? 52 + (i % 5) - 2 : 72 + (i % 7) - 3;
    d.fc.push({ t, v: pouls11 && t >= le(11, 0) && t < le(11, 8) ? pouls11(i) : v });
  }
  for (let j = 2; j <= 11; j++) d.sommeil.push({ s: le(j, 0), e: le(j, 8), k: 'core' });
  return d;
}
const nuit11 = d => nuits(d).find(n => n.cle === '2026-10-11');
const sans11 = d => { d.sommeil = d.sommeil.filter(x => x.s < le(11, 0) - 2 * H); return d; };

test('nuit du bracelet confirmée par le pouls : ses heures sont gardées telles quelles', () => {
  const n = nuit11(dixNuits());
  assert.equal(n.source, 'bracelet');
  assert.equal(n.controle, 'confirmee');
  assert.deepEqual([hm(n.debut), hm(n.fin), n.debutSource, n.finSource], ['00:00', '08:00', 'bracelet', 'bracelet']);
  assert.equal(n.partCalme, 100);
});

test("nuit absente du bracelet : heures prises sur le pouls, sans phases", () => {
  const n = nuit11(sans11(dixNuits()));
  assert.equal(n.source, 'pouls');
  assert.equal(n.debutBracelet, null);
  assert.ok(Math.abs(n.debut - le(11, 0)) <= 10 * MIN, hm(n.debut));
  assert.ok(Math.abs(n.fin - le(11, 8)) <= 10 * MIN, hm(n.fin));
  assert.equal(n.aDesStades, false);
  // sans 2 jours de relevés avant, rien n'est deviné
  const debut = dixNuits(); debut.fc = debut.fc.filter(x => x.t >= le(10, 0)); debut.sommeil = [];
  assert.equal(nuits(debut).length, 0);
});

test('nuit du bracelet contredite par le pouls (placée pendant que tu étais éveillé) : remplacée par la nuit au pouls', () => {
  const d = sans11(dixNuits());
  d.sommeil.push({ s: le(11, 6), e: le(11, 14), k: 'core' });
  const n = nuit11(d);
  assert.equal(n.source, 'pouls');
  assert.equal(hm(n.debutBracelet), '06:00');
  assert.ok(Math.abs(n.fin - le(11, 8)) <= 10 * MIN, hm(n.fin));
  assert.ok(n.tst > 7 * H && n.tst <= 8 * H);
});

test('nuit coupée alors que le pouls reste celui du sommeil : prolongée jusqu\'au réveil vu au pouls', () => {
  const d = sans11(dixNuits());
  d.sommeil.push({ s: le(11, 0), e: le(11, 3), k: 'deep' });
  const n = nuit11(d);
  assert.equal(n.source, 'bracelet');
  assert.equal(n.finSource, 'pouls');
  assert.equal(hm(n.finBracelet), '03:00');
  assert.ok(Math.abs(n.fin - le(11, 8)) <= 10 * MIN, hm(n.fin));
  assert.equal(n.stades.deep, 3 * H);                            // les phases du bracelet restent
  // pouls d'éveil juste après la coupure : tu t'étais réveillé, rien n'est ajouté
  const reveille = sans11(dixNuits({ dort: t => new Date(t).getHours() < 8 && (t < le(11, 3) || t >= le(11, 3, 30)) }));
  reveille.sommeil.push({ s: le(11, 0), e: le(11, 3), k: 'deep' });
  assert.equal(nuit11(reveille).fin, le(11, 3));
});

test('début contredit : le bracelet te dit endormi à 22 h, ton pouls reste celui de l\'éveil jusqu\'à minuit', () => {
  const d = sans11(dixNuits());
  d.sommeil.push({ s: le(10, 22), e: le(11, 8), k: 'core' });
  const n = nuit11(d);
  assert.equal(n.controle, 'confirmee');
  assert.equal(n.debutSource, 'pouls');
  assert.equal(hm(n.debutBracelet), '22:00');
  assert.ok(Math.abs(n.debut - le(11, 0)) <= 10 * MIN, hm(n.debut));
  assert.equal(n.tst, 8 * H);
});

test('nuit de fièvre (pouls haut toute la nuit) : gardée, elle reste nettement sous le pouls de la journée', () => {
  const n = nuit11(dixNuits({ pouls11: i => 64 + (i % 3) }));
  assert.equal(n.source, 'bracelet');
  assert.equal(n.controle, 'confirmee');
  assert.deepEqual([hm(n.debut), hm(n.fin)], ['00:00', '08:00']);
  assert.ok(n.fcNuit.repos >= 64);
});

test("longue période immobile l'après-midi : ni une nuit, ni ajoutée à la nuit du même jour", () => {
  const d = dixNuits();
  d.sommeil.push({ s: le(11, 13), e: le(11, 16, 30), k: 'core' });
  const n = nuit11(d);
  assert.deepEqual([hm(n.debut), hm(n.fin), n.tst], ['00:00', '08:00', 8 * H]);
  assert.equal(nuits(d).filter(x => x.cle === '2026-10-11').length, 1);
  // le pouls de l'après-midi est celui de l'éveil : pas comptée comme sieste non plus
  assert.equal(siestesFaites(d).length, 0);
});

test('fusionner parJour : le sommeil est remplacé nuit par nuit, une nuit que le bracelet ne renvoie plus reste', () => {
  const now = le(13, 12);
  const base = { ...vide(), sommeil: [
    { s: le(11, 0), e: le(11, 7), k: 'core' },          // nuit du 11, que le bracelet ne renvoie plus
    { s: le(12, 1), e: le(12, 4), k: 'core' },          // nuit du 12 arrêtée à une synchro de 4 h
  ] };
  const imp = { ...parseImport(''), sommeil: [{ s: le(10, 0), e: le(10, 7, 30), k: 'core' }, { s: le(12, 1), e: le(12, 8), k: 'deep' }] };
  const d = fusionner(base, imp, now, { parJour: true });
  assert.deepEqual(d.sommeil.map(x => [hm(x.s), hm(x.e), x.k]), [['00:00', '07:30', 'core'], ['00:00', '07:00', 'core'], ['01:00', '08:00', 'deep']]);
  assert.deepEqual(fusionner(base, imp, now).sommeil.length, 2);   // import de Santé : il fait foi sur toute sa période
});

/* ---------- Nuits redatées par le bracelet, nuits sans mesure ---------- */

// une nuit du bracelet de 6 phases, commencée le jour j à h:m
const phasesBracelet = [['core', 37], ['deep', 31], ['core', 22], ['rem', 16], ['core', 50], ['rem', 27]];
function nuitBracelet(j, h, m) {
  let t = le(j, h, m);
  return phasesBracelet.map(([k, min]) => { const s = t; t += min * MIN; return { s, e: t, k }; });
}

test('copies : une ancienne nuit redatée (mêmes phases, même heure) est écartée, l\'originale gardée', () => {
  const vraie = nuitBracelet(2, 1, 16), copie = nuitBracelet(7, 1, 16), fragment = nuitBracelet(9, 1, 16).slice(0, 1);
  const autre = nuitBracelet(8, 1, 20);                           // même suite, autre heure : une vraie nuit
  const garde = sansCopies([...copie, ...vraie, ...fragment, ...autre]);
  assert.deepEqual([...new Set(garde.map(x => new Date(x.s).getDate()))], [2, 8]);
  // une nuit d'une seule phase (Santé) n'est jamais prise pour une copie
  const simples = [{ s: le(2, 0), e: le(2, 8), k: 'asleep' }, { s: le(3, 0), e: le(3, 8), k: 'asleep' }];
  assert.equal(sansCopies(simples).length, 2);
});

test('copies : une ancienne nuit redatée par le bracelet ne remplace jamais une nuit enregistrée', () => {
  const vraie12 = nuitBracelet(12, 1, 16), vraie22 = nuitBracelet(22, 0, 40).map(x => ({ ...x, k: 'deep' }));
  const base = { ...vide(), sommeil: [...vraie12, ...vraie22] };
  const imp = { ...parseImport(''), sommeil: nuitBracelet(22, 1, 16) };   // la nuit du 12, renvoyée comme celle du 22
  const d = fusionner(base, imp, le(23, 12), { parJour: true });
  assert.deepEqual(d.sommeil, base.sommeil);
});

test('pouls sur une partie de la nuit seulement : un pouls d\'éveil net la contredit', () => {
  // la « nuit » du bracelet va de 18 h à 1 h 30, seules ses 45 dernières minutes ont du pouls, celui de l'éveil ;
  // endormi en vrai de 2 h 45 à 10 h 30
  const dort = t => (t >= le(10, 12) ? t >= le(11, 2, 45) && t < le(11, 10, 30) : new Date(t).getHours() < 8);
  const d = sans11(dixNuits({ dort }));
  d.fc = d.fc.filter(x => x.t < le(10, 18) || x.t >= le(11, 0, 45));
  d.sommeil.push({ s: le(10, 18), e: le(11, 1, 30), k: 'core' });
  const n = nuit11(d);
  assert.equal(n.source, 'pouls');
  assert.equal(hm(n.debutBracelet), '18:00');
  assert.ok(Math.abs(n.debut - le(11, 2, 45)) <= 10 * MIN, hm(n.debut));
  assert.ok(Math.abs(n.fin - le(11, 10, 30)) <= 10 * MIN, hm(n.fin));
});

test('sieste qui chevauche une nuit : elle en fait partie, comptée une seule fois', () => {
  const d = dixNuits();
  d.siestes = [{ debut: le(11, 6), fin: le(11, 9), source: 'confirmee' }, { debut: le(11, 14), fin: le(11, 14, 30), source: 'declaree' }];
  assert.equal(siestesFaites(d).length, 2);
  assert.deepEqual(siestesFaites(d, nuits(d)).map(x => hm(x.debut)), ['14:00']);
});

test('nuit muette : le bracelet a mesuré la veille et le matin, rien la nuit ; rien n\'est deviné', () => {
  const d = sans11(dixNuits());
  d.fc = d.fc.filter(x => x.t < le(10, 23) || x.t >= le(11, 9));
  const apres = le(11, 19);
  assert.equal(nuit11(d), undefined);
  assert.equal(nuitMuette(d, '2026-10-11', apres), true);
  assert.equal(nuitMuette(dixNuits(), '2026-10-11', apres), false);
  // pas encore synchronisé depuis la nuit : pas muette, mais le silence se voit à la synchro suivante
  const avant = { ...d, fc: d.fc.filter(x => x.t < le(10, 23)) };
  assert.equal(nuitMuette(avant, '2026-10-11', apres), false);
  assert.equal(silenceBracelet({ ...avant, majBracelet: le(10, 23, 30) }), null);
  assert.equal(hm(silenceBracelet({ ...avant, majBracelet: le(11, 9) })), '22:55');
});
