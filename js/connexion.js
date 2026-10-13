// Connexion Web Bluetooth au bracelet. Deux voies :
// - profil cardio standard (0x180D) si l'appareil l'expose ;
// - sinon protocole Colmi du Bionny 4.0 (bracelet.js) : mesure en direct, batterie, synchronisation de l'historique.
import {
  UART, UART_ECRITURE, UART_NOTIF, V2, V2_ECRITURE, V2_NOTIF, demandes, minuitLocal,
  lireDirect, lireBatterie, lireActiviteDirecte, CollecteFc, CollecteActivite, CollecteVfc, CollecteStress, CollecteGros, lireSommeil, lireSpo2,
} from './bracelet.js';
import { parseHR } from './coeur.js';

export const SERVICES = [UART, V2, 'heart_rate', 'battery_service', 'device_information'];
// mesure en direct : on la prolonge toutes les 15 s tant qu'elle donne des valeurs ; on ne la relance que si le
// bracelet ne répond plus du tout depuis 45 s (une première mesure peut demander 30 s ou plus)
const SUITE_MS = 15000, VIVANTE_MS = 30000, RELANCE_MS = 45000;

const E = { appareil: null, mode: null, ecrire: null, ecrireV2: null, abonnes: new Set(), file: Promise.resolve(), direct: null, rappels: {} };
export const mode = () => E.mode;
export const connecte = () => !!E.appareil?.gatt?.connected;

export function choisir(tous) {
  return navigator.bluetooth.requestDevice(tous
    ? { acceptAllDevices: true, optionalServices: SERVICES }
    : { filters: [{ services: [UART] }, { services: ['heart_rate'] }, { namePrefix: 'Bionny' }, { namePrefix: 'BIONNY' }], optionalServices: SERVICES });
}

const octets = dv => new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));

// Journal des derniers échanges (octets bruts), téléchargeable depuis Réglages pour le diagnostic
const JOURNAL = [];
function inscrire(sens, canal, texte) {
  JOURNAL.push({ t: Date.now(), sens, canal, hex: texte });
  if (JOURNAL.length > 800) JOURNAL.shift();
}
const noter = (sens, canal, p) => inscrire(sens, canal, [...p].map(b => b.toString(16).padStart(2, '0')).join(' '));
// étapes de connexion (recherche, reconnexion directe, libération) : savoir ce que fait le navigateur, sur iPhone surtout
export const info = texte => inscrire('·', 'info', texte);
export const journal = () => JOURNAL.map(x => `${new Date(x.t).toLocaleTimeString('fr-FR')}.${String(x.t % 1000).padStart(3, '0')} ${x.sens} ${x.canal} ${x.hex}`).join('\n');

function diffuser(p, canal) { noter('←', canal, p); for (const f of E.abonnes) f(p, canal); }
function ecouter(f) { E.abonnes.add(f); return () => E.abonnes.delete(f); }

// Les écritures GATT doivent passer une par une
function envoyer(p, v2 = false) {
  const c = v2 ? E.ecrireV2 : E.ecrire;
  noter('→', v2 ? 'v2' : 'v1', p);
  E.file = E.file.catch(() => {}).then(() => (c.properties.write ? c.writeValueWithResponse(p) : c.writeValueWithoutResponse(p)));
  return E.file;
}

