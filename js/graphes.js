// Graphiques SVG dessinés à la largeur réelle de leur conteneur.
// Couleurs uniquement via les classes CSS (tokens clair/sombre). Infobulle commune à tous les graphes.
import { union, soustraire, duree, MIN, H, JOUR } from './sante.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hm = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const jourCourt = t => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
export const dateCourte = t => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function graduations(max, n = 3, pasFixe = null) {
  const brut = max / n, p = 10 ** Math.floor(Math.log10(brut || 1));
  const pas = pasFixe ?? [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= brut);
  const haut = Math.ceil(max / pas) * pas, v = [];
  for (let x = 0; x <= haut + 1e-9; x += pas) v.push(+x.toFixed(6));
  return { haut, v };
}

// Colonne arrondie côté valeur (4 px), carrée sur la ligne de base
function colonne(x, y, w, h, r = 4) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* ---------- Hypnogramme d'une nuit ---------- */

export const LIBELLES = { awake: 'Éveillé', rem: 'Paradoxal', core: 'Léger', deep: 'Profond', asleep: 'Endormi' };

export function blocsStades(n) {
  const de = k => union(n.segs.filter(x => x.k === k));
  // éveil = tout le temps au lit sans sommeil (déclaré ou non)
  const eveil = soustraire([{ s: n.debutLit, e: n.finLit }], n.dort);
  if (!n.aDesStades) return { awake: eveil, asleep: n.dort };
  const b = { awake: eveil };
  for (const k of ['rem', 'deep']) b[k] = soustraire(de(k), eveil);
  // « léger » + le sommeil sans stade précis, s'il y en a
  b.core = soustraire(n.dort, union([...b.rem, ...b.deep]));
  return b;
}

export function hypnogramme(n, largeur) {
  const voies = n.aDesStades ? ['awake', 'rem', 'core', 'deep'] : ['awake', 'asleep'];
  const G = 66, D = 6, hv = 20, gap = 2, haut0 = 2, axe = 20;
  const hauteur = haut0 + voies.length * (hv + gap) + axe;
  const a = n.debutLit, b = n.finLit, pw = largeur - G - D;
  const X = t => G + (t - a) / (b - a) * pw;
  const blocs = blocsStades(n);
  let svg = '';
  voies.forEach((k, i) => {
    const y = haut0 + i * (hv + gap);
    svg += `<text class="axe-txt" x="${G - 8}" y="${y + hv / 2}" text-anchor="end" dominant-baseline="central">${LIBELLES[k]}</text>`;
    svg += `<line class="grille" x1="${G}" x2="${G + pw}" y1="${y + hv + gap / 2}" y2="${y + hv + gap / 2}"/>`;
    for (const iv of blocs[k] || []) {
      const x = X(iv.s), w = Math.max(1.5, X(iv.e) - x);
      svg += `<rect class="st-${k}" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${hv}" rx="${Math.min(3, w / 2).toFixed(1)}" data-tip="${esc(`${LIBELLES[k]} · ${hm(iv.s)} → ${hm(iv.e)} (${duree(iv.e - iv.s)})`)}"/>`;
    }
  });
  const yAxe = haut0 + voies.length * (hv + gap);
  const heures = (b - a) / H, pasH = pw / heures >= 34 ? 1 : 2;
  const t0 = new Date(a); t0.setMinutes(0, 0, 0);
  for (let t = t0.getTime() + H; t < b; t += H) {
    const h = new Date(t).getHours();
    if (h % pasH) continue;
    svg += `<text class="axe-txt" x="${X(t)}" y="${yAxe + 14}" text-anchor="middle">${h} h</text>`;
  }
  return `<svg class="graphe-svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="Hypnogramme de la nuit">${svg}</svg>`;
}

/* ---------- Colonnes (durées de sommeil, pas) ---------- */

