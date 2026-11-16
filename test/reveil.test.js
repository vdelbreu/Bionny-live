import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reveilsVoulus, memesReveils, rappelsImportes, tropDeReveils, joursCourts, lireHorloge, prochainsReveils, AVANT_COUCHER } from '../js/reveil.js';

const maintenant = new Date(2026, 9, 21, 14, 0).getTime();   // mercredi après-midi : la nuit visée finit jeudi
const R = (vibreur, leverJours = { 1: '07:20', 2: '07:20', 3: '08:00', 4: '07:20', 5: '09:30' }) => ({ vibreur, leverJours });

test('réveil vibreur : une rafale de 5 vibrations les 5 min avant le prochain lever, puis une vibration les autres jours', () => {
  const l = reveilsVoulus(R({ reveil: true }), null, maintenant);
  // jeudi 7 h 20 : de 7 h 15 à 7 h 19, une par minute
  assert.deepEqual(l.slice(0, 5).map(r => [r.minutes, r.jours, r.nom]), [435, 436, 437, 438, 439].map(m => [m, [4], 'Reveil']));
  // les autres jours, 5 min avant le lever, une alarme par heure avec ses jours
  assert.deepEqual(l.slice(5).map(r => [r.minutes, r.jours]), [[435, [1, 2]], [475, [3]], [565, [5]]]);
  assert.ok(l.every(r => r.actif));
  assert.deepEqual(reveilsVoulus(R({ reveil: false }), null, maintenant), []);
});

test("réveils de l'Horloge : heures du texte collé, à leur prochaine occurrence ; ils passent avant ton heure de lever", () => {
  const t = lireHorloge('Alarmes : 07:30, 6 h 45 et 7:30 ; 13h05 ; 25:00', maintenant);
  const hm = x => [new Date(x).getDate(), new Date(x).getHours() * 60 + new Date(x).getMinutes()];
  assert.deepEqual(t.map(hm), [[22, 6 * 60 + 45], [22, 7 * 60 + 30], [22, 13 * 60 + 5]]);   // 13 h 05 est passé : demain
  assert.deepEqual(lireHorloge("pas d'heure", maintenant), []);
  const r = { ...R({ reveil: true }), horloge: { t: [new Date(2026, 9, 22, 8, 10).getTime()] } };
  assert.deepEqual(prochainsReveils(r, maintenant).map(hm), [[22, 490]]);
  const l = reveilsVoulus(r, null, maintenant);
  assert.deepEqual(l.slice(0, 5).map(x => x.minutes), [485, 486, 487, 488, 489]);       // 8 h 05 à 8 h 09, jeudi
  assert.ok(!l.slice(5).some(x => x.jours.includes(4)));                                // jeudi pris par l'Horloge
  // passé, le réveil de l'Horloge ne compte plus : retour à ton heure de lever
  assert.deepEqual(prochainsReveils(r, new Date(2026, 9, 22, 9, 0).getTime()).map(hm), [[23, 570]]);
});

test('rafale à cheval sur minuit : chaque vibration a son jour', () => {
  const r = { vibreur: { reveil: true }, leverJours: {}, horloge: { t: [new Date(2026, 9, 22, 0, 2).getTime()] } };
  assert.deepEqual(reveilsVoulus(r, null, maintenant).map(x => [x.minutes, x.jours]), [[1437, [3]], [1438, [3]], [1439, [3]], [0, [4]], [1, [4]]]);
});

test('rappel du coucher : 30 min avant l\'heure conseillée, le bon soir', () => {
  const avant = reveilsVoulus(R({ coucher: true }), { coucher: 22 * 60 + 5 }, maintenant)[0];
  assert.equal(avant.minutes, 22 * 60 + 5 - AVANT_COUCHER);                   // 21 h 35
  assert.deepEqual(avant.jours, [3]);                                          // ce mercredi soir
  const apresMinuit = reveilsVoulus(R({ coucher: true }), { coucher: 15 }, maintenant)[0];   // coucher à 0 h 15 jeudi
  assert.deepEqual([apresMinuit.minutes, apresMinuit.jours], [23 * 60 + 45, [3]]);   // rappel 23 h 45 mercredi
  const nuit = reveilsVoulus(R({ coucher: true }), { coucher: 30 }, new Date(2026, 9, 22, 0, 10).getTime())[0];
  assert.deepEqual([nuit.minutes, nuit.jours], [0, [4]]);                      // déjà jeudi 0 h 10 : rappel à 0 h 00 jeudi
});

test('rappels : après les réveils, comparés sans tenir compte de l\'ordre des jours', () => {
  const rappels = [{ minutes: 13 * 60, jours: [5, 1], actif: false, nom: 'Médicament' }];
  const l = reveilsVoulus(R({ reveil: true, coucher: true, rappels }), { coucher: 1325 }, maintenant);
  assert.equal(l.length, 10);                                    // rafale, coucher, rappel, puis les autres jours
  assert.deepEqual(l[5].nom, 'Coucher');
  assert.deepEqual(l[6], { minutes: 780, jours: [1, 5], actif: false, nom: 'Médicament' });
  assert.ok(memesReveils(l, l.map(r => ({ ...r, jours: [...r.jours].reverse() }))));
  assert.ok(!memesReveils(l, l.slice(1)));
});

test('10 au plus, et réveils déjà dans le bracelet importés comme rappels', () => {
  const rappels = Array.from({ length: 9 }, (_, i) => ({ minutes: 600 + i, jours: [1], actif: true, nom: `R${i}` }));
  const r = R({ reveil: true, rappels });
  assert.equal(reveilsVoulus(r, null, maintenant).length, 10);
  assert.ok(tropDeReveils(r, null, maintenant));
  const lus = [{ minutes: 440, jours: [1], actif: true, nom: 'Reveil' }, { minutes: 420, jours: [6, 0], actif: true, nom: '' }];
  assert.deepEqual(rappelsImportes(lus), [{ minutes: 420, jours: [0, 6], actif: true, nom: 'Rappel' }]);
  assert.equal(joursCourts([3, 1]), 'lun, mer');
  assert.equal(joursCourts([]), 'une fois');
});
