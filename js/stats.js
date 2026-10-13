// Agrégats par jour et repères personnels, calculés uniquement à partir des mesures stockées (sante.js).
// Aucune valeur inventée : sans mesure, le champ vaut null. Pur, testé dans test/stats.test.js.
import { cleJour, debutJour, moyenne, ecartType, MIN, JOUR } from './sante.js';
import { trimp } from './coeur.js';

export function joursPasses(n, maintenant) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) { const d = new Date(maintenant); d.setDate(d.getDate() - k); out.push(cleJour(d)); }
  return out;
}
export function decalerJour(cle, n) {
  const d = new Date(debutJour(cle)); d.setDate(d.getDate() + n);
  return cleJour(d);
}

function grouper(serie = []) {
  const m = new Map();
  for (const x of serie) {
    const k = cleJour(x.t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
const mediane = v => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
const arrondi = (v, d = 0) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;

// Une entrée par jour : nuit qui se termine ce jour-là, cœur, activité, variabilité, oxygène, stress
export function journees(D, listeNuits, fcmax) {
  const idx = { fc: grouper(D.fc), vfc: grouper(D.vfc), spo2: grouper(D.spo2), stress: grouper(D.stress), activite: grouper(D.activite) };
  const nuitParJour = new Map(listeNuits.filter(n => n.tst).map(n => [n.cle, n]));
  const cles = new Set([...nuitParJour.keys(), ...Object.keys(D.pas || {}), ...Object.values(idx).flatMap(m => [...m.keys()])]);
  const out = new Map();
  for (const cle of [...cles].sort()) {
    const n = nuitParJour.get(cle) ?? null;
    const fc = idx.fc.get(cle) ?? [];
    const v = fc.map(x => x.v);
    const pasMesure = mediane(fc.slice(1).map((x, i) => x.t - fc[i].t));
    // chaque relevé représente au plus 1,5 fois l'intervalle habituel du bracelet (30 min maximum)
    const t = fc.length >= 2 ? trimp(fc, fcmax, Math.min(30 * MIN, Math.max(5 * MIN, 1.5 * pasMesure))) : null;
    const act = idx.activite.get(cle) ?? [];
    const pas = D.pas?.[cle] ?? null;
    const dist = act.length ? act.reduce((a, x) => a + (x.dist || 0), 0) : null;
    // distance gardée seulement si cohérente avec les pas (0,3 à 1,5 m par pas)
    const distOk = dist != null && pas > 300 && dist / pas >= .3 && dist / pas <= 1.5;
    const vfc = (idx.vfc.get(cle) ?? []).map(x => x.v);
    const stress = (idx.stress.get(cle) ?? []).map(x => x.v);
    const spo2 = (idx.spo2.get(cle) ?? []).map(x => x.v);
    out.set(cle, {
      cle, nuit: n,
      sommeil: n?.tst ?? null,
      rhr: n?.fcNuit?.repos ?? null,
      vfcNuit: n?.vfcNuit ?? null,
      spo2Nuit: n?.spo2Nuit?.moy ?? null,
      pas, distance: distOk ? dist : null,
      fc: v.length ? { min: Math.min(...v), moy: Math.round(moyenne(v)), max: Math.max(...v), n: v.length, intervalle: pasMesure } : null,
      charge: t?.charge ?? null, zones: t?.minutes ?? null,
      vfc: vfc.length ? Math.round(moyenne(vfc)) : null,
      stress: stress.length ? Math.round(moyenne(stress)) : null,
      spo2: spo2.length ? { moy: Math.round(moyenne(spo2)), min: Math.min(...spo2) } : null,
      seances: (D.seances || []).filter(s => cleJour(s.debut) === cle),
    });
  }
  return out;
}

// Repère personnel : moyenne et écart-type des `fenetre` jours avant `cle` (exclu), 5 valeurs minimum.
// La plage habituelle (moyenne ± 1 écart-type) reste dans les valeurs réellement observées (jamais négative).
export function repere(J, cle, champ, fenetre = 30) {
  const debut = decalerJour(cle, -fenetre);
  const v = [...J.values()].filter(j => j.cle >= debut && j.cle < cle).map(champ).filter(Number.isFinite);
  if (v.length < 5) return null;
  const m = moyenne(v), et = ecartType(v);
  return { n: v.length, moy: m, et, bas: Math.max(m - et, Math.min(...v)), haut: Math.min(m + et, Math.max(...v)) };
}

// Moyenne d'un champ sur les jours [debut, fin]
export function moyennePeriode(J, debut, fin, champ) {
  const v = [...J.values()].filter(j => j.cle >= debut && j.cle <= fin).map(champ).filter(Number.isFinite);
  return v.length ? { moy: moyenne(v), n: v.length } : null;
}

// 7 derniers jours contre les 7 d'avant. finHier : pour une mesure qui s'accumule dans la journée (pas…),
// la journée en cours, incomplète, est exclue et les deux semaines finissent hier.
export function comparerSemaines(J, maintenant, champ, finHier = false) {
  const fin = decalerJour(cleJour(maintenant), finHier ? -1 : 0);
  const a = moyennePeriode(J, decalerJour(fin, -6), fin, champ);
  const b = moyennePeriode(J, decalerJour(fin, -13), decalerJour(fin, -7), champ);
  return { cette: a, precedente: b, ecart: a && b ? a.moy - b.moy : null };
}

export function records(J, champ, sens = 'max') {
  let best = null;
  for (const j of J.values()) {
    const v = champ(j);
    if (!Number.isFinite(v)) continue;
    if (!best || (sens === 'max' ? v > best.v : v < best.v)) best = { cle: j.cle, v };
  }
  return best;
}

function correlation(a, b) {
  const ma = moyenne(a), mb = moyenne(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

// Contrôle de vraisemblance des mesures que le bracelet calcule lui-même, sur tes propres données.
// Physiologie : une vraie variabilité est plus haute pendant le sommeil (+10 % au moins ici) et baisse quand
// la FC monte (corrélation ≤ −0,15) ; un vrai stress fait l'inverse. Sinon, la mesure n'est pas affichée.
export function fiabilite(D, listeNuits) {
  const fc = [...(D.fc || [])].sort((a, b) => a.t - b.t);
  const nuits = listeNuits.filter(n => n.tst);
  const dansSommeil = t => nuits.some(n => t >= n.debut && t <= n.fin);
  const fcAutour = t => {
    let lo = 0, hi = fc.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (fc[m].t < t - 30 * MIN) lo = m + 1; else hi = m; }
    const v = [];
    for (let i = lo; i < fc.length && fc[i].t <= t + 30 * MIN; i++) v.push(fc[i].v);
    return v.length ? moyenne(v) : null;
  };
  const tester = (serie = [], sens) => {
    const avec = serie.map(x => ({ v: x.v, fc: fcAutour(x.t), nuit: dansSommeil(x.t) })).filter(x => x.fc != null);
    const nuit = avec.filter(x => x.nuit).map(x => x.v), jour = avec.filter(x => !x.nuit).map(x => x.v);
    if (nuit.length < 10 || jour.length < 10) return { fiable: false, assez: false, n: avec.length };
    const rapport = moyenne(nuit) / moyenne(jour), r = correlation(avec.map(x => x.v), avec.map(x => x.fc));
    const fiable = sens > 0 ? rapport >= 1.1 && r <= -0.15 : rapport <= 0.9 && r >= 0.15;
    return { fiable, assez: true, n: avec.length, nuit: moyenne(nuit), jour: moyenne(jour), r };
  };
  return { vfc: tester(D.vfc, 1), stress: tester(D.stress, -1) };
}

// Points d'attention : uniquement des écarts répétés à tes propres normales, chacun expliqué
export function pointsAttention(J, maintenant, objectifMin) {
  const out = [];
  const derniers = (n, champ) => joursPasses(n, maintenant).map(c => ({ cle: c, v: J.has(c) ? champ(J.get(c)) : null }));
  const serieHaute = (champ, seuil) => {
    let suite = 0;
    for (const { cle, v } of derniers(4, champ).reverse()) {
      const r = repere(J, cle, champ);
      if (!Number.isFinite(v) || !r) break;
      if (seuil(v, r)) suite++; else break;
    }
    return suite;
  };
  const rhr = serieHaute(j => j.rhr, (v, r) => v > r.haut && v - r.moy >= 3);
  if (rhr >= 2) out.push(`FC de repos au-dessus de ta normale ${rhr} nuits de suite. C'est souvent lié à la fatigue, au stress, à l'alcool ou à un début de maladie.`);
  const vfc = serieHaute(j => j.vfcNuit, (v, r) => v < r.bas);
  if (vfc >= 2) out.push(`Variabilité sous ta normale ${vfc} nuits de suite : ton corps récupère moins bien que d'habitude.`);
  const courtes = derniers(4, j => j.sommeil).filter(x => Number.isFinite(x.v) && x.v < objectifMin * MIN * .85).length;
  if (courtes >= 3) out.push(`${courtes} nuits sur les 4 dernières à moins de 85 % de ton objectif de sommeil.`);
  const coucher = joursPasses(7, maintenant).map(c => J.get(c)?.nuit?.debut).filter(Boolean)
    .map(t => { const d = new Date(t); return ((d.getHours() + 6) % 24) * 60 + d.getMinutes(); });
  const et = coucher.length >= 4 ? ecartType(coucher) : null;
  if (et != null && et > 60) out.push(`Heures d'endormissement très variables cette semaine (± ${Math.round(et)} min). Un horaire régulier aide autant que la durée.`);
  return out;
}

export { arrondi, mediane };
