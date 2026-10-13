import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, parseNum, stade, parseImport, lireHash, fusionner, vide, union, soustraire, total,
  analyseNuit, nuits, recuperation, resume, MIN, H, JOUR,
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
