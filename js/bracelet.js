// Protocole du bracelet Bionny 4.0 : même électronique que les bagues Colmi (app QRing).
// Format décodé par la communauté : github.com/tahnok/colmi_r02_client et Gadgetbridge (devices/colmi).
// Aucune dépendance au DOM ni au Bluetooth : testé dans test/bracelet.test.js.
// On n'envoie que des demandes de lecture et la mesure en direct : rien n'est écrit dans les réglages du bracelet.
import { MIN } from './sante.js';

export const UART = '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e';
export const UART_ECRITURE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const UART_NOTIF = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const V2 = 'de5bf728-d711-4e47-af26-65e3012a5dc7';
export const V2_ECRITURE = 'de5bf72a-d711-4e47-af26-65e3012a5dc7';
export const V2_NOTIF = 'de5bf729-d711-4e47-af26-65e3012a5dc7';

const STADES = { 2: 'core', 3: 'deep', 4: 'rem', 5: 'awake' };
const bcd = b => (b >> 4) * 10 + (b & 0x0f);

// Paquet de 16 octets : commande, 14 octets de données, somme de contrôle (somme des 15 premiers & 0xff)
export function paquet(cmd, donnees = []) {
  const p = new Uint8Array(16);
  p[0] = cmd;
  p.set(donnees.slice(0, 14), 1);
  let s = 0;
  for (let i = 0; i < 15; i++) s += p[i];
  p[15] = s & 0xff;
  return p;
}

// Le bracelet vit à l'heure murale locale : on la lui transmet comme si c'était de l'UTC
export const secondesMurales = t => {
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 1000;
};
const u32le = n => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

export function minuitLocal(maintenant, joursAvant = 0) {
  const d = new Date(maintenant);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - joursAvant).getTime();
}
const aMinute = (minuit, minutes) => { const d = new Date(minuit); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime(); };

export const demandes = {
  batterie: () => paquet(0x03),
  direct: () => paquet(0x69, [1, 1]),          // mesure FC en temps réel : démarrer
  directSuite: () => paquet(0x69, [1, 3]),     // continuer
  directStop: () => paquet(0x6a, [1, 0, 0]),
  fcJour: minuit => paquet(0x15, u32le(secondesMurales(minuit))),
  activite: joursAvant => paquet(0x43, [joursAvant, 0x0f, 0x00, 0x5f, 0x01]),
  vfc: joursAvant => paquet(0x39, [joursAvant, 0, 0, 0]),
  stress: () => paquet(0x37, [0]),             // stress du jour seulement (pas de paramètre de jour)
  // « gros paquets » sur le second service, sans cadre ni somme de contrôle
  sommeil: () => Uint8Array.of(0xbc, 0x27, 0x01, 0x00, 0xff, 0x00, 0xff),
  spo2: () => Uint8Array.of(0xbc, 0x2a, 0x01, 0x00, 0xff, 0x00, 0xff),
};

/* ---------- Réponses courtes ---------- */

// 0x69 : [cmd, type, code d'erreur, bpm]. Erreur 1 = bracelet mal porté, 2 = pas encore de valeur.
export function lireDirect(p) {
  if (p[0] !== 0x69 || p[1] !== 1) return null;
  return { erreur: p[2], bpm: p[3] };
}

// Notification 0x73 0x12 : activité du jour en direct, valeurs sur 3 octets big-endian
export function lireActiviteDirecte(p) {
  if (p[0] !== 0x73 || p[1] !== 0x12) return null;
  const u24 = i => (p[i] << 16) | (p[i + 1] << 8) | p[i + 2];
  return { pas: u24(2), dist: u24(8) };
}

export function lireBatterie(p) {
  if (p[0] === 0x03) return { niveau: p[1], charge: !!p[2] };
  if (p[0] === 0x73 && p[1] === 0x0c) return { niveau: p[2], charge: p[3] === 1 };
  return null;
}

/* ---------- Réponses en plusieurs paquets ---------- */

// Historique FC d'une journée : un relevé toutes les 5 min. Paquet 0 = en-tête (nombre de paquets),
// paquet 1 = horodatage + 9 relevés, paquets suivants = 13 relevés. 0 = pas de mesure.
export class CollecteFc {
  constructor(minuit) { this.minuit = minuit; this.total = null; this.valeurs = []; this.fini = false; }
  ajouter(p) {
    if (p[0] !== 0x15) return false;
    const n = p[1];
    if (n === 0xff) { this.fini = true; return true; }
    if (n === 0) { this.total = p[2]; if (this.total < 2) this.fini = true; return true; }
    const debut = n === 1 ? 6 : 2, slot0 = n === 1 ? 0 : 9 + (n - 2) * 13;
    for (let i = debut; i < 15; i++) this.valeurs[slot0 + i - debut] = p[i];
    if (this.total != null && n >= this.total - 1) this.fini = true;
    return true;
  }
  mesures() {
    return this.valeurs.flatMap((v, i) => v > 0 && v < 250 && i < 288 ? [{ t: aMinute(this.minuit, i * 5), v }] : []);
  }
}

