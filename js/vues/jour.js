// Onglet Aujourd'hui, sous le direct : ta forme ce matin et quoi faire, puis 3 cartes (sommeil, activité, cœur).
// Chaque carte : un chiffre, une phrase qui l'explique selon ta valeur, et une action concrète.
import { duree, cleJour, debutJour, JOUR } from '../sante.js';
import { esc, hm } from '../graphes.js';
import { repere, decalerJour } from '../stats.js';
import { conseilJour, planSommeil, effortSemaine, OBJECTIF_EFFORT, phraseCoeur, phraseSommeil, phrasePas, heure, seuilsEffort } from '../coach.js';
import { $, nf, dateLongue, pastille, barreProgression, aDesDonnees } from '../ui.js';

const hhmm = m => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const derniereNuit = c => { const n = c.ns.filter(x => x.tst).at(-1); return n && c.maintenant - n.fin < 20 * 3600e3 ? n : null; };

export function rendreJour(c) {
  $('#jourEntete').innerHTML = entete(c);
  const el = $('#jourContenu');
  if (!aDesDonnees(c.D)) { el.innerHTML = accueil(); return; }
  el.innerHTML = carteEtat(c) + `<div class="cartes-jour">${carteSommeil(c)}${carteActivite(c)}${carteCoeur(c)}</div>`;
}

