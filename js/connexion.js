// Connexion Web Bluetooth au bracelet. Deux voies :
// - profil cardio standard (0x180D) si l'appareil l'expose ;
// - sinon protocole Colmi du Bionny 4.0 (bracelet.js) : mesure en direct, batterie, synchronisation de l'historique.
import {
  UART, UART_ECRITURE, UART_NOTIF, V2, V2_ECRITURE, V2_NOTIF, demandes, minuitLocal,
  lireDirect, lireContinu, lireBatterie, lireActiviteDirecte, CollecteFc, CollecteActivite, CollecteVfc, CollecteStress, CollecteGros, lireSommeil, lireSpo2,
  demandesReglages, lireReveils as decoderReveils, MESURES_AUTO, INTERVALLE_POULS, demandesMesures, lireMesureAuto,
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
// Une trame longue (liste de réveils) part d'un bloc si le bracelet accepte l'écriture avec réponse (iOS et Chrome la
// découpent), sinon en morceaux de 20 octets, que le bracelet recolle grâce à la longueur annoncée, comme ses envois.
function envoyer(p, v2 = false) {
  const c = v2 ? E.ecrireV2 : E.ecrire;
  noter('→', v2 ? 'v2' : 'v1', p);
  const morceaux = c.properties.write || p.length <= 20 ? [p] : Array.from({ length: Math.ceil(p.length / 20) }, (_, i) => p.slice(i * 20, i * 20 + 20));
  E.file = E.file.catch(() => {}).then(async () => {
    for (const m of morceaux) await (c.properties.write ? c.writeValueWithResponse(m) : c.writeValueWithoutResponse(m));
  });
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
    const tr = lireContinu(p);
    if (tr) {
      if (E.direct) { E.direct.continu = Date.now(); E.direct.derniere = Date.now(); }
      if (tr.bpm > 0) rappels.mesure(tr.bpm, [], true);
      return;
    }
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

/* ---------- Mesures automatiques : vérifiées et rallumées à chaque connexion ---------- */

// Lit les 4 réglages ; ceux qui ne répondent pas restent absents
function lireMesuresAuto() {
  return new Promise(resolve => {
    const lus = {}, noms = Object.entries(MESURES_AUTO);
    const fin = setTimeout(() => { arreter(); resolve(lus); }, 2500);
    const arreter = ecouter((p, canal) => {
      if (canal !== 'v1') return;
      const r = lireMesureAuto(p);
      if (!r) return;
      lus[noms.find(([, c]) => c === r.cmd)[0]] = r;
      if (Object.keys(lus).length === noms.length) { clearTimeout(fin); arreter(); resolve(lus); }
    });
    for (const [, c] of noms) envoyer(demandesMesures.lire(c)).catch(() => {});
  });
}
const resumeMesures = lus => Object.entries(lus).map(([k, r]) => `${k} ${r.actif ? 'oui' : 'NON'}${r.minutes != null ? ` (${r.minutes} min)` : ''}`).join(', ') || 'pas de réponse';
// Sans ses mesures automatiques, le bracelet n'enregistre presque plus rien (ni pouls, ni sommeil fiable) : on rallume
// celles qui sont coupées, pouls toutes les 5 min comme l'app Bionny, puis on relit pour vérifier.
export function verifierMesuresAuto() {
  if (E.mode !== 'colmi') return Promise.resolve(null);
  return sansDirect(async () => {
    const avant = await lireMesuresAuto();
    info(`mesures automatiques : ${resumeMesures(avant)}`);
    const rallumees = [];
    if (avant.pouls && (!avant.pouls.actif || avant.pouls.minutes !== INTERVALLE_POULS)) {
      await envoyer(demandesMesures.pouls(INTERVALLE_POULS)); rallumees.push('pouls');
    }
    for (const k of ['oxygene', 'stress', 'variabilite']) {
      if (avant[k] && !avant[k].actif) { await envoyer(demandesMesures.activer(MESURES_AUTO[k])); rallumees.push(k); }
    }
    if (!rallumees.length) return { avant, apres: avant, rallumees };
    const apres = await lireMesuresAuto();
    info(`mesures automatiques rallumées (${rallumees.join(', ')}) : ${resumeMesures(apres)}`);
    return { avant, apres, rallumees };
  });
}

/* ---------- Écrits dans le bracelet : heure, vibreur, réveils ---------- */

// Le direct est mis en pause le temps de l'échange, comme pour la synchro
async function sansDirect(f) {
  const enDirect = !!E.direct;
  arreterDirect();
  try { return await f(); } finally { if (enDirect) demarrerDirect(); }
}
// Remet l'horloge du bracelet à l'heure du téléphone (changement d'heure compris)
export async function mettreALHeure(t = Date.now()) {
  if (E.mode !== 'colmi') return false;
  info(`mise à l'heure : ${new Date(t).toLocaleString('fr-FR')}`);
  await envoyer(demandesReglages.heure(t));
  return true;
}
export async function vibrer() {
  if (E.mode !== 'colmi') return false;
  info('test du vibreur');
  await envoyer(demandesReglages.vibrer());
  return true;
}
// Liste des réveils du bracelet ; null s'il ne répond pas (réveils non gérés par ce modèle)
export function lireReveils() {
  if (E.mode !== 'colmi' || !E.ecrireV2) return Promise.resolve(null);
  return sansDirect(async () => {
    const c = await collecter(demandesReglages.reveils(), new CollecteGros(0x2c), true, 3000);
    const liste = c.octets.length ? decoderReveils(c.octets) : null;
    info(liste ? `réveils lus : ${liste.length}` : 'réveils : pas de réponse du bracelet');
    return liste;
  });
}
// Remplace toute la liste ; true si le bracelet accuse réception
export function ecrireReveils(liste) {
  if (E.mode !== 'colmi' || !E.ecrireV2) return Promise.resolve(false);
  return sansDirect(async () => {
    info(`écriture de ${liste.length} réveil(s), canal v2 ${E.ecrireV2.properties.write ? 'avec' : 'sans'} réponse`);
    const c = await collecter(demandesReglages.ecrireReveils(liste), new CollecteGros(0x2c), true, 3000);
    info(c.octets.length ? 'réveils : écriture confirmée' : 'réveils : pas de confirmation');
    return c.octets.length > 0;
  });
}

export function fermer() {
  arreterDirect();
  try { E.appareil?.gatt?.disconnect(); } catch { /* déjà déconnecté */ }
}

/* ---------- Mesure en direct (protocole Bionny) ---------- */

// Pouls en direct, sans fin tant que l'app est ouverte. D'abord le mode continu (0x1e) : « continue » toutes les 30 s,
// relancé si le bracelet se tait 10 s. S'il ne répond pas du tout en 8 s, mesures ponctuelles (0x69) enchaînées.
export const DELAIS_DIRECT = { essai: 8000, silence: 10000, suite: 30000 };
export function demarrerDirect() {
  if (E.mode !== 'colmi' || E.direct) return;
  const t0 = Date.now();
  E.direct = { mode: 'continu', debut: t0, continu: 0, suite: t0, derniere: 0, paquet: t0 };
  info('pouls en continu : démarrage');
  envoyer(demandes.continu()).catch(() => {});
  E.direct.minuterie = setInterval(() => {
    const d = E.direct, t = Date.now();
    if (!d) return;
    if (d.mode === 'continu') {
      if (!d.continu && t - d.debut > DELAIS_DIRECT.essai) {
        d.mode = 'ponctuel'; d.paquet = t; d.suite = t;
        info('pouls en continu non géré : mesures ponctuelles');
        envoyer(demandes.direct()).catch(() => {});
      } else if (d.continu && t - d.continu > DELAIS_DIRECT.silence) {
        d.continu = t; d.suite = t;
        info('pouls en continu : relance après un silence');
        envoyer(demandes.continu()).catch(() => {});
      } else if (d.continu && t - d.suite >= DELAIS_DIRECT.suite) {
        d.suite = t;
        envoyer(demandes.continuSuite()).catch(() => {});
      }
    } else if (t - d.suite >= SUITE_MS) {
      d.suite = t;
      if (d.derniere && t - d.derniere < VIVANTE_MS) envoyer(demandes.directSuite()).catch(() => {});
      else if (t - d.paquet > RELANCE_MS) { d.paquet = t; envoyer(demandes.direct()).catch(() => {}); }
    }
  }, 1000);
}

export function arreterDirect() {
  if (!E.direct) return;
  const mode = E.direct.mode;
  clearInterval(E.direct.minuterie);
  E.direct = null;
  if (connecte() && E.mode === 'colmi') envoyer(mode === 'continu' ? demandes.continuStop() : demandes.directStop()).catch(() => {});
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
