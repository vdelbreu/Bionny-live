// Onglet Aujourd'hui, sous le direct : ta forme, puis des tuiles de chiffres (sommeil, coucher, pas, effort, cœur,
// oxygène). Un chiffre et deux mots par tuile ; toucher une tuile ouvre sa fiche : l'explication, le conseil et
// l'action (heure de lever, sport déclaré). Le texte n'est que dans les fiches.
import { duree, cleJour, debutJour, siestesFaites, siestesProbables, JOUR } from '../sante.js';
import { esc, hm } from '../graphes.js';
import { repere, decalerJour } from '../stats.js';
import {
  conseilJour, planSommeil, effortSemaine, semaine, OBJECTIF_EFFORT, phraseCoeur, phraseSommeil, phrasePas, phraseBesoin,
  phraseAvance, etatCoeur, etatSommeil, heure, seuilsEffort,
} from '../coach.js';
import { $, nf, dateLongue, pastille, barreProgression, aDesDonnees, insecable } from '../ui.js';

const hhmm = m => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const derniereNuit = c => { const n = c.ns.filter(x => x.tst).at(-1); return n && c.maintenant - n.fin < 20 * 3600e3 ? n : null; };
const pasDuJour = c => { const auj = cleJour(c.maintenant); return Math.max(c.J.get(auj)?.pas ?? 0, c.pasDirect?.cle === auj ? c.pasDirect.pas : 0); };
const coeurNuit = c => {
  const n = derniereNuit(c), auj = cleJour(c.maintenant);
  return { v: n?.fcNuit?.repos ?? null, r: repere(c.J, n ? auj : decalerJour(auj, 1), j => j.rhr), spo2: n?.spo2Nuit ?? null };
};
const voirDetail = onglet => `<button class="lien-detail" data-aller="donnees" data-onglet="${onglet}">Voir le détail ›</button>`;

let ficheOuverte = null, contexte = null;

export function rendreJour(c) {
  contexte = c;
  $('#jourEntete').innerHTML = entete(c);
  const el = $('#jourContenu');
  if (!aDesDonnees(c.D)) { el.innerHTML = accueil(); fermerFiche(); return; }
  el.innerHTML = insecable(tuileForme(c) + `<div class="grille-tuiles">${[tuileSommeil, tuileCoucher, tuilePas, tuileEffort, tuileCoeur, tuileOxygene].map(f => f(c)).join('')}</div>`);
  if (ficheOuverte) remplirFiche(ficheOuverte);
}

function entete(c) {
  const { D, R, maintenant } = c;
  let quand = 'Jamais synchronisé';
  if (D.maj) quand = cleJour(D.maj) === cleJour(maintenant) ? `Synchronisé à ${hm(D.maj)}`
    : `Synchronisé le ${new Date(D.maj).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  if (D.majBracelet && maintenant - D.majBracelet > 3 * JOUR && !D.exemple) quand += ' : synchronise vite';
  // changement d'heure dans les 7 derniers jours : l'horloge du bracelet n'est remise à l'heure que par l'app Bionny
  const changementHeure = new Date(maintenant).getTimezoneOffset() !== new Date(maintenant - 7 * JOUR).getTimezoneOffset();
  const bouton = c.connecte ? '<button class="bouton petit" data-action="synchro">Synchroniser</button>' : '';
  const titre = R.prenom ? `Salut ${esc(R.prenom)}` : esc(dateLongue(maintenant));
  return `<div class="entete"><div><h2 class="titre-vue">${titre}</h2><p class="note">${esc(quand)}</p></div>${bouton}</div>`
    + (changementHeure ? `<p class="bandeau-info">Changement d'heure : remets le bracelet à l'heure avec l'app Bionny.</p>` : '');
}

function accueil() {
  return `<article class="panel accueil">
    <h2>Bienvenue sur ViaWrist</h2>
    <p class="note fort">Ton sommeil, ton cœur, ton activité, et quoi faire de ta journée.</p>
    ${navigator.bluetooth
      ? `<div class="actions"><button class="primary" data-action="synchro">Connecter le bracelet</button><button data-action="exemple">Voir un exemple</button></div>`
      : `<p class="note">Sur iPhone, ouvre ViaWrist dans l'app gratuite <b>Bluefy</b>.</p>
        <div class="actions"><button class="primary" data-aller="reglages">Comment faire</button><button data-action="exemple">Voir un exemple</button></div>`}
  </article>`;
}

/* ---------- Tuiles : un chiffre, deux mots ---------- */

