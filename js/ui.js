// Outils d'affichage partagés par les vues : formats, tuiles, pastilles, graphes placés à la largeur réelle.
import { duree, debutJour, total } from './sante.js';
import { activerGraphes, viderRegistre, blocsStades, LIBELLES } from './graphes.js';

export const $ = s => document.querySelector(s);
export const nf = n => Math.round(n).toLocaleString('fr-FR');
export const pct = x => Math.round(x * 100) + ' %';
export const km = m => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10000 ? 2 : 1 }) + ' km';
export const compact = v => v >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : String(Math.round(v));
export const dateLongue = t => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const dateCle = (cle, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(debutJour(cle)).toLocaleDateString('fr-FR', opts);
export const signe = (x, f = v => v) => (x > 0 ? '+' : x < 0 ? '−' : '') + f(Math.abs(x));
export const signeDuree = ms => (ms >= 0 ? '+' : '−') + duree(ms);
export const aDesDonnees = D => D.sommeil.length || D.fc.length || Object.keys(D.pas).length || D.vfc.length;

let toastT;
export function toast(m) {
  const el = $('#toast');
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), Math.max(3200, m.length * 55));
}

const ICONES = {
  ok: '<path d="M5 12.5l4.2 4L19 7"/>',
  moyen: '<path d="M12 6v7.5M12 18v.01"/>',
  bas: '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>',
  info: '<path d="M12 11v7M12 6.5v.01"/>',
};
export const pastille = (niveau, petite) => `<span class="pastille ${niveau}${petite ? ' petite' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONES[niveau]}</svg></span>`;

// [libellé, valeur (HTML déjà sûr), précision (HTML déjà sûr)]
export const tuiles = (liste, cls = '') => `<div class="tuiles ${cls}">${liste.filter(Boolean).map(([l, v, e]) => `<div><span>${l}</span><strong>${v}</strong>${e ? `<em>${e}</em>` : ''}</div>`).join('')}</div>`;

// Situe une valeur par rapport à la normale personnelle (moyenne ± 1 écart-type sur 30 jours)
export function faceNormale(v, r, f = x => Math.round(x)) {
  if (!r || !Number.isFinite(v)) return '';
  const pos = v > r.haut ? 'au-dessus de ta normale' : v < r.bas ? 'sous ta normale' : 'dans ta normale';
  return `${pos} (${f(r.moy)})`;
}

// D'où viennent les heures d'une nuit : ta règle (ton pouls au-dessus ou en dessous de ton pouls d'éveil), le
// bracelet quand le pouls manque. Texte brut (à échapper), vide s'il n'y a rien à dire.
const hh = t => { const d = new Date(t); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`; };
export function origineNuit(n) {
  const reveils = n.reveils ? ` ${n.reveils} réveil${n.reveils > 1 ? 's' : ''} dans la nuit, comptés éveillés.` : '';
  if (n.source === 'pouls') return (n.debutBracelet != null
    ? `Heures d'après ton pouls : le bracelet plaçait ta nuit de ${hh(n.debutBracelet)} à ${hh(n.finBracelet)}, ton pouls dit autre chose. Sans phases.`
    : "Heures d'après ton pouls, le bracelet n'a pas noté cette nuit. Sans phases.") + reveils;
  if (n.controle === 'confirmee') {
    const p = [];
    if (n.debutSource === 'pouls') p.push(`endormi à ${hh(n.debutBracelet)}`);
    if (n.finSource === 'pouls') p.push(`réveillé à ${hh(n.finBracelet)}`);
    return `Heures d'après ton pouls${p.length ? ` (le bracelet te disait ${p.join(', ')})` : ', comme le bracelet'}, phases du bracelet.${reveils}`;
  }
  if (n.controle === null && n.tst) return 'Heures du bracelet : pas assez de relevés de pouls pour appliquer ta règle.';
  return n.tst ? 'Heures du bracelet : ton pouls est resté au-dessus de ton pouls d\'éveil, ta règle ne trouve pas cette nuit.' : '';
}

// Une heure ou une durée ne se coupe pas en fin de ligne (« 7 h » / « 10 ») : espaces insécables
export const insecable = html => html.replace(/(\d) h (\d)/g, '$1\u00a0h\u00a0$2').replace(/(\d) (min|bpm|pas|%)(?![\w-])/g, '$1\u00a0$2');

export function barreProgression(v, objectif) {
  const p = Math.max(0, Math.min(1, v / objectif));
  return `<span class="progression" role="progressbar" aria-valuemin="0" aria-valuemax="${objectif}" aria-valuenow="${Math.round(v)}"><i style="width:${(p * 100).toFixed(1)}%"></i></span>`;
}

export function tableStades(n) {
  const b = blocsStades(n);
  const ordre = n.aDesStades ? ['deep', 'core', 'rem', 'awake'] : ['asleep', 'awake'];
  const lignes = ordre.map(k => {
    const d = total(b[k] || []);
    return `<tr><td><i class="st-bg-${k}"></i>${LIBELLES[k]}</td><td class="droite">${duree(d)}</td><td class="droite">${Math.round(d / n.lit * 100)} %</td></tr>`;
  }).join('');
  return `<table class="table-stades"><thead><tr><th>Stade</th><th class="droite">Durée</th><th class="droite">Part</th></tr></thead><tbody>${lignes}</tbody></table>`
    + (n.aDesStades ? '' : '<p class="note">Pas de stades (profond, paradoxal) pour cette nuit.</p>');
}

// Les graphes sont dessinés après insertion, à la largeur réelle de leur conteneur
let graphes = {};
export function nouveauxGraphes() { graphes = {}; }
export function placer(id, fn) { graphes[id] = fn; return `<div class="graphe" data-graphe="${id}"></div>`; }
export function dessinerGraphes(racine) {
  viderRegistre();
  racine.querySelectorAll('[data-graphe]').forEach(el => { el.innerHTML = graphes[el.dataset.graphe]?.(el.clientWidth) ?? ''; });
  activerGraphes(racine);
}