// Activité d'une journée : un paquet par quart d'heure. Date en BCD, valeurs en uint16 little-endian :
// calories [7..8] (×10 si l'en-tête l'annonce, unité non documentée : gardées brutes, jamais affichées),
// pas [9..10], distance en mètres [11..12].
export class CollecteActivite {
  constructor() { this.pas = []; this.quarts = []; this.fini = false; this.cal10 = false; }
  ajouter(p) {
    if (p[0] !== 0x43) return false;
    if (p[1] === 0xff) { this.fini = true; return true; }   // aucun historique
    if (p[1] === 0xf0) { this.cal10 = p[3] === 1; return true; }   // en-tête
    const t = new Date(2000 + bcd(p[1]), bcd(p[2]) - 1, bcd(p[3]), 0, p[4] * 15).getTime();
    const pas = p[9] | (p[10] << 8);
    this.pas.push({ t, v: pas });
    this.quarts.push({ t, v: pas, dist: p[11] | (p[12] << 8), cal: (p[7] | (p[8] << 8)) * (this.cal10 ? 10 : 1) });
    if (p[5] >= p[6] - 1) this.fini = true;
    return true;
  }
}

// Une valeur par demi-heure (variabilité 0x39 en ms, stress 0x37 calculé par le bracelet).
// Paquet 1 : 12 valeurs dès l'octet 3, puis 13 dès l'octet 2.
export class CollecteDemiHeures {
  constructor(cmd, minuit) { this.cmd = cmd; this.minuit = minuit; this.mesures = []; this.total = null; this.fini = false; }
  ajouter(p) {
    if (p[0] !== this.cmd) return false;
    const n = p[1];
    if (n === 0xff) { this.fini = true; return true; }
    if (n === 0) { this.total = p[2]; return true; }
    const debut = n === 1 ? 3 : 2, decalage = n === 1 ? 0 : 360 + (n - 2) * 390;
    for (let i = debut; i < 15; i++) {
      const minutes = decalage + (i - debut) * 30;
      if (p[i] > 0 && minutes < 1440) this.mesures.push({ t: aMinute(this.minuit, minutes), v: p[i] });
    }
    if (n >= 4 || (this.total != null && n >= this.total - 1)) this.fini = true;
    return true;
  }
}

// Gros paquets (sommeil, oxygène) : [0xbc, type, longueur uint16 LE, 2 octets, données…], découpés en plusieurs notifications
export class CollecteGros {
  constructor(type) { this.type = type; this.octets = []; this.attendu = null; this.fini = false; }
  ajouter(p) {
    if (!this.octets.length && (p[0] !== 0xbc || p[1] !== this.type)) return false;
    for (const b of p) this.octets.push(b);
    if (this.attendu == null && this.octets.length >= 4) this.attendu = (this.octets[2] | (this.octets[3] << 8)) + 6;
    if (this.attendu != null && this.octets.length >= this.attendu) this.fini = true;
    return true;
  }
}

// Sommeil : octet 6 = nombre de jours, puis par jour [jours avant, taille, début uint16 LE, fin uint16 LE, (stade, minutes)…].
// Début et fin en minutes depuis minuit du jour du réveil ; début > fin = endormi la veille au soir.
export function lireSommeil(o, maintenant) {
  const segs = [];
  if (o.length < 7 || (o[2] | (o[3] << 8)) < 2) return segs;
  let i = 7;
  for (let j = 0; j < o[6] && i + 6 <= o.length; j++) {
    const joursAvant = o[i], taille = o[i + 1];
    const debut = o[i + 2] | (o[i + 3] << 8), fin = o[i + 4] | (o[i + 5] << 8);
    const minuit = minuitLocal(maintenant, joursAvant);
    let curseur = aMinute(minuit, debut > fin ? debut - 1440 : debut);
    for (let k = i + 6; k + 1 < i + 2 + taille && k + 1 < o.length; k += 2) {
      const minutes = o[k + 1];
      if (!minutes) continue;
      segs.push({ s: curseur, e: curseur + minutes * MIN, k: STADES[o[k]] ?? 'asleep' });
      curseur += minutes * MIN;
    }
    i += 2 + taille;
  }
  return segs;
}

// Oxygène : blocs de 49 octets [jours avant, puis (min, max) pour chaque heure 0 à 23]
export function lireSpo2(o, maintenant) {
  const out = [];
  const longueur = o.length >= 4 ? o[2] | (o[3] << 8) : 0;
  for (let i = 6; i + 49 <= o.length && i - 6 < longueur; i += 49) {
    const minuit = minuitLocal(maintenant, o[i]);
    for (let h = 0; h < 24; h++) {
      const bas = o[i + 1 + h * 2], haut = o[i + 2 + h * 2];
      if (bas > 0 && haut > 0) out.push({ t: aMinute(minuit, h * 60), v: Math.round((bas + haut) / 2) });
    }
  }
  return out;
}

export class CollecteVfc extends CollecteDemiHeures { constructor(minuit) { super(0x39, minuit); } }
export class CollecteStress extends CollecteDemiHeures { constructor(minuit) { super(0x37, minuit); } }
