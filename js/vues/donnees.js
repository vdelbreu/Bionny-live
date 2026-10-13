// Onglet Données : un sous-onglet par mesure. En haut le détail du jour choisi (avec une phrase qui explique),
// en dessous la tendance sur 7, 30 ou 90 jours et le calendrier du mois (touche un jour pour le détailler).
import { duree, cleJour, debutJour, moyenne, MIN, H, JOUR } from '../sante.js';
import { hypnogramme, colonnes, plages, courbe, calendrier, esc, hm, dateCourte } from '../graphes.js';
import { ZONES } from '../coeur.js';
import { repere, joursPasses, decalerJour } from '../stats.js';
import { effort, phraseCoeur } from '../coach.js';
import { $, nf, km, pct, compact, dateCle, tuiles, faceNormale, barreProgression, tableStades, aDesDonnees, placer, dessinerGraphes, nouveauxGraphes } from '../ui.js';

const E = { onglet: 'sommeil', jour: null, plage: 30, mois: null };

const ONGLETS = [
  { id: 'sommeil', nom: 'Sommeil', tendance: 'Durée de sommeil', champ: j => j.sommeil, format: v => duree(v) },
  { id: 'activite', nom: 'Activité', tendance: 'Pas par jour', champ: j => j.pas, format: v => `${nf(v)} pas`, partiel: true },
  { id: 'coeur', nom: 'Cœur', tendance: 'FC de repos', champ: j => j.rhr, format: v => `${v} bpm` },
  { id: 'oxygene', nom: 'Oxygène', tendance: 'Oxygène la nuit', champ: j => j.spo2Nuit, format: v => `${v} %` },
  // mesures calculées par le bracelet : visibles seulement si elles passent le contrôle de fiabilité
  { id: 'recup', nom: 'Variabilité', tendance: 'Variabilité la nuit', champ: j => j.vfcNuit, format: v => `${v} ms`, visible: c => c.fiab.vfc.fiable },
  { id: 'stress', nom: 'Stress', tendance: 'Stress moyen du jour', champ: j => j.stress, format: v => `${v}`, partiel: true, visible: c => c.fiab.stress.fiable },
];

export function ouvrirDonnees(onglet, jour) {
  if (ONGLETS.some(o => o.id === onglet)) E.onglet = onglet;
  if (/^\d{4}-\d{2}-\d{2}$/.test(jour || '')) { E.jour = jour; E.mois = jour.slice(0, 7); }
}

