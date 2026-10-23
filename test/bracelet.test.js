import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paquet, secondesMurales, minuitLocal, demandes, lireDirect, lireBatterie,
  CollecteFc, CollecteActivite, CollecteVfc, CollecteGros, lireSommeil, lireSpo2,
  crc16Modbus, paquetGros, paquetHeure, demandesReglages, lireReveils, demandesMesures, lireMesureAuto, MESURES_AUTO,
} from '../js/bracelet.js';

const MIN = 60e3;
const p16 = (...octets) => { const p = new Uint8Array(16); p.set(octets); return p; };
const local = (j, h, m = 0) => new Date(2026, 9, j, h, m).getTime();

test('paquet : 16 octets, somme de contrôle modulo 256', () => {
  assert.deepEqual([...paquet(0x03)], [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
  const p = paquet(0x69, [1, 1]);
  assert.equal(p[15], 0x6b);
  assert.equal(paquet(0xff, [0xff, 0xff])[15], (0xff * 3) & 0xff);
});

test("l'heure est transmise comme heure murale locale", () => {
  assert.equal(secondesMurales(local(13, 0)), Date.UTC(2026, 9, 13) / 1000);
  const p = demandes.fcJour(local(13, 0));
  const ts = p[1] | (p[2] << 8) | (p[3] << 16) | (p[4] << 24);
  assert.equal(ts >>> 0, Date.UTC(2026, 9, 13) / 1000);
  assert.equal(minuitLocal(local(13, 9, 30), 1), local(12, 0));
});

test('mesure en direct et batterie', () => {
  assert.deepEqual(lireDirect(p16(0x69, 1, 0, 72)), { erreur: 0, bpm: 72 });
  assert.deepEqual(lireDirect(p16(0x69, 1, 1, 0)), { erreur: 1, bpm: 0 });
  assert.equal(lireDirect(p16(0x69, 3, 0, 97)), null);   // SpO2, pas la FC
  assert.deepEqual(lireBatterie(p16(0x03, 77, 1)), { niveau: 77, charge: true });
  assert.deepEqual(lireBatterie(p16(0x73, 0x0c, 64, 0)), { niveau: 64, charge: false });
});

test('historique FC : en-tête, 9 relevés puis 13 par paquet, toutes les 5 min', () => {
  const c = new CollecteFc(local(13, 0));
  assert.ok(c.ajouter(p16(0x15, 0, 3, 5)));
  assert.ok(!c.fini);
  c.ajouter(p16(0x15, 1, 0, 0, 0, 0, 60, 61, 0, 62, 0, 0, 0, 0, 63));
  c.ajouter(p16(0x15, 2, 70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 71));
  assert.ok(c.fini);
  const m = c.mesures();
  assert.deepEqual(m.map(x => x.v), [60, 61, 62, 63, 70, 71]);
  assert.equal(m[0].t, local(13, 0, 0));
  assert.equal(m[2].t, local(13, 0, 15));
  assert.equal(m[3].t, local(13, 0, 40));      // 9e relevé
  assert.equal(m[4].t, local(13, 0, 45));      // 1er du paquet 2
  assert.equal(m[5].t, local(13, 1, 45));      // 13e du paquet 2
  assert.ok(!c.ajouter(p16(0x43, 0)));          // autre commande ignorée
  const vide = new CollecteFc(local(13, 0));
  vide.ajouter(p16(0x15, 0xff));
  assert.ok(vide.fini);
  assert.equal(vide.mesures().length, 0);
});

test('activité : date BCD, quart d\'heure, pas en little-endian', () => {
  const c = new CollecteActivite();
  c.ajouter(p16(0x43, 0xf0, 0, 0));
  c.ajouter(p16(0x43, 0x26, 0x10, 0x13, 33, 0, 2, 0x10, 0x00, 0x2c, 0x01, 0xc8, 0x00));
  assert.ok(!c.fini);
  c.ajouter(p16(0x43, 0x26, 0x10, 0x13, 34, 1, 2, 0, 0, 0x64, 0x00));
  assert.ok(c.fini);
  assert.deepEqual(c.pas, [{ t: local(13, 8, 15), v: 300 }, { t: local(13, 8, 30), v: 100 }]);
  const vide = new CollecteActivite();
  vide.ajouter(p16(0x43, 0xff));
  assert.ok(vide.fini);
});

test('variabilité : une valeur par demi-heure, 12 puis 13 par paquet', () => {
  const c = new CollecteVfc(local(13, 0));
  c.ajouter(p16(0x39, 0, 5));
  c.ajouter(p16(0x39, 1, 0, 48, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 52));
  c.ajouter(p16(0x39, 2, 55));
  c.ajouter(p16(0x39, 3, 0));
  c.ajouter(p16(0x39, 4, 0));
  assert.ok(c.fini);
  assert.deepEqual(c.mesures, [
    { t: local(13, 0, 0), v: 48 },
    { t: local(13, 5, 30), v: 52 },
    { t: local(13, 6, 0), v: 55 },
  ]);
});

// [0xbc, 0x27, longueur LE, 2 octets, 1 jour, jours avant, taille, début LE, fin LE, (stade, minutes)…]
function grosSommeil() {
  const jour = [0, 4 + 2 * 4, 1380 & 0xff, 1380 >> 8, 420 & 0xff, 420 >> 8, 2, 60, 3, 90, 5, 10, 4, 0];
  const donnees = [1, ...jour];
  return [0xbc, 0x27, donnees.length & 0xff, donnees.length >> 8, 0, 0, ...donnees];
}

test('gros paquet reconstitué sur plusieurs notifications', () => {
  const o = grosSommeil(), c = new CollecteGros(0x27);
  assert.ok(!c.ajouter(Uint8Array.of(0xbc, 0x2a, 1, 0)));   // autre type
  c.ajouter(Uint8Array.from(o.slice(0, 10)));
  assert.ok(!c.fini);
  c.ajouter(Uint8Array.from(o.slice(10)));
  assert.ok(c.fini);
  assert.deepEqual(c.octets, o);
});

test('sommeil : commencé la veille à 23 h, stades enchaînés, minutes nulles ignorées', () => {
  const segs = lireSommeil(grosSommeil(), local(13, 9));
  assert.deepEqual(segs, [
    { s: local(12, 23, 0), e: local(13, 0, 0), k: 'core' },
    { s: local(13, 0, 0), e: local(13, 1, 30), k: 'deep' },
    { s: local(13, 1, 30), e: local(13, 1, 40), k: 'awake' },
  ]);
  assert.deepEqual(lireSommeil([0xbc, 0x27, 0, 0, 0, 0], local(13, 9)), []);
});

test('oxygène : moyenne min/max par heure, heures vides ignorées', () => {
  const bloc = [1, ...Array(48).fill(0)];
  bloc[1 + 3 * 2] = 94; bloc[2 + 3 * 2] = 98;           // 3 h
  const o = [0xbc, 0x2a, 49, 0, 0, 0, ...bloc];
  assert.deepEqual(lireSpo2(o, local(13, 9)), [{ t: local(12, 3), v: 96 }]);
});

/* ---------- Heure, réveils, vibreur ---------- */


test('grande trame : même schéma et même somme de contrôle que la demande de sommeil', () => {
  assert.equal(crc16Modbus([0xff]), 0x00ff);
  assert.deepEqual([...paquetGros(0x27, [0xff])], [...demandes.sommeil()]);
  assert.deepEqual([...demandesReglages.reveils()].slice(0, 4), [0xbc, 0x2c, 0x01, 0x00]);
});

test('heure : heure locale en BCD, somme de contrôle en dernier octet', () => {
  const p = paquetHeure(new Date(2026, 9, 25, 3, 7, 59).getTime());
  assert.deepEqual([...p.slice(0, 7)], [0x01, 0x26, 0x10, 0x25, 0x03, 0x07, 0x59]);
  assert.equal(p[15], [...p.slice(0, 15)].reduce((a, b) => a + b, 0) & 0xff);
});

test('réveils : écriture puis relecture donnent la même liste', () => {
  const liste = [
    { minutes: 7 * 60 + 20, jours: [1, 2, 4], actif: true, nom: 'Reveil' },
    { minutes: 22 * 60 + 35, jours: [], actif: false, nom: 'Médicament du soir, très important pour moi' },
  ];
  const p = [...demandesReglages.ecrireReveils(liste)];
  assert.equal(p[6], 0x02);                                        // écriture
  assert.equal(p[7], 2);
  assert.equal(p[9], 0x80 | 0b10110);                              // actif + lundi, mardi, jeudi (0 = dimanche)
  assert.deepEqual([p[10], p[11]], [(7 * 60 + 20) & 0xff, (7 * 60 + 20) >> 8]);
  const lu = lireReveils([0xbc, 0x2c, 0, 0, 0, 0, 0x01, ...p.slice(7)].map((b, i) => (i === 2 ? (p.length - 6) & 0xff : b)));
  assert.equal(lu.length, 2);
  assert.deepEqual(lu[0], liste[0]);
  assert.equal(lu[1].actif, false);
  assert.ok(new TextEncoder().encode(lu[1].nom).length <= 28);   // nom coupé à 28 octets, sans casser un caractère
  assert.ok(liste[1].nom.startsWith(lu[1].nom));
  assert.equal(lireReveils([0xbc, 0x2c, 0x01, 0x00, 0, 0, 0x02]), null);   // accusé d'écriture
});

test('vibreur : commande « trouver l\'appareil »', () => {
  assert.deepEqual([...demandesReglages.vibrer().slice(0, 3)], [0x50, 0x55, 0xaa]);
});

test('mesures automatiques : lecture, réponse, réactivation du pouls toutes les 5 min', () => {
  assert.deepEqual([...demandesMesures.lire(MESURES_AUTO.pouls).slice(0, 2)], [0x16, 0x01]);
  assert.deepEqual([...demandesMesures.pouls(5).slice(0, 4)], [0x16, 0x02, 0x01, 5]);
  assert.deepEqual([...demandesMesures.activer(MESURES_AUTO.stress).slice(0, 3)], [0x36, 0x02, 0x01]);
  assert.deepEqual(lireMesureAuto(p16(0x16, 0x01, 0x02, 0)), { cmd: 0x16, actif: false, minutes: 0 });
  assert.deepEqual(lireMesureAuto(p16(0x2c, 0x01, 0x01)), { cmd: 0x2c, actif: true, minutes: null });
  assert.equal(lireMesureAuto(p16(0x16, 0x02)), null);           // accusé d'écriture
  assert.equal(lireMesureAuto(p16(0x15, 0x01)), null);
});