const tuile = ({ id, label, valeur, unite = '', sous = '', niveau = null, barre = '' }) => `<button class="tuile" data-fiche="${id}" aria-haspopup="dialog">
  <span class="tuile-tete"><span class="label">${label}</span>${niveau ? `<i class="point ${niveau}" aria-hidden="true"></i>` : ''}</span>
  <span class="tuile-valeur">${valeur}${unite ? `<small>${unite}</small>` : ''}</span>${barre}
  ${sous ? `<span class="tuile-sous">${sous}</span>` : ''}
</button>`;

function tuileForme(c) {
  const cj = conseilJour(c), rec = cj.rec;
  return `<button class="tuile forme" data-fiche="forme" aria-haspopup="dialog">
    ${pastille(rec?.niveau ?? 'info')}
    <span class="forme-texte"><span class="label">Ta forme</span><span class="forme-titre">${esc(rec ? rec.titre : 'Pas encore de nuit')}</span>
      <span class="forme-action">${esc(cj.titre)}</span></span>
    <span class="chevron" aria-hidden="true">›</span>
  </button>`;
}

// Siestes du jour (faites) et siestes probables à confirmer, sur les 2 derniers jours
const siestesDuJour = c => siestesFaites(c.D).filter(x => cleJour(x.fin) === cleJour(c.maintenant));
const aConfirmer = c => (c.D.exemple ? [] : siestesProbables(c.D, c.ns, c.maintenant));

function tuileSommeil(c) {
  const n = derniereNuit(c), plan = planSommeil(c), e = etatSommeil(n, plan);
  const sieste = siestesDuJour(c).reduce((a, x) => a + x.fin - x.debut, 0), proposees = aConfirmer(c).length;
  const sous = proposees ? 'sieste à confirmer ?' : !n ? 'pas de nuit' : sieste ? `cette nuit · + ${duree(sieste)} de sieste` : `cette nuit · ${e.court}`;
  return tuile({ id: 'sommeil', label: 'Sommeil', valeur: n ? duree(n.tst) : '–', niveau: proposees ? 'moyen' : e.niveau,
    barre: n ? barreProgression(n.tst, c.R.objectif * 60e3) : '', sous });
}

function tuileCoucher(c) {
  const p = planSommeil(c);
  if (p.coucher == null) return tuile({ id: 'coucher', label: 'Au lit ce soir', valeur: '–', sous: 'règle ton lever' });
  return tuile({ id: 'coucher', label: p.tard ? 'Il est l\'heure' : 'Au lit ce soir', valeur: p.tard ? 'Au lit' : heure(p.coucher),
    sous: `lever ${heure(p.lever)} · ${duree(p.besoin)}` });
}

function tuilePas(c) {
  const pas = pasDuJour(c);
  return tuile({ id: 'pas', label: 'Pas', valeur: `<span id="valPas">${nf(pas)}</span>`, niveau: pas >= c.R.objectifPas ? 'ok' : null,
    barre: barreProgression(pas, c.R.objectifPas), sous: `sur ${nf(c.R.objectifPas)}` });
}

function tuileEffort(c) {
  const e = effortSemaine(c);
  return tuile({ id: 'effort', label: 'Effort', valeur: e.total, unite: `/ ${OBJECTIF_EFFORT} min`, niveau: e.total >= OBJECTIF_EFFORT ? 'ok' : null,
    barre: barreProgression(e.total, OBJECTIF_EFFORT), sous: 'cette semaine' });
}

function tuileCoeur(c) {
  const { v, r } = coeurNuit(c), e = etatCoeur(v, r);
  return tuile({ id: 'coeur', label: 'Cœur au repos', valeur: v ?? '–', unite: v != null ? 'bpm' : '', niveau: e.niveau, sous: e.court });
}

function tuileOxygene(c) {
  const { spo2 } = coeurNuit(c);
  return tuile({ id: 'oxygene', label: 'Oxygène', valeur: spo2 ? spo2.moy : '–', unite: spo2 ? '%' : '',
    niveau: spo2 ? (spo2.moy >= 95 ? 'ok' : 'moyen') : null, sous: spo2 ? `cette nuit · ${spo2.moy >= 95 ? 'normal' : 'un peu bas'}` : 'pas de mesure' });
}

/* ---------- Fiches : le détail, en touchant une tuile ---------- */