const moisDecale = (mois, d) => {
  const [y, m] = mois.split('-').map(Number), t = new Date(y, m - 1 + d, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
};

export function brancherDonnees(rafraichir) {
  $('#vue-donnees').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.dataset.aller || b.dataset.supprimer) return;
    const d = b.dataset;
    if (d.onglet) E.onglet = d.onglet;
    else if (d.jour) { E.jour = d.jour; E.mois = d.jour.slice(0, 7); }
    else if (d.navJour) { E.jour = decalerJour(E.jour, +d.navJour); E.mois = E.jour.slice(0, 7); }
    else if (d.plage) E.plage = +d.plage;
    else if (d.mois) E.mois = moisDecale(E.mois, +d.mois);
    else return;
    rafraichir();
    if (d.jour) $('.jour-nav')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

export function rendreDonnees(c) {
  nouveauxGraphes();
  const el = $('#vue-donnees'), auj = cleJour(c.maintenant);
  if (!E.jour || E.jour > auj) E.jour = auj;
  if (!E.mois || E.mois > auj.slice(0, 7)) E.mois = E.jour.slice(0, 7);
  const entete = '<div class="entete"><div><h2 class="titre-vue">Données</h2></div></div>';
  if (!aDesDonnees(c.D)) {
    el.innerHTML = entete + `<article class="panel"><p class="note fort">Pas encore de données. Synchronise ton bracelet depuis l'onglet Aujourd'hui.</p>
      <div class="actions"><button class="primary" data-aller="jour">Aller à Aujourd'hui</button></div></article>`;
    return;
  }
  const visibles = ONGLETS.filter(x => !x.visible || x.visible(c));
  const o = visibles.find(x => x.id === E.onglet) ?? visibles[0];
  el.innerHTML = entete
    + `<div class="sous-onglets" role="tablist" aria-label="Mesures">${visibles.map(x => `<button role="tab" aria-selected="${x.id === o.id}" data-onglet="${x.id}">${x.nom}</button>`).join('')}</div>`
    + navJour(o, auj)
    + DETAILS[o.id](c, E.jour)
    + tendance(c, o, auj);
  dessinerGraphes(el);
}

function navJour(o, auj) {
  const titre = o.id === 'sommeil'
    ? `Nuit du ${dateCle(decalerJour(E.jour, -1), { weekday: 'short', day: 'numeric' })} au ${dateCle(E.jour, { weekday: 'short', day: 'numeric', month: 'short' })}`
    : dateCle(E.jour, { weekday: 'long', day: 'numeric', month: 'long' });
  return `<div class="jour-nav">
    <button class="nav-fleche" data-nav-jour="-1" aria-label="Jour précédent">‹</button>
    <strong>${esc(titre)}</strong>
    <button class="nav-fleche" data-nav-jour="1"${E.jour >= auj ? ' disabled' : ''} aria-label="Jour suivant">›</button>
    ${E.jour !== auj ? `<button class="petit" data-jour="${auj}">Aujourd'hui</button>` : ''}
  </div>`;
}

const panneau = (contenu, titre = '') => `<article class="panel">${titre ? `<h3>${titre}</h3>` : ''}${contenu}</article>`;
const rien = txt => panneau(`<p class="note fort">${txt}</p>`);
// explications repliées : les chiffres d'abord, le texte seulement si on le demande
const aide = txt => `<details class="comprendre"><summary>Comprendre</summary><p class="explication">${txt}</p></details>`;
const dansJour = (serie, cle, avant = 0) => { const d0 = debutJour(cle); return (serie || []).filter(x => x.t >= d0 - avant && x.t < d0 + JOUR); };

/* ---------- Détail du jour, par mesure ---------- */

const DETAILS = {
  sommeil(c, cle) {
    const n = c.J.get(cle)?.nuit;
    if (!n) return rien('Pas de nuit enregistrée pour ce jour.');
    const obj = c.R.objectif * MIN;
    const fc = c.D.fc.filter(x => x.t >= n.debutLit && x.t <= n.finLit);
    const pendant = [
      n.fcNuit && ['FC de repos', `${n.fcNuit.repos}<small>bpm</small>`, faceNormale(n.fcNuit.repos, repere(c.J, cle, x => x.rhr)) || 'cette nuit'],
      n.vfcNuit && ['Variabilité', `${n.vfcNuit}<small>ms</small>`, 'moyenne de la nuit'],
      n.spo2Nuit && ['Oxygène', `${n.spo2Nuit.moy}<small>%</small>`, `minimum ${n.spo2Nuit.min} %`],
    ];
    return panneau(`
      <div><div class="hero-fig">${duree(n.tst)}<small>de sommeil</small></div>
      <p class="sous">Endormi à ${hm(n.debut)}, réveillé à ${hm(n.fin)} · ${n.tst >= obj ? 'objectif atteint' : `${duree(obj - n.tst)} sous ton objectif`}</p></div>
      ${tuiles([
        n.aDesStades && ['Profond', duree(n.stades.deep), pct(n.stades.deep / n.tst) + ' du sommeil'],
        n.aDesStades && ['Paradoxal', duree(n.stades.rem), pct(n.stades.rem / n.tst) + ' du sommeil'],
        ['Réveils', n.reveils, 'de plus de 5 min'],
        n.efficacite != null && ['Efficacité', pct(n.efficacite), 'sommeil ÷ temps au lit'],
      ])}
      ${aide("Le sommeil profond répare le corps, le paradoxal (les rêves) trie la mémoire et les émotions. Au poignet, ces phases sont des estimations : fie-toi surtout à la durée.")}
      ${placer('hypno', w => hypnogramme(n, w))}
      ${tableStades(n)}`)
      + (pendant.some(Boolean) ? panneau(tuiles(pendant)
        + (fc.length >= 2 ? placer('fcNuit', w => courbe(fc, { largeur: w, hauteur: 150, debut: n.debutLit, fin: n.finLit, unite: 'bpm', label: 'Pouls pendant la nuit' })) : '')
        + aide('Ton pouls descend pendant le sommeil : plus il descend bas, mieux ton corps récupère.'), 'Pendant la nuit') : '');
  },

  activite(c, cle) {
    const j = c.J.get(cle) ?? {}, d0 = debutJour(cle);
    const quarts = dansJour(c.D.activite, cle);
    const seances = (c.D.seances || []).filter(s => s.fin > d0 && s.debut < d0 + JOUR);
    if (j.pas == null && !quarts.length && !seances.length) return rien("Pas d'activité enregistrée ce jour-là.");
    const parHeure = Array(24).fill(0);
    for (const q of quarts) parHeure[new Date(q.t).getHours()] += q.v;
    const e = effort(c, d0, Math.min(d0 + JOUR, c.maintenant));
    const liste = seances.map(s => `<li><span>${s.declare ? 'Sport déclaré' : 'Séance'} · ${hm(s.debut)}</span><strong>${duree(s.fin - s.debut)}</strong>
      <em>${s.declare ? (s.intensite === 'soutenu' ? 'soutenu, compte double' : 'tranquille') : `FC moyenne ${s.moy}, max ${s.max}`}</em>
      <button class="lien" data-supprimer="${s.debut}">Supprimer</button></li>`).join('');
    return panneau(`
      ${tuiles([
        j.pas != null && ['Pas', nf(j.pas), `objectif ${nf(c.R.objectifPas)}${barreProgression(j.pas, c.R.objectifPas)}`],
        j.distance != null && ['Distance', km(j.distance), 'comptée par le bracelet'],
        ['Effort', `${e.total}<small>min</small>`, 'cœur au-dessus de 64 % de ton max, sport déclaré compris'],
        quarts.length && ['Heures actives', `${parHeure.filter(v => v >= 250).length}<small>h</small>`, 'avec au moins 250 pas'],
      ])}
      ${quarts.length ? placer('pasHeure', w => colonnes(parHeure.map((v, h) => ({ x: `${h} h`, v: v || null, tip: `${h} h – ${h + 1} h · ${nf(v)} pas` })),
        { largeur: w, hauteur: 150, tick: compact, label: 'Pas par heure', montrerX: h => h % 6 === 0 })) : ''}
      ${aide("Comptés par le bracelet, porté toute la journée. L'app Santé de l'iPhone en affiche souvent moins : elle ne compte que les pas faits avec le téléphone sur toi.")}`)
      + (liste ? panneau(`<ul class="liste">${liste}</ul>`, 'Sport') : '');
  },

  coeur(c, cle) {
    const j = c.J.get(cle) ?? {}, d0 = debutJour(cle), fin = Math.min(d0 + JOUR, c.maintenant);
    const pts = dansJour(c.D.fc, cle);
    if (!pts.length && j.rhr == null) return rien('Pas de relevé de pouls ce jour-là.');
    const r = repere(c.J, cle, x => x.rhr);
    const bandes = c.ns.filter(n => n.tst && n.fin > d0 && n.debut < d0 + JOUR).map(n => ({ s: n.debut, e: n.fin }));
    const parHeure = new Map();
    for (const p of pts) { const h = new Date(p.t).getHours(); if (!parHeure.has(h)) parHeure.set(h, []); parHeure.get(h).push(p.v); }
    const lignes = [...parHeure.entries()].map(([h, l]) => `<tr><td>${h} h</td><td class="droite">${Math.min(...l)}</td><td class="droite">${Math.round(moyenne(l))}</td><td class="droite">${Math.max(...l)}</td></tr>`).join('');
    return panneau(`
      ${tuiles([
        j.rhr != null && ['FC de repos', `${j.rhr}<small>bpm</small>`, r ? `ta normale : ${Math.round(r.bas)} à ${Math.round(r.haut)}` : 'la nuit précédente'],
        j.fc && ['Pouls moyen', `${j.fc.moy}<small>bpm</small>`, `de ${j.fc.min} à ${j.fc.max} sur la journée`],
      ])}
      ${j.rhr != null ? aide(esc(phraseCoeur(j.rhr, r))) : ''}
      ${pts.length >= 2 ? placer('fcJour', w => courbe(pts, { largeur: w, debut: d0, fin, bandes, unite: 'bpm', label: 'Pouls de la journée' })) : ''}
      ${bandes.length ? '<div class="legende"><span><i class="carre bande"></i>Sommeil</span></div>' : ''}`)
      + (j.zones ? panneau(barresZones(j.zones, c.fcmax) + aide("Le temps passé à chaque intensité, d'après un relevé toutes les 5 min environ.")
        + `<details><summary>Valeurs heure par heure</summary><div class="defile"><table><thead><tr><th>Heure</th><th class="droite">Min</th><th class="droite">Moy.</th><th class="droite">Max</th></tr></thead><tbody>${lignes}</tbody></table></div></details>`, 'Intensité de la journée') : '');
  },

  oxygene(c, cle) {
    const j = c.J.get(cle) ?? {}, pts = dansJour(c.D.spo2, cle);
    if (!pts.length && j.spo2Nuit == null) return rien("Pas de mesure d'oxygène ce jour-là.");
    return panneau(`${tuiles([
        j.spo2Nuit != null && ['La nuit', `${j.spo2Nuit}<small>%</small>`, j.nuit?.spo2Nuit ? `minimum ${j.nuit.spo2Nuit.min} %` : 'moyenne'],
        j.spo2 && ['Sur la journée', `${j.spo2.moy}<small>%</small>`, `minimum ${j.spo2.min} %`],
      ])}
      ${pts.length >= 2 ? placer('spo2Jour', w => courbe(pts, { largeur: w, hauteur: 160, debut: debutJour(cle), fin: Math.min(debutJour(cle) + JOUR, c.maintenant), classe: 'ligne-serie', unite: '%', coupure: 2 * H, label: 'Oxygène par heure' })) : ''}
      ${aide("La part d'oxygène dans ton sang. Entre 95 et 100 %, c'est normal. Au poignet, la mesure est approximative : regarde la tendance.")}`);
  },

  recup(c, cle) {
    const j = c.J.get(cle) ?? {}, pts = dansJour(c.D.vfc, cle, 6 * H);
    if (j.vfcNuit == null && !pts.length) return rien('Pas de mesure de variabilité pour ce jour.');
    return panneau(`${tuiles([j.vfcNuit != null && ['Variabilité', `${j.vfcNuit}<small>ms</small>`, faceNormale(j.vfcNuit, repere(c.J, cle, x => x.vfcNuit)) || 'moyenne de la nuit']])}
      ${pts.length >= 2 ? placer('vfcJour', w => courbe(pts, { largeur: w, hauteur: 160, debut: debutJour(cle) - 6 * H, fin: Math.min(debutJour(cle) + JOUR, c.maintenant), classe: 'ligne-serie', unite: 'ms', coupure: 2 * H, label: 'Variabilité' })) : ''}
      ${aide('Plus haute que ta normale : corps reposé. Plus basse : fatigue, stress, maladie ou alcool.')}`);
  },

  stress(c, cle) {
    const pts = dansJour(c.D.stress, cle);
    if (!pts.length) return rien('Pas de mesure de stress ce jour-là.');
    return panneau(`${placer('stressJour', w => courbe(pts, { largeur: w, hauteur: 160, debut: debutJour(cle), fin: Math.min(debutJour(cle) + JOUR, c.maintenant), classe: 'ligne-serie', coupure: 2 * H, label: 'Stress' }))}
      ${aide('Indice calculé par le bracelet toutes les 30 min.')}`);
  },
};

function barresZones(minutes, fcmax) {
  const tot = minutes.reduce((a, b) => a + b, 0) || 1;
  return `<div class="zones">${ZONES.map((z, i) => {
    const lo = Math.round(z.bas * fcmax), hi = i < 5 ? Math.round(ZONES[i + 1].bas * fcmax) - 1 : null;
    const plage = i === 0 ? `< ${Math.round(.5 * fcmax)}` : hi ? `${lo}–${hi}` : `${lo}+`;
    return `<div class="zrow" style="--zc:var(${z.c})"><code>${z.k}</code><div class="zmid"><span class="znom">${z.nom} <span class="note">${plage} bpm</span></span>
      <div class="zbar"><i style="width:${(minutes[i] / tot * 100).toFixed(1)}%"></i></div></div><code class="num" style="text-align:right">${duree(minutes[i] * MIN)}</code></div>`;
  }).join('')}</div>`;
}

/* ---------- Tendance et calendrier ---------- */

function tendance(c, o, auj) {
  const cles = joursPasses(E.plage, c.maintenant);
  const val = k => { const j = c.J.get(k); const v = j ? o.champ(j) : null; return Number.isFinite(v) ? v : null; };
  // journée en cours incomplète (pas, stress) : exclue des statistiques, de la normale et des couleurs
  const v = cles.filter(k => !(o.partiel && k === auj)).map(val).filter(x => x != null);
  const normale = repere(c.J, o.partiel ? auj : decalerJour(auj, 1), o.champ);
  const f = x => o.format(o.id === 'sommeil' ? x : Math.round(x));
  const resume = v.length ? `Moyenne ${f(moyenne(v))} · de ${f(Math.min(...v))} à ${f(Math.max(...v))}` : 'Pas de mesure sur cette période.';
  const segment = `<div class="segment" role="group" aria-label="Période">${[7, 30, 90].map(p => `<button class="petit" data-plage="${p}" aria-pressed="${E.plage === p}">${p} j</button>`).join('')}</div>`;

  let graphe = '';
  if (cles.some(k => val(k) != null)) {
    const etiquette = k => String(new Date(debutJour(k)).getDate());
    if (o.id === 'sommeil') {
      graphe = placer('tSommeil', w => colonnes(cles.map(k => ({ x: etiquette(k), v: val(k) != null ? val(k) / H : null, tip: `${dateCle(k)} · ${val(k) != null ? duree(val(k)) : 'pas de nuit'}` })),
        { largeur: w, ref: c.R.objectif / 60, refTexte: `objectif ${duree(c.R.objectif * MIN)}`, tick: x => `${x} h`, pas: 2, label: o.tendance }));
      if (E.plage <= 30) graphe += '<h4 class="sous-titre">Horaires</h4>' + placer('tPlages', w => plages(cles.map(k => ({ x: etiquette(k), n: c.J.get(k)?.nuit ?? null })), w, 190))
        + aide('Des barres alignées veulent dire un rythme régulier : ça compte autant que la durée.');
    } else if (o.id === 'activite') {
      graphe = placer('tPas', w => colonnes(cles.map(k => ({ x: etiquette(k), v: val(k), faible: k === auj, tip: `${dateCle(k)} · ${val(k) != null ? nf(val(k)) + ' pas' : 'pas de mesure'}${k === auj ? ', en cours' : ''}` })),
        { largeur: w, ref: c.R.objectifPas, refTexte: `objectif ${nf(c.R.objectifPas)}`, tick: compact, label: o.tendance }));
    } else {
      const pts = cles.filter(k => val(k) != null).map(k => ({ t: debutJour(k) + 12 * H, v: val(k) }));
      graphe = placer('tCourbe', w => courbe(pts, { largeur: w, hauteur: 170, debut: debutJour(cles[0]), fin: debutJour(auj) + JOUR, parJour: true, marqueurs: true, coupure: 1.6 * JOUR,
        plage: normale && { bas: normale.bas, haut: normale.haut }, titre: t => dateCourte(t), classe: o.id === 'coeur' ? 'ligne-fc' : 'ligne-serie', unite: { coeur: 'bpm', oxygene: '%', recup: 'ms', stress: '' }[o.id], label: o.tendance }));
      if (normale) graphe += `<div class="legende"><span><i class="carre plage-cle"></i>Ta normale : ${f(normale.bas)} à ${f(normale.haut)}</span></div>`;
    }
  }

  // calendrier : couleurs calées sur tout l'historique pour rester comparables d'un mois à l'autre
  const tout = [...c.J.values()].filter(j => !(o.partiel && j.cle === auj)).map(o.champ).filter(Number.isFinite);
  const bornes = tout.length ? { min: Math.min(...tout), max: Math.max(...tout) } : null;
  const valeursMois = new Map([...c.J.values()].filter(j => j.cle.startsWith(E.mois)).map(j => [j.cle, o.champ(j)]));
  const [y, m] = E.mois.split('-').map(Number);
  const titreMois = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const legende = bornes ? `<div class="legende-seq"><span>${esc(f(bornes.min))}</span>${[0, 1, 2, 3, 4].map(i => `<i class="p${i}"></i>`).join('')}<span>${esc(f(bornes.max))}</span></div>` : '';

  return `<article class="panel">
    <div class="carte-tete"><h3>${o.tendance}</h3>${segment}</div>
    <p class="note">${esc(resume)}</p>
    ${graphe}
  </article>
  <article class="panel">
    <div class="carte-tete cal-tete">
      <button class="nav-fleche" data-mois="-1" aria-label="Mois précédent">‹</button>
      <h3>${esc(titreMois)}</h3>
      <button class="nav-fleche" data-mois="1"${E.mois >= auj.slice(0, 7) ? ' disabled' : ''} aria-label="Mois suivant">›</button>
    </div>
    ${calendrier(E.mois, valeursMois, { format: o.format, selection: E.jour, aujourdhui: auj, bornes })}
    ${legende}
  </article>`;
}
