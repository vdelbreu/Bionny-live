import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHR, filtreRR, rmssd, zoneDe, fcMaxTanaka, trimp } from '../js/coeur.js';

const trame = octets => new DataView(new Uint8Array(octets).buffer);

test('parseHR : BPM 8 bits sans R-R', () => {
  assert.deepEqual(parseHR(trame([0x00, 72])), { bpm: 72, rr: [], contact: null });
});

test('parseHR : BPM 16 bits, contact détecté, énergie ignorée, deux R-R', () => {
  // flags = 16 bits (1) + contact (2) + contact géré (4) + énergie (8) + R-R (16)
  const m = parseHR(trame([0x1f, 0x48, 0x00, 0x10, 0x00, 0x00, 0x04, 0x00, 0x02]));
  assert.equal(m.bpm, 72);
  assert.equal(m.contact, true);
  assert.deepEqual(m.rr, [1000, 500]);
});

test('parseHR : contact peau perdu', () => {
  assert.equal(parseHR(trame([0x04, 60])).contact, false);
});

test('filtreRR écarte les artefacts même en tête de série', () => {
  assert.deepEqual(filtreRR([400, 1000, 1010, 990, 2000, 1005]), [1000, 1010, 990, 1005]);
});

test('rmssd', () => {
  assert.equal(rmssd([1000, 1010]), null);
  const rr = [1000, 1010, 1000, 1010, 1000, 1010, 1000, 1010, 1000, 1010];
  assert.equal(rmssd(rr), 10);
});

test('FC max de Tanaka et zones', () => {
  assert.equal(fcMaxTanaka(20), 194);
  assert.equal(fcMaxTanaka(40), 180);
  assert.equal(zoneDe(60, 200), 0);    // 30 %
  assert.equal(zoneDe(140, 200), 3);   // 70 %
  assert.equal(zoneDe(195, 200), 5);
});

test('charge cardio TRIMP : minutes × poids de zone, trous ignorés', () => {
  const t0 = 0, m = 60e3;
  const r = trimp([{ t: t0, v: 130 }, { t: t0 + 10 * m, v: 170 }, { t: t0 + 20 * m, v: 60 }, { t: t0 + 300 * m, v: 60 }], 200);
  assert.equal(r.minutes[2], 10);       // 65 % pendant 10 min
  assert.equal(r.minutes[4], 10);       // 85 % pendant 10 min
  assert.equal(r.minutes[0], 15);       // 10 min plafonnées puis 5 min pour le dernier relevé
  assert.equal(r.charge, 10 * 2 + 10 * 4);
});