const FICHES = {
  forme(c) {
    const cj = conseilJour(c), rec = cj.rec;
    return { titre: rec ? rec.titre : 'Ta forme', corps: `<p class="fiche-cle"><b>${esc(cj.titre)}.</b> ${esc(cj.phrase)}</p>
      ${rec ? `<ul class="raisons">${rec.raisons.map(x => `<li>${pastille(x.niveau, true)}<span>${esc(x.texte)}</span></li>`).join('')}</ul>
      <p class="note">Comparé à tes propres nuits. Indicatif, pas un avis médical.</p>` : ''}` };
  },

  sommeil(c) {
    const n = derniereNuit(c), plan = planSommeil(c), s = semaine(c);
    const recentes = siestesFaites(c.D).filter(x => x.fin > c.maintenant - 36 * 3600e3);
    return { titre: 'Sommeil', corps: `<p class="fiche-cle">${esc(phraseSommeil(n, plan))}</p>
      <div class="tuiles">
        ${n ? `<div><span>Cette nuit</span><strong>${duree(n.tst)}</strong><em>${heure(minutes(n.debut))} → ${heure(minutes(n.fin))}</em></div>` : ''}
        ${n?.aDesStades ? `<div><span>Profond</span><strong>${duree(n.stades.deep)}</strong><em>répare le corps</em></div>` : ''}
        ${s.nuits ? `<div><span>Moyenne</span><strong>${duree(s.tst)}</strong><em>${s.nuits} nuit${s.nuits > 1 ? 's' : ''}</em></div>` : ''}
        <div><span>Objectif</span><strong>${duree(c.R.objectif * 60e3)}</strong><em>dans Réglages</em></div>
      </div>
      ${n ? reveilNuit(n) : ''}
      ${aConfirmer(c).map(p => `<div class="sieste-proposee"><span>Sieste de <b>${heure(minutes(p.debut))}</b> à <b>${heure(minutes(p.fin))}</b> ?</span>
        <span class="actions"><button class="petit primary" data-action="sieste-oui" data-debut="${p.debut}" data-fin="${p.fin}">Oui</button><button class="petit" data-action="sieste-non" data-debut="${p.debut}">Non</button></span></div>`).join('')}
      ${recentes.length ? `<ul class="liste">${recentes.map(x => `<li><span>Sieste ${heure(minutes(x.debut))} → ${heure(minutes(x.fin))}</span><b>${duree(x.fin - x.debut)}</b>${x.source === 'bracelet' ? '' : `<button class="lien" data-supprimer-sieste="${x.debut}">Supprimer</button>`}</li>`).join('')}</ul>` : ''}
      <details class="form-sieste" id="formSieste"><summary>J'ai fait une sieste</summary>
        <div class="segment">${[[20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']].map(([m, l], i) => `<button class="petit" data-duree="${m}" aria-pressed="${i === 1}">${l}</button>`).join('')}</div>
        <label class="lever">Réveillé de la sieste à <input type="time" id="siesteFin" value="${hhmm(minutes(c.maintenant))}"></label>
        <div class="actions"><button class="primary petit" data-action="sieste-ok">Ajouter</button></div>
      </details>
      ${voirDetail('sommeil')}` };
  },

  coucher(c) {
    const p = planSommeil(c), m = p.matin, jour = m.nom[0].toUpperCase() + m.nom.slice(1);
    const champ = `<label class="lever">${m.demain ? jour : 'Ce matin'}, je me lève à <input type="time" id="reveilCarte" data-jour="${m.jour}" value="${p.lever != null ? hhmm(p.lever) : ''}"></label>
      <p class="note">Retenu pour tous les ${m.nom}s.</p>`;
    if (p.coucher == null) return { titre: 'Au lit ce soir', corps: `<p class="fiche-cle">Dis-moi à quelle heure tu te lèves.</p>${champ}` };
    return { titre: p.tard ? 'Il est l\'heure' : `Au lit vers ${heure(p.coucher)}`, corps: `
      <p class="fiche-cle">${p.tard ? `Tu peux encore dormir <b>environ ${duree(Math.floor(p.possible / 3e5) * 3e5)}</b> avant ton lever à ${heure(p.lever)}, les 15 min pour t'endormir déjà comptées.` : md(phraseBesoin(p, c.R.objectif * 60e3))}</p>
      ${phraseAvance(p) ? `<p class="explication">${esc(phraseAvance(p))}</p>` : ''}
      ${champ}
      <details><summary>Comment je calcule</summary><p class="explication">Ton objectif, plus un quart de ton retard des 7 dernières nuits (1 h au plus), puis 15 min pour t'endormir. Les spécialistes conseillent 7 à 9 h entre 18 et 25 ans, et de rattraper en se couchant plus tôt.</p></details>` };
  },

  pas(c) {
    const pas = pasDuJour(c);
    return { titre: `${nf(pas)} pas`, corps: `<p class="fiche-cle">${esc(phrasePas(pas || null, c.R.objectifPas, true))}</p>
      <p class="explication">Comptés par le bracelet. L'app Santé de l'iPhone en montre souvent moins : elle ne compte que les pas faits téléphone en poche.</p>
      ${voirDetail('activite')}` };
  },

  effort(c) {
    const e = effortSemaine(c), auj = cleJour(c.maintenant);
    const sport = (c.D.seances || []).filter(s => s.declare && s.fin > debutJour(decalerJour(auj, -6))).length;
    return { titre: `Effort : ${e.total} / ${OBJECTIF_EFFORT} min`, corps: `
      <p class="fiche-cle">${e.total >= OBJECTIF_EFFORT ? 'Objectif de la semaine atteint.' : `Il te manque <b>${OBJECTIF_EFFORT - e.total} min</b> cette semaine.`}</p>
      <p class="explication">L'OMS conseille 150 min par semaine où ton cœur accélère vraiment (plus de ${seuilsEffort(c.fcmax).modere} bpm)${sport ? `. Dont ${sport} séance${sport > 1 ? 's' : ''} déclarée${sport > 1 ? 's' : ''}` : ''}.</p>
      <div class="form-sport" id="formSport">
        <span class="label">J'ai fait du sport</span>
        <div class="segment">${[[30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']].map(([m, l], i) => `<button class="petit" data-duree="${m}" aria-pressed="${i === 1}">${l}</button>`).join('')}</div>
        <div class="segment"><button class="petit" data-intensite="tranquille" aria-pressed="true">Tranquille</button><button class="petit" data-intensite="soutenu" aria-pressed="false">Soutenu</button></div>
        <p class="note">Soutenu : tu as du mal à parler. Ça compte double.</p>
        <div class="actions"><button class="primary petit" data-action="sport-ok">Ajouter</button></div>
      </div>` };
  },

  coeur(c) {
    const { v, r } = coeurNuit(c);
    return { titre: v != null ? `Cœur au repos : ${v} bpm` : 'Cœur au repos', corps: `<p class="fiche-cle">${esc(phraseCoeur(v, r))}</p>
      ${r && v != null ? `<p class="explication">Ta normale : ${Math.round(r.bas)} à ${Math.round(r.haut)} bpm. Mesuré la nuit, quand ton corps est au calme : c'est le meilleur signe de ta fatigue.</p>` : ''}
      <div class="actions"><button class="petit" data-action="sante">Envoyer mon pouls vers Santé</button>${voirDetail('coeur')}</div>` };
  },

  oxygene(c) {
    const { spo2 } = coeurNuit(c);
    if (!spo2) return { titre: 'Oxygène', corps: '<p class="fiche-cle">Pas encore de mesure d\'oxygène la nuit.</p>' };
    return { titre: `Oxygène : ${spo2.moy} %`, corps: `<p class="fiche-cle">${spo2.moy >= 95 ? 'Normal : entre 95 et 100 %, ton sang transporte bien l\'oxygène.' : 'Un peu bas. Au poignet la mesure est imprécise ; si ça se répète, parles-en à un médecin.'}</p>
      <p class="explication">Minimum cette nuit : ${spo2.min} %.</p>${voirDetail('oxygene')}` };
  },
};
const minutes = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };

// Heure de réveil : corrigeable, avec d'où elle vient (bracelet, ton pouls, toi)
function reveilNuit(n) {
  const note = n.finSource === 'toi' ? `Corrigé par toi, le bracelet disait ${heure(minutes(n.finBracelet))}. <button class="lien" data-action="reveil-retablir" data-nuit="${n.cle}">Rétablir</button>`
    : n.finSource === 'pouls' ? `Corrigé : ton pouls est remonté à ${heure(minutes(n.fin))}, le bracelet disait ${heure(minutes(n.finBracelet))}.`
    : n.finProvisoire ? 'Le bracelet a arrêté ta nuit au moment de la synchro : corrige si tu étais réveillé avant.' : '';
  return `<label class="lever">Réveillé à <input type="time" id="reveilNuit" data-nuit="${n.cle}" value="${hhmm(minutes(n.fin))}"></label>
    ${note ? `<p class="note">${note}</p>` : ''}`;
}

function remplirFiche(id) {
  const f = FICHES[id]?.(contexte);
  if (!f) return;
  $('#ficheTitre').innerHTML = insecable(esc(f.titre));
  $('#ficheCorps').innerHTML = insecable(f.corps);
}
function ouvrirFiche(id) {
  ficheOuverte = id;
  remplirFiche(id);
  const d = $('#fiche');
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
}
function fermerFiche() {
  const d = $('#fiche');
  ficheOuverte = null;
  if (d?.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
}

export function brancherFiches() {
  const d = $('#fiche');
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-fiche]');
    if (t) return ouvrirFiche(t.dataset.fiche);
    // fond assombri, croix, ou lien vers Données : on referme
    if (e.target === d || e.target.closest('[data-fermer]') || (d.open && e.target.closest('#fiche [data-aller]'))) fermerFiche();
  });
  d.addEventListener('close', () => { ficheOuverte = null; });
}