// rappels : { mesure(bpm, rr, contact), batterie(niveau), contact(ok), activite({ pas, dist }), direct({ erreur, bpm }) }
export async function ouvrir(appareil, rappels) {
  E.appareil = appareil; E.rappels = rappels; E.abonnes.clear(); E.file = Promise.resolve();
  const serveur = await appareil.gatt.connect();
  try {
    const hr = await (await serveur.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
    hr.addEventListener('characteristicvaluechanged', e => { const m = parseHR(e.target.value); rappels.mesure(m.bpm, m.rr, m.contact); });
    await hr.startNotifications();
    E.mode = 'standard';
    try {
      const b = await (await serveur.getPrimaryService('battery_service')).getCharacteristic('battery_level');
      rappels.batterie((await b.readValue()).getUint8(0));
    } catch { /* pas de service batterie */ }
    return E.mode;
  } catch { /* pas de profil standard : on tente le protocole du Bionny */ }

  const uart = await serveur.getPrimaryService(UART);
  E.ecrire = await uart.getCharacteristic(UART_ECRITURE);
  const notif = await uart.getCharacteristic(UART_NOTIF);
  notif.addEventListener('characteristicvaluechanged', e => diffuser(octets(e.target.value), 'v1'));
  await notif.startNotifications();
  E.ecrireV2 = null;
  try {
    const v2 = await serveur.getPrimaryService(V2);
    E.ecrireV2 = await v2.getCharacteristic(V2_ECRITURE);
    const n2 = await v2.getCharacteristic(V2_NOTIF);
    n2.addEventListener('characteristicvaluechanged', e => diffuser(octets(e.target.value), 'v2'));
    await n2.startNotifications();
  } catch { /* pas de second service : pas de sommeil */ }
  E.mode = 'colmi';
  ecouter(p => {
    const b = lireBatterie(p);
    if (b) rappels.batterie(b.niveau);
    const a = lireActiviteDirecte(p);
    if (a) rappels.activite?.(a);
    const d = lireDirect(p);
    if (!d) return;
    if (E.direct) E.direct.paquet = Date.now();          // le bracelet répond : la mesure est en cours
    if (d.erreur === 0 && d.bpm > 0) {
      if (E.direct) E.direct.derniere = Date.now();
      rappels.mesure(d.bpm, [], true);
    } else {
      if (d.erreur === 1) rappels.contact(false);
      rappels.direct?.(d);
    }
  });
  envoyer(demandes.batterie()).catch(() => {});
  return E.mode;
}

export function fermer() {
  arreterDirect();
  try { E.appareil?.gatt?.disconnect(); } catch { /* déjà déconnecté */ }
}

/* ---------- Mesure en direct (protocole Bionny) ---------- */

export function demarrerDirect() {
  if (E.mode !== 'colmi' || E.direct) return;
  E.direct = { derniere: 0, paquet: Date.now() };
  envoyer(demandes.direct()).catch(() => {});
  E.direct.minuterie = setInterval(() => {
    const t = Date.now();
    if (E.direct.derniere && t - E.direct.derniere < VIVANTE_MS) envoyer(demandes.directSuite()).catch(() => {});
    else if (t - E.direct.paquet > RELANCE_MS) { E.direct.paquet = t; envoyer(demandes.direct()).catch(() => {}); }
  }, SUITE_MS);
}

export function arreterDirect() {
  if (!E.direct) return;
  clearInterval(E.direct.minuterie);
  E.direct = null;
  if (connecte() && E.mode === 'colmi') envoyer(demandes.directStop()).catch(() => {});
}

/* ---------- Historique (protocole Bionny) ---------- */

// Envoie une demande et rassemble la réponse jusqu'à ce qu'elle soit complète, ou après un silence
function collecter(demande, collecte, v2 = false, silence = 3000) {
  return new Promise(resolve => {
    let minuterie;
    const finir = () => { clearTimeout(minuterie); arreter(); resolve(collecte); };
    const attendre = () => { clearTimeout(minuterie); minuterie = setTimeout(finir, silence); };
    const arreter = ecouter((p, canal) => {
      if (canal !== (v2 ? 'v2' : 'v1') || !collecte.ajouter(p)) return;
      if (collecte.fini) finir(); else attendre();
    });
    attendre();
    envoyer(demande, v2).catch(finir);
  });
}

// Lit `jours` jours d'historique et renvoie un objet au format de parseImport (sante.js)
export async function synchroniser(jours, progres = () => {}) {
  if (E.mode !== 'colmi') throw new Error("Ce bracelet n'a pas d'historique lisible.");
  const enDirect = !!E.direct;
  arreterDirect();
  const maintenant = Date.now();
  const imp = { sommeil: [], fc: [], pas: [], activite: [], vfc: [], stress: [], spo2: [], repos: [], avertissements: [] };
  try {
    for (let j = 0; j < jours; j++) {
      progres(`Fréquence cardiaque ${j + 1}/${jours}`);
      const minuit = minuitLocal(maintenant, j);
      imp.fc.push(...(await collecter(demandes.fcJour(minuit), new CollecteFc(minuit))).mesures());
    }
    for (let j = 0; j < jours; j++) {
      progres(`Pas ${j + 1}/${jours}`);
      const a = await collecter(demandes.activite(j), new CollecteActivite());
      imp.pas.push(...a.pas);
      imp.activite.push(...a.quarts);
    }
    for (let j = 0; j < jours; j++) {
      progres(`Variabilité ${j + 1}/${jours}`);
      imp.vfc.push(...(await collecter(demandes.vfc(j), new CollecteVfc(minuitLocal(maintenant, j)))).mesures);
    }
    progres('Stress');
    imp.stress = (await collecter(demandes.stress(), new CollecteStress(minuitLocal(maintenant, 0)))).mesures;
    if (E.ecrireV2) {
      progres('Sommeil');
      imp.sommeil = lireSommeil((await collecter(demandes.sommeil(), new CollecteGros(0x27), true, 4000)).octets, maintenant);
      progres('Oxygène');
      imp.spo2 = lireSpo2((await collecter(demandes.spo2(), new CollecteGros(0x2a), true, 4000)).octets, maintenant);
    } else imp.avertissements.push("Le bracelet n'expose pas le service du sommeil.");
  } finally {
    if (enDirect && connecte()) demarrerDirect();
  }
  const parT = (a, b) => (a.t ?? a.s) - (b.t ?? b.s);
  for (const k of ['fc', 'pas', 'activite', 'vfc', 'stress', 'spo2', 'sommeil']) imp[k] = imp[k].filter(x => (x.t ?? x.s) <= maintenant + 60e3).sort(parT);
  return imp;
}