export function colonnes(donnees, { largeur, hauteur = 170, ref = null, refTexte = '', tick = v => v, etiquettes = [], label = '', pas = null, montrerX = null }) {
  const G = 40, D = 8, T = 18, B = 22, pw = largeur - G - D, ph = hauteur - T - B;
  const max = Math.max(ref ?? 0, ...donnees.map(d => d.v ?? 0)) || 1;
  const { haut, v: ticks } = graduations(max * 1.04, 3, pas);
  const Y = v => T + ph - v / haut * ph;
  const slot = pw / donnees.length, w = Math.max(1.5, Math.min(24, slot * .62));
  let svg = '';
  for (const t of ticks) {
    svg += `<line class="${t ? 'grille' : 'base'}" x1="${G}" x2="${G + pw}" y1="${Y(t)}" y2="${Y(t)}"/>`;
    svg += `<text class="axe-txt num" x="${G - 6}" y="${Y(t)}" text-anchor="end" dominant-baseline="central">${tick(t)}</text>`;
  }
  const pasLabel = Math.max(1, Math.ceil(26 / slot));
  donnees.forEach((d, i) => {
    const cx = G + slot * (i + .5), x = cx - w / 2;
    if (montrerX ? montrerX(i) : (donnees.length - 1 - i) % pasLabel === 0) svg += `<text class="axe-txt" x="${cx}" y="${T + ph + 15}" text-anchor="middle">${esc(d.x)}</text>`;
    if (d.v == null) return;
    const y = Y(d.v), h = T + ph - y;
    svg += `<g class="col" data-tip="${esc(d.tip)}" tabindex="0"><rect class="cible" x="${G + slot * i}" y="${T}" width="${slot}" height="${ph}"/>`
      + `<path class="barre${d.faible ? ' faible' : ''}" d="${colonne(x, y, w, Math.max(h, 1))}"/></g>`;
    if (etiquettes.includes(i)) {
      const bord = cx > G + pw - 24;   // près du bord droit : texte aligné à droite pour ne pas être coupé
      svg += `<text class="val-txt" x="${bord ? G + pw : cx}" y="${y - 6}" text-anchor="${bord ? 'end' : 'middle'}">${esc(d.etiquette ?? tick(d.v))}</text>`;
    }
  });
  if (ref != null) {
    svg += `<line class="ref" x1="${G}" x2="${G + pw}" y1="${Y(ref)}" y2="${Y(ref)}"/>`;
    svg += `<text class="ref-txt" x="${G + 4}" y="${Y(ref) - 5}">${esc(refTexte)}</text>`;
  }
  return `<svg class="graphe-svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="${esc(label)}">${svg}</svg>`;
}

/* ---------- Horaires de sommeil : une barre flottante par nuit ---------- */

const depuis18h = t => { const d = new Date(t); return ((d.getHours() + 6) % 24) * 60 + d.getMinutes() + d.getSeconds() / 60; };

// slots = [{ x: libellé, n: nuit ou null }] : une place par jour, même sans donnée, pour ne pas masquer les trous
export function plages(slots, largeur, hauteur = 220) {
  const G = 40, D = 8, T = 8, B = 22, pw = largeur - G - D, ph = hauteur - T - B;
  const ns = slots.filter(s => s.n);
  if (!ns.length) return '';
  const lo = Math.floor((Math.min(...ns.map(s => depuis18h(s.n.debut))) - 20) / 60) * 60;
  const hi = Math.ceil((Math.max(...ns.map(s => depuis18h(s.n.fin))) + 20) / 60) * 60;
  const Y = m => T + (m - lo) / (hi - lo) * ph;
  const slot = pw / slots.length, w = Math.max(1.5, Math.min(16, slot * .5));
  let svg = '';
  const pasTick = (hi - lo) / 60 > 8 ? 120 : 60;
  for (let m = lo; m <= hi; m += 60) {
    if ((m - lo) % pasTick) continue;
    const h = ((m / 60 + 18) % 24 + 24) % 24;
    svg += `<line class="grille" x1="${G}" x2="${G + pw}" y1="${Y(m)}" y2="${Y(m)}"/>`;
    svg += `<text class="axe-txt num" x="${G - 6}" y="${Y(m)}" text-anchor="end" dominant-baseline="central">${h} h</text>`;
  }
  const pasLabel = Math.max(1, Math.ceil(26 / slot));
  slots.forEach(({ x, n }, i) => {
    const cx = G + slot * (i + .5);
    if ((slots.length - 1 - i) % pasLabel === 0) svg += `<text class="axe-txt" x="${cx}" y="${T + ph + 15}" text-anchor="middle">${esc(x)}</text>`;
    if (!n) return;
    const y1 = Y(depuis18h(n.debut)), y2 = Y(depuis18h(n.fin));
    svg += `<g class="col" data-tip="${esc(`${titreNuit(n)} · ${hm(n.debut)} → ${hm(n.fin)} · ${duree(n.tst)}`)}" tabindex="0">`
      + `<rect class="cible" x="${G + slot * i}" y="${T}" width="${slot}" height="${ph}"/>`
      + `<rect class="barre" x="${cx - w / 2}" y="${y1}" width="${w}" height="${Math.max(2, y2 - y1)}" rx="${Math.min(4, w / 2)}"/></g>`;
  });
  return `<svg class="graphe-svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="Heures d'endormissement et de réveil">${svg}</svg>`;
}