function entete(c) {
  const { D, R, maintenant } = c;
  let quand = 'Bracelet jamais synchronisé';
  if (D.maj) quand = cleJour(D.maj) === cleJour(maintenant) ? `Synchronisé à ${hm(D.maj)}`
    : `Synchronisé le ${new Date(D.maj).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  if (D.majBracelet && maintenant - D.majBracelet > 3 * JOUR && !D.exemple) quand += ' : synchronise vite, le bracelet garde peu de jours';
  // changement d'heure dans les 7 derniers jours : l'horloge du bracelet n'est remise à l'heure que par l'app Bionny
  const changementHeure = new Date(maintenant).getTimezoneOffset() !== new Date(maintenant - 7 * JOUR).getTimezoneOffset();
  // connecté : on peut relancer une synchro ; sinon le bouton « Connecter » du direct synchronise déjà
  const bouton = c.connecte ? '<button class="bouton petit" data-action="synchro">Synchroniser</button>' : '';
  const titre = R.prenom ? `Salut ${esc(R.prenom)}` : esc(dateLongue(maintenant));
  return `<div class="entete"><div><h2 class="titre-vue">${titre}</h2><p class="note">${R.prenom ? esc(dateLongue(maintenant)) + ' · ' : ''}${esc(quand)}</p></div>${bouton}</div>`
    + (changementHeure ? `<p class="bandeau-info">Changement d'heure cette semaine : ouvre une fois l'app Bionny pour remettre le bracelet à l'heure, sinon tes horaires seront décalés d'une heure.</p>` : '');
}

function accueil() {
  return `<article class="panel accueil">
    <h2>Bienvenue sur ViaWrist</h2>
    <p class="note fort">Connecte ton bracelet : ViaWrist lit ton sommeil, ton cœur et ton activité, puis te dit quoi faire de ta journée.</p>
    ${navigator.bluetooth
      ? `<div class="actions"><button class="primary" data-action="synchro">Synchroniser le bracelet</button><button data-action="exemple">Voir un exemple</button></div>
        <p class="note">Ferme l'app Bionny avant : le bracelet n'accepte qu'une connexion à la fois.</p>`
      : `<p class="note">Sur iPhone, ouvre ViaWrist dans l'app gratuite <b>Bluefy</b> : Safari ne gère pas le Bluetooth.</p>
        <div class="actions"><button class="primary" data-aller="reglages">Comment faire</button><button data-action="exemple">Voir un exemple</button></div>`}
  </article>`;
}

function carteEtat(c) {
  const cj = conseilJour(c), rec = cj.rec;
  if (!rec) {
    return `<article class="panel etat"><div class="verdict-tete">${pastille('info')}<div><div class="label">Ce matin</div><h2>Pas encore de nuit</h2></div></div>
      <p class="conseil">${esc(cj.phrase)}</p></article>`;
  }
  return `<article class="panel etat">
    <div class="verdict-tete">${pastille(rec.niveau)}<div><div class="label">Ce matin</div><h2>${esc(rec.titre)}</h2></div></div>
    <p class="conseil"><b>${esc(cj.titre)}.</b> ${esc(cj.phrase)}</p>
    <details><summary>Pourquoi ?</summary>
      <ul class="raisons">${rec.raisons.map(x => `<li>${pastille(x.niveau, true)}<span>${esc(x.texte)}</span></li>`).join('')}</ul>
      <p class="note">Comparé à tes propres nuits. Indicatif, pas un avis médical.</p>
    </details>
  </article>`;
}

function carteSommeil(c) {
  const plan = planSommeil(c), n = derniereNuit(c);
  return `<article class="panel carte-cle">
    <div class="carte-tete"><span class="label">Sommeil</span><button class="lien-detail" data-aller="donnees" data-onglet="sommeil">Détails ›</button></div>
    <div class="valeur">${n ? duree(n.tst) : '–'}<small>${n ? 'cette nuit' : ''}</small></div>
    <p class="explication">${esc(phraseSommeil(n, plan))}</p>
    ${plan.coucher != null ? `<div class="action-soir">
      <span>Ce soir, au lit vers</span><strong>${heure(plan.coucher)}</strong>
      <em>${plan.progressif ? `30 min plus tôt que d'habitude. L'idéal serait ${heure(plan.ideal)}, on y va petit à petit.` : `pour ${duree(plan.besoin)} de sommeil avant ton lever.`}</em>
    </div>` : ''}
    <label class="lever">Demain je me lève à <input type="time" id="reveilCarte" value="${plan.lever != null ? hhmm(plan.lever) : ''}"></label>
  </article>`;
}

function carteActivite(c) {
  const auj = cleJour(c.maintenant), j = c.J.get(auj);
  const pas = Math.max(j?.pas ?? 0, c.pasDirect?.cle === auj ? c.pasDirect.pas : 0);
  const e = effortSemaine(c);
  const sport = (c.D.seances || []).filter(s => s.declare && s.fin > debutJour(decalerJour(auj, -6))).length;
  return `<article class="panel carte-cle">
    <div class="carte-tete"><span class="label">Activité</span><button class="lien-detail" data-aller="donnees" data-onglet="activite">Détails ›</button></div>
    <div class="valeur"><span id="valPas">${nf(pas)}</span><small>pas aujourd'hui</small></div>
    ${barreProgression(pas, c.R.objectifPas)}
    <p class="explication">${esc(phrasePas(j?.pas ?? (pas || null), c.R.objectifPas, true))}</p>
    <div class="ligne-effort"><span>Effort cette semaine</span><strong>${e.total}<small> / ${OBJECTIF_EFFORT} min</small></strong></div>
    ${barreProgression(e.total, OBJECTIF_EFFORT)}
    <p class="explication">${e.total >= OBJECTIF_EFFORT ? "Objectif de l'OMS atteint cette semaine." : `L'OMS conseille 150 min par semaine où ton cœur accélère vraiment (plus de ${seuilsEffort(c.fcmax).modere} bpm).`}${sport ? ` Dont ${sport} séance${sport > 1 ? 's' : ''} déclarée${sport > 1 ? 's' : ''}.` : ''}</p>
    <div class="actions"><button class="petit" data-action="sport" aria-expanded="false" aria-controls="formSport">J'ai fait du sport</button></div>
    <div class="form-sport" id="formSport" hidden>
      <span class="label">Combien de temps ?</span>
      <div class="segment">${[[30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']].map(([m, l], i) => `<button class="petit" data-duree="${m}" aria-pressed="${i === 1}">${l}</button>`).join('')}</div>
      <span class="label">C'était…</span>
      <div class="segment"><button class="petit" data-intensite="tranquille" aria-pressed="true">Tranquille</button><button class="petit" data-intensite="soutenu" aria-pressed="false">Soutenu</button></div>
      <p class="note">Soutenu : tu as du mal à parler. Ça compte double, comme le dit l'OMS.</p>
      <div class="actions"><button class="primary petit" data-action="sport-ok">Ajouter</button></div>
    </div>
  </article>`;
}

function carteCoeur(c) {
  const n = derniereNuit(c), auj = cleJour(c.maintenant);
  const v = n?.fcNuit?.repos ?? null;
  const r = repere(c.J, n ? auj : decalerJour(auj, 1), j => j.rhr);
  const spo2 = n?.spo2Nuit;
  return `<article class="panel carte-cle">
    <div class="carte-tete"><span class="label">Cœur</span><button class="lien-detail" data-aller="donnees" data-onglet="coeur">Détails ›</button></div>
    <div class="valeur">${v ?? '–'}<small>bpm au repos</small></div>
    ${r && v != null ? `<p class="sous">Ta normale : ${Math.round(r.bas)} à ${Math.round(r.haut)} bpm</p>` : ''}
    <p class="explication">${esc(phraseCoeur(v, r))}</p>
    ${spo2 ? `<p class="sous">Oxygène cette nuit : <b>${spo2.moy} %</b>${spo2.moy >= 95 ? ', normal' : ''}</p>` : ''}
  </article>`;
}
