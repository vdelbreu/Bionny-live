import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reveilsVoulus, memesReveils, rappelsImportes, tropDeReveils, joursCourts, AVANT_COUCHER } from '../js/reveil.js';

const maintenant = new Date(2026, 9, 21, 14, 0).getTime();   // mercredi après-midi : la nuit visée finit jeudi
const R = (vibreur, leverJours = { 1: '07:20', 2: '07:20', 3: '08:00', 4: '07:20', 5: '09:30' }) => ({ vibreur, leverJours });

test('réveil vibreur : une alarme par heure de lever, avec ses jours', () => {
  const l = reveilsVoulus(R({ reveil: true }), null, maintenant);
  assert.deepEqual(l.map(r => [r.minutes, r.jours, r.nom]), [[440, [1, 2, 4], 'Reveil'], [480, [3], 'Reveil'], [570, [5], 'Reveil']]);
  assert.ok(l.every(r => r.actif));
  assert.deepEqual(reveilsVoulus(R({ reveil: false }), null, maintenant), []);
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
  assert.equal(l.length, 5);
  assert.deepEqual(l.at(-1), { minutes: 780, jours: [1, 5], actif: false, nom: 'Médicament' });
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