export function titreNuit(n) {
  const veille = new Date(n.fin); veille.setDate(veille.getDate() - 1);
  const f = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  return `Nuit du ${f(veille)} au ${f(new Date(n.fin))}`;
}

/* ---------- Courbe (FC du jour, tendances par nuit) ---------- */

const registre = new Map();
let idCourbe = 0;

// plage = { bas, haut } : bande « ta plage habituelle » ; titre(t) = libellé de date de l'infobulle
export function courbe(points, { largeur, hauteur = 180, debut, fin, bandes = [], unite = '', coupure = 40 * MIN, marqueurs = false, classe = 'ligne-fc', format = v => Math.round(v), label = '', parJour = false, plage = null, titre = null }) {
  const G = 36, D = 10, T = 10, B = 22, pw = largeur - G - D, ph = hauteur - T - B;
  const vals = points.map(p => p.v).concat(plage ? [plage.bas, plage.haut] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const marge = Math.max(3, (hi - lo) * .12);
  lo = Math.floor((lo - marge) / 5) * 5; hi = Math.ceil((hi + marge) / 5) * 5;
  const X = t => G + (t - debut) / (fin - debut) * pw, Y = v => T + (1 - (v - lo) / (hi - lo)) * ph;
  let svg = '';
  for (const b of bandes) {
    const a = Math.max(debut, b.s), z = Math.min(fin, b.e);
    if (z > a) svg += `<rect class="bande" x="${X(a)}" y="${T}" width="${X(z) - X(a)}" height="${ph}"/>`;
  }
  if (plage) svg += `<rect class="plage" x="${G}" y="${Y(plage.haut)}" width="${pw}" height="${Math.max(1, Y(plage.bas) - Y(plage.haut))}"/>`;
  const pas = (hi - lo) / 4 >= 10 ? 20 : (hi - lo) / 4 >= 5 ? 10 : 5;
  for (let v = Math.ceil(lo / pas) * pas; v <= hi; v += pas) {
    svg += `<line class="grille" x1="${G}" x2="${G + pw}" y1="${Y(v)}" y2="${Y(v)}"/>`;
    svg += `<text class="axe-txt num" x="${G - 6}" y="${Y(v)}" text-anchor="end" dominant-baseline="central">${v}</text>`;
  }
  // axe du temps : heures sur une journée, jours au-delà
  if (parJour || fin - debut > 2 * JOUR) {
    let dernierX = Infinity;
    for (let i = points.length - 1; i >= 0; i--) {
      const x = X(points[i].t);
      if (dernierX - x < 26) continue;
      dernierX = x;
      svg += `<text class="axe-txt" x="${x}" y="${T + ph + 15}" text-anchor="middle">${new Date(points[i].t).getDate()}</text>`;
    }
  } else {
    const etape = (fin - debut) / H > 14 ? 6 : 3, t0 = new Date(debut); t0.setMinutes(0, 0, 0);
    for (let t = t0.getTime() + H; t < fin; t += H) {
      const h = new Date(t).getHours();
      if (h % etape) continue;
      if (X(t) < G + 12 || X(t) > G + pw - 12) continue;
      svg += `<text class="axe-txt" x="${X(t)}" y="${T + ph + 15}" text-anchor="middle">${h} h</text>`;
    }
  }
  // tracé, interrompu là où il manque des mesures (on ne relie pas les trous)
  let d = '';
  points.forEach((p, i) => { d += `${i && p.t - points[i - 1].t <= coupure ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`; });
  svg += `<path class="${classe}" d="${d}"/>`;
  if (marqueurs && points.length <= 31) for (const p of points) svg += `<circle class="marqueur ${classe}" cx="${X(p.t)}" cy="${Y(p.v)}" r="4"/>`;
  const der = points.at(-1);
  svg += `<circle class="marqueur ${classe}" cx="${X(der.t)}" cy="${Y(der.v)}" r="4"/>`;

  const id = 'c' + ++idCourbe;
  registre.set(id, {
    pts: points.map(p => ({ x: X(p.t), y: Y(p.v), t: p.t, v: p.v })),
    texte: p => `${titre ? titre(p.t) : parJour ? dateCourte(p.t) : `${jourCourt(p.t)} ${hm(p.t)}`} · ${format(p.v)} ${unite}`.trim(),
    haut: T, bas: T + ph,
  });
  svg += `<line class="curseur-ligne" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`
    + `<circle class="curseur-point ${classe}" r="4.5" visibility="hidden"/>`
    + `<rect class="zone-curseur" x="${G}" y="${T}" width="${pw}" height="${ph}"/>`;
  return `<svg class="graphe-svg" data-curseur="${id}" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="${esc(label)}">${svg}</svg>`;
}

/* ---------- Calendrier d'un mois ---------- */

// Une case par jour, teintée d'une seule couleur en 5 paliers selon la valeur (bornes = min et max affichés en légende).
// Les cases sont des boutons : data-jour = clé du jour, pour choisir le jour détaillé.
export function calendrier(mois, valeurs, { format, selection, aujourdhui, bornes }) {
  const [y, m] = mois.split('-').map(Number);
  const decalage = (new Date(y, m - 1, 1).getDay() + 6) % 7, nbJours = new Date(y, m, 0).getDate();
  const ecart = bornes && bornes.max > bornes.min ? bornes.max - bornes.min : 0;
  const palier = v => ecart ? Math.min(4, Math.floor((v - bornes.min) / ecart * 5)) : 2;
  let h = '<div class="cal-grille">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(j => `<span class="cal-entete" aria-hidden="true">${j}</span>`).join('');
  for (let i = 0; i < decalage; i++) h += '<span></span>';
  for (let d = 1; d <= nbJours; d++) {
    const cle = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const v = valeurs.get(cle);
    const cls = ['cal-jour', Number.isFinite(v) ? `p${palier(v)}` : 'vide', cle === selection ? 'sel' : '', cle === aujourdhui ? 'auj' : ''].filter(Boolean).join(' ');
    const date = new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const txt = `${date} · ${Number.isFinite(v) ? format(v) : 'pas de donnée'}`;
    h += `<button class="${cls}" data-jour="${cle}"${cle > aujourdhui ? ' disabled' : ''} aria-label="${esc(txt)}" data-tip="${esc(txt)}">${d}</button>`;
  }
  return h + '</div>';
}

/* ---------- Infobulle et curseur ---------- */

let tip;
function montrer(txt, x, y) {
  tip.textContent = txt;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const l = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2));
  let t = y - r.height - 12;
  if (t < 8) t = y + 18;
  tip.style.left = l + 'px';
  tip.style.top = t + 'px';
}
function cacher() {
  if (tip) tip.hidden = true;
  document.querySelectorAll('.curseur-ligne, .curseur-point').forEach(e => e.setAttribute('visibility', 'hidden'));
}

