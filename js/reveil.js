// Réveils et rappels que ViaWrist écrit dans le bracelet (qui vibre ensuite tout seul, téléphone éteint compris).
// Dans l'ordre : le réveil vibreur à tes heures de lever (une alarme par heure, avec ses jours), le rappel du coucher
// (30 min avant l'heure conseillée ce soir, mis à jour à chaque connexion), puis tes rappels. 10 au plus.
// Pur, testé dans test/reveil.test.js.
import { REVEILS_MAX } from './bracelet.js';

export const AVANT_COUCHER = 30;   // minutes avant l'heure de coucher conseillée
export const NOM_REVEIL = 'Reveil', NOM_COUCHER = 'Coucher';
const enMinutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const tries = j => [...j].sort((a, b) => a - b);

// R.vibreur = { reveil, coucher, rappels: [{ minutes, jours, actif, nom }] } ; plan = planSommeil(contexte)
export function reveilsVoulus(R, plan, maintenant) {
  const v = R.vibreur || {}, out = [];
  if (v.reveil) {
    const parHeure = new Map();
    for (const [j, h] of Object.entries(R.leverJours || {})) {
      const m = enMinutes(h);
      parHeure.set(m, [...(parHeure.get(m) || []), Number(j)]);
    }
    for (const [minutes, jours] of [...parHeure].sort((a, b) => a[0] - b[0])) out.push({ minutes, jours: tries(jours), actif: true, nom: NOM_REVEIL });
  }
  if (v.coucher && plan?.coucher != null) {
    // l'heure de coucher est comptée depuis minuit du matin visé : la veille au soir si elle est après midi
    const matin = new Date(maintenant);
    if (matin.getHours() >= 5) matin.setDate(matin.getDate() + 1);
    matin.setHours(0, 0, 0, 0);
    const c = ((Math.round(plan.coucher) % 1440) + 1440) % 1440;
    const rappel = new Date(matin.getTime() + ((c >= 12 * 60 ? c - 1440 : c) - AVANT_COUCHER) * 60e3);
    out.push({ minutes: rappel.getHours() * 60 + rappel.getMinutes(), jours: [rappel.getDay()], actif: true, nom: NOM_COUCHER });
  }
  for (const r of v.rappels || []) out.push({ minutes: r.minutes, jours: tries(r.jours), actif: !!r.actif, nom: r.nom || 'Rappel' });
  return out.slice(0, REVEILS_MAX);
}

export const tropDeReveils = (R, plan, maintenant) => {
  const v = R.vibreur || {};
  return (v.reveil ? new Set(Object.values(R.leverJours || {})).size : 0) + (v.coucher && plan?.coucher != null ? 1 : 0) + (v.rappels || []).length > REVEILS_MAX;
};

const signature = l => JSON.stringify(l.map(r => [r.minutes, tries(r.jours), !!r.actif, r.nom]));
export const memesReveils = (a, b) => signature(a) === signature(b);

// Première lecture : les réveils déjà dans le bracelet (réglés avec l'app Bionny) deviennent des rappels, rien n'est perdu
export const rappelsImportes = lus => lus.filter(r => r.nom !== NOM_REVEIL && r.nom !== NOM_COUCHER)
  .map(r => ({ minutes: r.minutes, jours: tries(r.jours), actif: r.actif, nom: r.nom || 'Rappel' }));

// « 7 h 20 lun, mar, jeu · 8 h 00 mer » pour le résumé des réveils
const COURTS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export const joursCourts = jours => (jours.length === 7 ? 'tous les jours' : jours.length ? tries(jours).map(j => COURTS[j]).join(', ') : 'une fois');
