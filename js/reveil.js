// Réveils et rappels que ViaWrist écrit dans le bracelet (qui vibre ensuite tout seul, téléphone éteint compris).
// Dans l'ordre : la rafale de ton prochain réveil (5 vibrations, une par minute, les 5 min avant), le rappel du coucher
// (30 min avant l'heure conseillée ce soir, mis à jour à chaque connexion), tes rappels, les rafales de tes autres
// réveils de l'Horloge, puis une vibration 5 min avant ton lever les autres jours de la semaine. 10 au plus.
// La force et la durée d'une vibration ne se règlent pas dans ce protocole : la rafale les remplace.
// Pur, testé dans test/reveil.test.js.
import { REVEILS_MAX } from './bracelet.js';

export const AVANT_COUCHER = 30;   // minutes avant l'heure de coucher conseillée
export const RAFALE = 5;           // vibrations, une par minute, de 5 min à 1 min avant ton réveil
export const NOM_REVEIL = 'Reveil', NOM_COUCHER = 'Coucher';
const MIN = 60e3;
const enMinutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const tries = j => [...j].sort((a, b) => a - b);
const alarmeA = (t, nom = NOM_REVEIL) => { const d = new Date(t); return { minutes: d.getHours() * 60 + d.getMinutes(), jours: [d.getDay()], actif: true, nom }; };
const rafale = t => Array.from({ length: RAFALE }, (_, k) => alarmeA(t - (RAFALE - k) * MIN));

// Réveils de l'app Horloge, collés depuis le raccourci : toutes les heures du texte (« 07:30 », « 7:30 », « 7 h 30 »),
// chacune à sa prochaine occurrence dans les 24 h. Renvoie des instants triés.
export function lireHorloge(texte, maintenant) {
  const out = new Set();
  for (const m of String(texte).matchAll(/(?<!\d)([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)(?!\d)/gi)) {
    const d = new Date(maintenant); d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() <= maintenant + MIN) d.setDate(d.getDate() + 1);
    out.add(d.getTime());
  }
  return [...out].sort((a, b) => a - b);
}

// Tes prochains réveils : ceux de l'Horloge encore à venir, sinon ton heure de lever du prochain matin
export function prochainsReveils(R, maintenant) {
  const horloge = (R.horloge?.t || []).filter(t => t > maintenant + MIN).sort((a, b) => a - b);
  if (horloge.length) return horloge;
  for (let k = 0; k <= 7; k++) {
    const d = new Date(maintenant); d.setDate(d.getDate() + k);
    const h = R.leverJours?.[d.getDay()];
    if (!h) continue;
    d.setHours(Math.floor(enMinutes(h) / 60), enMinutes(h) % 60, 0, 0);
    if (d.getTime() > maintenant + MIN) return [d.getTime()];
  }
  return [];
}

// R.vibreur = { reveil, coucher, rappels: [{ minutes, jours, actif, nom }] }, R.horloge = { t: [instants], recu } ;
// plan = planSommeil(contexte). Tous les réveils voulus, avant la limite de 10.
function tousLesReveils(R, plan, maintenant) {
  const v = R.vibreur || {}, out = [];
  const prochains = v.reveil ? prochainsReveils(R, maintenant) : [];
  if (prochains.length) out.push(...rafale(prochains[0]));
  if (v.coucher && plan?.coucher != null) {
    // l'heure de coucher est comptée depuis minuit du matin visé : la veille au soir si elle est après midi
    const matin = new Date(maintenant);
    if (matin.getHours() >= 5) matin.setDate(matin.getDate() + 1);
    matin.setHours(0, 0, 0, 0);
    const c = ((Math.round(plan.coucher) % 1440) + 1440) % 1440;
    out.push(alarmeA(matin.getTime() + ((c >= 12 * 60 ? c - 1440 : c) - AVANT_COUCHER) * MIN, NOM_COUCHER));
  }
  for (const r of v.rappels || []) out.push({ minutes: r.minutes, jours: tries(r.jours), actif: !!r.actif, nom: r.nom || 'Rappel' });
  for (const t of prochains.slice(1)) out.push(...rafale(t));
  if (v.reveil) {
    // les autres jours de la semaine : une vibration 5 min avant ton lever, une alarme par heure avec ses jours
    const pris = new Set(prochains.map(t => new Date(t).getDay())), parHeure = new Map();
    for (const [j, h] of Object.entries(R.leverJours || {})) {
      if (pris.has(Number(j))) continue;
      const m = (enMinutes(h) - RAFALE + 1440) % 1440, jour = enMinutes(h) < RAFALE ? (Number(j) + 6) % 7 : Number(j);
      parHeure.set(m, [...(parHeure.get(m) || []), jour]);
    }
    for (const [minutes, jours] of [...parHeure].sort((a, b) => a[0] - b[0])) out.push({ minutes, jours: tries(jours), actif: true, nom: NOM_REVEIL });
  }
  return out;
}
export const reveilsVoulus = (R, plan, maintenant) => tousLesReveils(R, plan, maintenant).slice(0, REVEILS_MAX);
export const tropDeReveils = (R, plan, maintenant) => tousLesReveils(R, plan, maintenant).length > REVEILS_MAX;

const signature = l => JSON.stringify(l.map(r => [r.minutes, tries(r.jours), !!r.actif, r.nom]));
export const memesReveils = (a, b) => signature(a) === signature(b);

// Première lecture : les réveils déjà dans le bracelet (réglés avec l'app Bionny) deviennent des rappels, rien n'est perdu
export const rappelsImportes = lus => lus.filter(r => r.nom !== NOM_REVEIL && r.nom !== NOM_COUCHER)
  .map(r => ({ minutes: r.minutes, jours: tries(r.jours), actif: r.actif, nom: r.nom || 'Rappel' }));

// « 7 h 20 lun, mar, jeu · 8 h 00 mer » pour le résumé des réveils
const COURTS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export const joursCourts = jours => (jours.length === 7 ? 'tous les jours' : jours.length ? tries(jours).map(j => COURTS[j]).join(', ') : 'une fois');