export function initInfobulles() {
  tip = document.getElementById('tip');
  const cible = e => e.target.closest?.('[data-tip]');
  document.addEventListener('pointerdown', e => {
    const el = cible(e);
    if (el) montrer(el.dataset.tip, e.clientX, e.clientY);
    else if (!e.target.closest?.('[data-curseur]')) cacher();
  });
  document.addEventListener('pointermove', e => { const el = cible(e); if (el && e.pointerType !== 'touch') montrer(el.dataset.tip, e.clientX, e.clientY); });
  document.addEventListener('pointerout', e => { if (cible(e) && e.pointerType !== 'touch') cacher(); });
  document.addEventListener('focusin', e => {
    const el = cible(e);
    if (!el) return;
    const r = el.getBoundingClientRect();
    montrer(el.dataset.tip, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', cacher);
  addEventListener('scroll', cacher, { passive: true });
}

export function activerGraphes(racine) {
  racine.querySelectorAll('[data-curseur]').forEach(svg => {
    const cfg = registre.get(svg.dataset.curseur);
    if (!cfg) return;
    const ligne = svg.querySelector('.curseur-ligne'), point = svg.querySelector('.curseur-point'), zone = svg.querySelector('.zone-curseur');
    const maj = e => {
      const r = svg.getBoundingClientRect(), x = e.clientX - r.left;
      const P = cfg.pts;
      let lo = 0, hi = P.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].x < x) lo = m; else hi = m; }
      const p = Math.abs(P[lo].x - x) <= Math.abs(P[hi].x - x) ? P[lo] : P[hi];
      ligne.setAttribute('x1', p.x); ligne.setAttribute('x2', p.x); ligne.setAttribute('visibility', 'visible');
      point.setAttribute('cx', p.x); point.setAttribute('cy', p.y); point.setAttribute('visibility', 'visible');
      montrer(cfg.texte(p), r.left + p.x, r.top + p.y);
    };
    zone.addEventListener('pointermove', maj);
    zone.addEventListener('pointerdown', maj);
    zone.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') cacher(); });
  });
}

export function viderRegistre() { registre.clear(); }
