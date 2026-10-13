// Faux bracelet Web Bluetooth qui répond au protocole Colmi : teste l'enchaînement de connexion.js sans matériel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir, synchroniser, fermer, mode, demarrerDirect, arreterDirect, journal } from '../js/connexion.js';
import { UART, UART_ECRITURE, UART_NOTIF, V2, V2_ECRITURE, V2_NOTIF } from '../js/bracelet.js';
import { nuits, fusionner, vide } from '../js/sante.js';

const p16 = (...o) => { const p = new Uint8Array(16); p.set(o); return p; };
const bcd = n => ((n / 10 | 0) << 4) | (n % 10);

function fauxBracelet({ muetSur = [] } = {}) {
  const ecoutes = { [UART_NOTIF]: [], [V2_NOTIF]: [] };
  const emettre = (uuid, octets) => setTimeout(() => {
    for (const f of ecoutes[uuid]) f({ target: { value: new DataView(Uint8Array.from(octets).buffer) } });
  }, 5);
  const v1 = o => emettre(UART_NOTIF, o);
  const repondre = p => {
    if (muetSur.includes(p[0])) return;
    if (p[0] === 0x03) v1(p16(0x03, 81, 0));
    if (p[0] === 0x69 && p[2] === 1) { v1(p16(0x69, 1, 2, 0)); v1(p16(0x69, 1, 0, 0)); v1(p16(0x69, 1, 0, 64)); }   // préchauffage puis une valeur
    if (p[0] === 0x15) {
      v1(p16(0x15, 0, 3, 5));
      v1(p16(0x15, 1, 0, 0, 0, 0, 58, 57, 56, 55, 54, 53, 52, 51, 50));
      v1(p16(0x15, 2, 60, 61, 62));
    }
    if (p[0] === 0x43) {
      const d = new Date(); d.setDate(d.getDate() - p[1]);
      const date = [bcd(d.getFullYear() - 2000), bcd(d.getMonth() + 1), bcd(d.getDate())];
      v1(p16(0x43, 0xf0));
      v1(p16(0x43, ...date, 4, 0, 2, 5, 0, 0xe8, 0x03));   // 1 000 pas à 1 h
      v1(p16(0x43, ...date, 5, 1, 2, 5, 0, 0xf4, 0x01));   // 500 pas à 1 h 15
    }
    if (p[0] === 0x39 || p[0] === 0x37) { v1(p16(p[0], 0, 5)); for (let n = 1; n <= 4; n++) v1(p16(p[0], n, n === 1 ? 0 : 50, 50)); }
    if (p[0] === 0xbc && p[1] === 0x27) {
      // nuit de la veille (1 jour avant) : toujours passée, quelle que soit l'heure du test
      const jour = [1, 4 + 2 * 3, 1380 & 0xff, 1380 >> 8, 400 & 0xff, 400 >> 8, 2, 200, 3, 120, 4, 120];
      const donnees = [1, ...jour], o = [0xbc, 0x27, donnees.length, 0, 0, 0, ...donnees];
      for (let i = 0; i < o.length; i += 20) emettre(V2_NOTIF, o.slice(i, i + 20));   // MTU de 20 octets
    }
    if (p[0] === 0xbc && p[1] === 0x2a) emettre(V2_NOTIF, [0xbc, 0x2a, 0, 0, 0, 0]);
  };
  const carac = uuid => ({
    properties: { write: true },
    addEventListener: (_, f) => ecoutes[uuid]?.push(f),
    startNotifications: async () => {},
    writeValueWithResponse: async p => repondre(p),
  });
  const services = {
    [UART]: { [UART_ECRITURE]: carac(UART_ECRITURE), [UART_NOTIF]: carac(UART_NOTIF) },
    [V2]: { [V2_ECRITURE]: carac(V2_ECRITURE), [V2_NOTIF]: carac(V2_NOTIF) },
  };
  const introuvable = () => Object.assign(new Error('introuvable'), { name: 'NotFoundError' });
  return {
    name: 'Bionny 4.0',
    gatt: {
      connected: true,
      disconnect() { this.connected = false; },
      connect: async () => ({
        getPrimaryService: async uuid => {
          if (!services[uuid]) throw introuvable();
          return { getCharacteristic: async c => services[uuid][c] ?? Promise.reject(introuvable()) };
        },
      }),
    },
  };
}

test('connexion au protocole du Bionny, batterie, puis synchronisation complète', async () => {
  let batterie = null;
  const appareil = fauxBracelet();
  const m = await ouvrir(appareil, { mesure() {}, contact() {}, batterie: v => { batterie = v; } });
  assert.equal(m, 'colmi');
  assert.equal(mode(), 'colmi');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(batterie, 81);

  const etapes = [];
  const imp = await synchroniser(2, t => etapes.push(t));
  assert.deepEqual(etapes, ['Fréquence cardiaque 1/2', 'Fréquence cardiaque 2/2', 'Pas 1/2', 'Pas 2/2', 'Variabilité 1/2', 'Variabilité 2/2', 'Stress', 'Sommeil', 'Oxygène']);
  assert.ok(imp.fc.length >= 9 && imp.fc.length <= 24, `FC : ${imp.fc.length}`);   // aujourd'hui peut être tronqué à l'heure actuelle
  assert.equal(imp.pas.reduce((a, x) => a + x.v, 0) % 1500, 0);
  assert.ok(imp.vfc.length > 0);
  assert.ok(imp.stress.length > 0);
  assert.equal(imp.activite.length, imp.pas.length);
  assert.equal(imp.activite.reduce((a, x) => a + x.dist, 0), 0);
  assert.equal(imp.sommeil.length, 3);
  assert.deepEqual(imp.sommeil.map(x => x.k), ['core', 'deep', 'rem']);

  // les données passent ensuite par la même chaîne que le raccourci Santé
  const d = fusionner(vide(), imp, Date.now());
  const ns = nuits(d);
  assert.equal(ns.length, 1);
  assert.equal(ns[0].tst, (200 + 120 + 120) * 60e3);
  fermer();
});

test("une demande sans réponse n'arrête pas la synchronisation (attente puis suite)", async () => {
  const appareil = fauxBracelet({ muetSur: [0x39] });
  await ouvrir(appareil, { mesure() {}, contact() {}, batterie() {} });
  const debut = Date.now();
  const imp = await synchroniser(1);
  assert.equal(imp.vfc.length, 0);
  assert.equal(imp.sommeil.length, 3);
  assert.ok(Date.now() - debut >= 2900, 'attend le silence avant de passer à la suite');
  fermer();
});

test('mesure en direct : valeurs nulles et code 2 ignorés, la vraie valeur arrive, tout est journalisé', async () => {
  const mesures = [], etats = [];
  await ouvrir(fauxBracelet(), { mesure: b => mesures.push(b), contact() {}, batterie() {}, direct: d => etats.push(d.erreur) });
  demarrerDirect();
  await new Promise(r => setTimeout(r, 60));
  arreterDirect();
  assert.deepEqual(mesures, [64]);
  assert.deepEqual(etats, [2, 0]);
  assert.match(journal(), /→ v1 69 01 01/);
  assert.match(journal(), /← v1 69 01 00 40/);
  assert.match(journal(), /→ v1 6a 01 00 00/);
  fermer();
});
