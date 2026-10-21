// ViaWrist : point d'entrée. Stockage, réglages, navigation, imports (bracelet, sauvegarde, raccourci Santé), rendu des vues.
import { parseImport, fusionner, vide, nuits as calculerNuits, lireHash, cleJour, debutJour, duree, JOUR } from './sante.js';
import { impExemple } from './exemple.js';
import { initInfobulles, hm } from './graphes.js';
import { fcMaxTanaka } from './coeur.js';
import { journees, fiabilite } from './stats.js';
import { seanceDeclaree, planSommeil, heure, matinSuivant, JOURS } from './coach.js';
import { initLive, majAge, synchroniserBracelet, connecterBracelet, chercherBracelet, enDirect, lancerDemo } from './live.js';
import { journal, mettreALHeure, lireReveils, ecrireReveils, vibrer } from './connexion.js';
import { reveilsVoulus, memesReveils, rappelsImportes, tropDeReveils, joursCourts } from './reveil.js';
import { $, nf, toast } from './ui.js';
import { rendreJour, brancherFiches } from './vues/jour.js';
import { rendreCoach, brancherCoach } from './vues/coach.js';
import { rendreDonnees, brancherDonnees, ouvrirDonnees } from './vues/donnees.js';

const VUES = ['jour', 'coach', 'donnees', 'reglages'];
const ANCIENNES = { direct: 'jour', semaine: 'donnees', bilan: 'coach' };
// objectif en minutes ; leverJours = heure de lever « HH:MM » par jour de la semaine (0 = dimanche), selon tes cours ;
// reveil = ancienne heure unique, gardée seulement le temps de la reporter sur un jour
// santeJusqua = date de la dernière mesure de pouls envoyée vers Apple Santé
// vibreur = réveils écrits dans le bracelet (voir reveil.js) ; notifs = appels et messages, désactivé de base
const R = { prenom: '', age: 25, fcmaxMesuree: null, objectif: 480, objectifPas: 8000, reveil: null, leverJours: {}, santeJusqua: null,
  vibreur: { reveil: false, coucher: false, rappels: [], importe: false }, notifs: false, raccourci: 'ViaWrist' };
let D = vide(), cache = null, vue = 'jour', pasDirect = null;

/* ---------- Stockage local ---------- */

const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const STADES = new Set(['inBed', 'asleep', 'awake', 'core', 'deep', 'rem']);
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Ne garde que des champs attendus et numériques : protège l'affichage d'une sauvegarde abîmée ou trafiquée
function nettoyer(d) {
  const out = vide();
  if (!d || typeof d !== 'object') return out;
  out.sommeil = (d.sommeil || []).filter(x => num(x?.s) != null && num(x?.e) != null && STADES.has(x.k)).map(x => ({ s: x.s, e: x.e, k: x.k }));
  for (const k of ['fc', 'vfc', 'spo2', 'repos', 'stress']) out[k] = (d[k] || []).filter(x => num(x?.t) != null && num(x?.v) != null).map(x => ({ t: x.t, v: x.v }));
  out.activite = (d.activite || []).filter(x => num(x?.t) != null && num(x?.v) != null).map(x => ({ t: x.t, v: x.v, dist: num(x.dist) ?? 0, cal: num(x.cal) ?? 0 }));
  out.pas = Object.fromEntries(Object.entries(d.pas || {}).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && num(v) != null));
  out.seances = (d.seances || []).filter(x => num(x?.debut) != null && num(x?.fin) != null).map(x => ({
    debut: x.debut, fin: x.fin, declare: x.declare === true, intensite: x.intensite === 'soutenu' ? 'soutenu' : 'tranquille',
    moy: num(x.moy) ?? 0, max: num(x.max) ?? 0,
    effort: { moderes: num(x.effort?.moderes) ?? 0, intenses: num(x.effort?.intenses) ?? 0 },
  }));
  const SOURCES = new Set(['declaree', 'confirmee']);
  out.siestes = (d.siestes || []).filter(x => num(x?.debut) != null && num(x?.fin) != null && x.fin > x.debut && x.fin - x.debut <= 6 * 3600e3)
    .map(x => ({ debut: x.debut, fin: x.fin, source: SOURCES.has(x.source) ? x.source : 'declaree' }));
  out.nonSiestes = (d.nonSiestes || []).filter(t => num(t) != null).slice(-100);
  out.reveils = Object.fromEntries(Object.entries(d.reveils || {}).filter(([k, t]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && num(t) != null));
  out.synchros = (d.synchros || []).filter(t => num(t) != null).slice(-60);
  out.maj = num(d.maj);
  out.majBracelet = num(d.majBracelet);
  out.origine = ['sante', 'bracelet'].includes(d.origine) ? d.origine : undefined;
  out.exemple = d.exemple === true;
  out.avertissements = (Array.isArray(d.avertissements) ? d.avertissements : []).filter(a => typeof a === 'string').slice(0, 10);
  return out;
}
function reglagesValides(r) {
  const n = (x, min, max) => (num(x) != null && x >= min && x <= max ? x : null);
  if (!r || typeof r !== 'object') return {};
  return Object.fromEntries(Object.entries({
    prenom: typeof r.prenom === 'string' ? r.prenom.slice(0, 30) : null,
    age: n(r.age, 10, 99), fcmaxMesuree: n(r.fcmaxMesuree, 120, 230), objectif: n(r.objectif, 240, 720),
    objectifPas: n(r.objectifPas, 1000, 40000), reveil: typeof r.reveil === 'string' && HEURE.test(r.reveil) ? r.reveil : null,
    leverJours: r.leverJours && typeof r.leverJours === 'object'
      ? Object.fromEntries(Object.entries(r.leverJours).filter(([j, h]) => /^[0-6]$/.test(j) && typeof h === 'string' && HEURE.test(h))) : null,
    raccourci: typeof r.raccourci === 'string' && r.raccourci.trim() ? r.raccourci.slice(0, 40) : null,
    santeJusqua: n(r.santeJusqua, 0, 1e13),
    vibreur: r.vibreur && typeof r.vibreur === 'object' ? {
      reveil: r.vibreur.reveil === true, coucher: r.vibreur.coucher === true, importe: r.vibreur.importe === true,
      rappels: (Array.isArray(r.vibreur.rappels) ? r.vibreur.rappels : []).filter(x => n(x?.minutes, 0, 1439) != null && Array.isArray(x.jours)).slice(0, 10)
        .map(x => ({ minutes: x.minutes, jours: x.jours.filter(j => Number.isInteger(j) && j >= 0 && j <= 6), actif: x.actif !== false, nom: typeof x.nom === 'string' ? x.nom.slice(0, 20) : 'Rappel' })),
    } : null,
    notifs: typeof r.notifs === 'boolean' ? r.notifs : null,
  }).filter(([, v]) => v != null));
}

function charger() {
  try { Object.assign(R, reglagesValides(JSON.parse(localStorage.getItem('bionny-reglages') || '{}'))); } catch { /* réglages par défaut */ }
  // ancienne heure de lever unique : elle avait été réglée pour le lendemain, on la reporte sur ce jour-là
  if (R.reveil) {
    const j = matinSuivant(Date.now()).jour;
    if (!R.leverJours[j]) R.leverJours[j] = R.reveil;
    R.reveil = null;
    sauverReglages();
  }
  try { const d = JSON.parse(localStorage.getItem('bionny-sante') || 'null'); if (d?.v === 1) D = nettoyer(d); } catch { /* données illisibles */ }
}
function sauverReglages() {
  cache = null;
  try { localStorage.setItem('bionny-reglages', JSON.stringify(R)); } catch { /* stockage bloqué */ }
}
function sauverDonnees() {
  cache = null;
  try { localStorage.setItem('bionny-sante', JSON.stringify(D)); return; } catch { /* plein ou bloqué */ }
  // stockage plein : on allège la FC de plus de 30 jours avant de réessayer
  const limite = Date.now() - 30 * JOUR;
  D.fc = D.fc.filter(x => x.t > limite);
  try { localStorage.setItem('bionny-sante', JSON.stringify(D)); toast('Stockage presque plein : le pouls de plus de 30 jours a été allégé.'); }
  catch { toast('Stockage bloqué : les données ne seront pas gardées après fermeture.'); }
}

const fcMaxCourante = () => R.fcmaxMesuree || fcMaxTanaka(R.age);
// Variabilité et stress sont calculés par le bracelet : on ne les montre que s'ils passent le contrôle de vraisemblance
function contexte() {
  if (!cache) {
    let ns = calculerNuits(D);
    const fiab = fiabilite(D, ns);
    if (!fiab.vfc.fiable) ns = ns.map(n => ({ ...n, vfcNuit: null }));
    const J = journees(D, ns, fcMaxCourante());
    for (const j of J.values()) {
      if (!fiab.vfc.fiable) j.vfc = null;
      if (!fiab.stress.fiable) j.stress = null;
    }
    cache = { ns, J, fiab };
  }
  return { D, R, maintenant: Date.now(), ns: cache.ns, J: cache.J, fiab: cache.fiab, fcmax: fcMaxCourante(), pasDirect, connecte: enDirect() };
}

/* ---------- Imports ---------- */

// Texte du raccourci Santé (#d=), gardé pour un appareil qui écrit dans Santé
function importer(texte) {
  const imp = parseImport(texte);
  const n = imp.sommeil.length + imp.fc.length + imp.pas.length + imp.vfc.length + imp.spo2.length + imp.repos.length;
  if (!n) { toast('Aucune donnée lisible reçue.'); return false; }
  D = fusionner(D.exemple ? vide() : D, imp, Date.now());
  D.origine = 'sante';
  sauverDonnees();
  toast(`Santé lu : ${nf(imp.fc.length)} mesures de pouls.`);
  return true;
}

// Historique lu dans le bracelet (connexion.js)
function importerBracelet(imp) {
  const t = Date.now();
  D = fusionner(D.exemple ? vide() : D, imp, t, { parJour: true });
  D.origine = 'bracelet';
  D.majBracelet = t;
  D.synchros = [...(D.synchros || []), t].slice(-60);   // pour repérer une nuit arrêtée par la synchro
  sauverDonnees();
  const nbNuits = calculerNuits({ ...vide(), sommeil: imp.sommeil }).length;
  toast(`Bracelet synchronisé : ${nbNuits} nuit${nbNuits > 1 ? 's' : ''} et ${nf(imp.fc.length)} mesures de pouls.`);
  rendre();
}
// Première synchro : 7 jours ; ensuite seulement les jours manquants (2 minimum)
const joursASynchroniser = () => D.majBracelet && !D.exemple ? Math.min(7, Math.max(2, Math.ceil((Date.now() - D.majBracelet) / JOUR) + 1)) : 7;

async function synchroniser() {
  if (!navigator.bluetooth) { montrerVue('reglages'); const g = $('#guide'); if (g) { g.open = true; g.scrollIntoView({ behavior: 'smooth' }); } return; }
  const boutons = document.querySelectorAll('[data-action="synchro"]');
  boutons.forEach(b => { b.disabled = true; b.dataset.texte = b.textContent; b.textContent = 'Synchronisation…'; });
  try { await synchroniserBracelet(); }
  finally { document.querySelectorAll('[data-action="synchro"]').forEach(b => { b.disabled = false; if (b.dataset.texte) b.textContent = b.dataset.texte; }); }
}

// Sport déclaré (le bracelet n'est pas porté au sport) : compte dans les minutes d'effort de la semaine
function ajouterSport() {
  const f = $('#formSport');
  const minutes = +(f.querySelector('[data-duree][aria-pressed="true"]')?.dataset.duree ?? 45);
  const intensite = f.querySelector('[data-intensite][aria-pressed="true"]')?.dataset.intensite ?? 'tranquille';
  D.seances = [...(D.seances || []), seanceDeclaree(Date.now(), minutes, intensite)];
  sauverDonnees();
  toast(`Sport ajouté : ${duree(minutes * 60e3)}, ${intensite}.`);
  rendre();
}
// Siestes et réveil corrigé : ce que tu sais mieux que le bracelet
function modifierSiestes(f, message) {
  if (D.exemple) return toast("Données d'exemple : connecte ton bracelet d'abord.");
  D.siestes ??= []; D.nonSiestes ??= []; D.reveils ??= {};
  f();
  sauverDonnees();
  toast(message);
  rendre();
}
function ajouterSieste() {
  const f = $('#formSieste'), minutes = +(f.querySelector('[data-duree][aria-pressed="true"]')?.dataset.duree ?? 30);
  const [h, m] = ($('#siesteFin').value || '').split(':').map(Number);
  const fin = new Date(); fin.setHours(h, m, 0, 0);
  if (!Number.isFinite(fin.getTime())) return toast("Indique l'heure de fin de la sieste.");
  if (fin.getTime() > Date.now() + 5 * 60e3) fin.setDate(fin.getDate() - 1);   // une heure à venir : c'était hier
  const debut = fin.getTime() - minutes * 60e3;
  // une sieste qui en chevauche une autre est la même, que tu précises : elle la remplace (jamais comptée deux fois)
  const avant = (D.siestes || []).filter(x => x.debut < fin.getTime() && x.fin > debut);
  modifierSiestes(() => {
    D.siestes = D.siestes.filter(x => !avant.includes(x));
    D.siestes.push({ debut, fin: fin.getTime(), source: 'declaree' });
  }, avant.length ? `Sieste de ${duree(minutes * 60e3)} : elle remplace celle de ${heure(new Date(avant[0].debut).getHours() * 60 + new Date(avant[0].debut).getMinutes())}.` : `Sieste de ${duree(minutes * 60e3)} ajoutée.`);
}
function supprimerSeance(debut) {
  if (!confirm('Supprimer cette séance ?')) return;
  D.seances = D.seances.filter(s => s.debut !== debut);
  sauverDonnees();
  rendre();
}

function chargerExemple() {
  const t = Date.now();
  D = fusionner(vide(), impExemple(t), t);
  D.exemple = true;
  sauverDonnees();
  montrerVue('jour');
  toast('Exemple chargé. Efface-le quand tu veux.');
}
function effacer(confirmer = true) {
  if (confirmer && !confirm('Effacer toutes les données enregistrées dans ce navigateur ?')) return;
  D = vide();
  sauverDonnees();
  rendre();
  toast('Données effacées.');
}

function telecharger(nom, contenu, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenu], { type }));
  a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// Sur iPhone, Bluefy télécharge mal : on passe par le presse-papiers ou la feuille de partage d'iOS
// (appelés dès le clic, sinon iOS refuse faute de geste de l'utilisateur)
const tactile = matchMedia('(pointer: coarse)').matches;
async function copierTexte(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch { return false; }
}
async function partagerFichier(nom, contenu, type) {
  const f = new File([contenu], nom, { type });
  if (!navigator.canShare?.({ files: [f] })) return false;
  try { await navigator.share({ files: [f] }); } catch (e) { if (e.name !== 'AbortError') return false; }
  return true;
}
// Apple Santé : un site ne peut pas écrire dans Santé, le raccourci « ViaWrist Santé » le fait. On copie les mesures
// de pouls pas encore envoyées (24 h au plus), une ligne « jj/mm/aaaa hh:mm;bpm » chacune, puis on lance le raccourci :
// il lit le presse-papiers et enregistre chaque ligne dans Santé. Ensuite, Santé et un widget Raccourcis l'affichent.
const RACCOURCI_SANTE = 'ViaWrist Santé';
const dateSante = t => { const d = new Date(t), z = n => String(n).padStart(2, '0'); return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`; };
// une mesure par quart d'heure, plus toujours la dernière : Raccourcis enregistre les lignes une à une, 300 lignes
// prendraient plusieurs minutes
function lignesSante(fc, depuis) {
  const recentes = fc.filter(x => x.t > depuis), garde = [];
  let creneau = null;
  for (const x of recentes) {
    const c = Math.floor(x.t / (15 * 60e3));
    if (c !== creneau) { garde.push(x); creneau = c; }
  }
  if (recentes.length && garde.at(-1) !== recentes.at(-1)) garde.push(recentes.at(-1));
  return garde.map(x => `${dateSante(x.t)};${x.v}`);
}
async function envoyerSante() {
  if (D.exemple) return toast("Données d'exemple : rien à envoyer.");
  const depuis = Math.max(R.santeJusqua ?? 0, Date.now() - JOUR);
  const lignes = lignesSante(D.fc, depuis);
  if (!lignes.length) return toast(D.fc.length ? 'Rien de nouveau : synchronise le bracelet avant.' : 'Pas encore de pouls : connecte le bracelet.');
  if (!(await copierTexte(lignes.join('\n')))) return toast('Copie impossible dans ce navigateur.');
  R.santeJusqua = D.fc.at(-1).t;
  sauverReglages();
  rendreReglages();
  toast(`${lignes.length} mesure${lignes.length > 1 ? 's' : ''} copiée${lignes.length > 1 ? 's' : ''}. Lance « ${RACCOURCI_SANTE} » si Raccourcis ne s'ouvre pas.`);
  // ouvre l'app Raccourcis sur le bon raccourci ; sans effet si le navigateur refuse
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(RACCOURCI_SANTE);
}

async function exporterJournal() {
  const txt = journal();
  if (!txt) return toast("Journal vide : connecte d'abord le bracelet.");
  if (tactile && await copierTexte(txt)) return toast('Journal copié : colle-le dans un message ou une note.');
  const h = new Date().toTimeString().slice(0, 5).replace(':', 'h');
  telecharger(`viawrist-journal-${cleJour(Date.now())}-${h}.txt`, txt, 'text/plain');
  toast('Journal Bluetooth téléchargé.');
}
async function exporter() {
  const nom = `viawrist-sauvegarde-${cleJour(Date.now())}.json`;
  const contenu = JSON.stringify({ app: 'ViaWrist', version: 1, date: Date.now(), reglages: R, donnees: D });
  if (tactile && await partagerFichier(nom, contenu, 'application/json')) return;   // « Enregistrer dans Fichiers »
  telecharger(nom, contenu, 'application/json');
  toast('Sauvegarde téléchargée.');
}
async function restaurer(fichier) {
  try {
    const s = JSON.parse(await fichier.text());
    if (s?.app !== 'ViaWrist' || s.donnees?.v !== 1) return toast("Ce fichier n'est pas une sauvegarde ViaWrist.");
    if (!confirm('Remplacer les données de ce navigateur par celles de la sauvegarde ?')) return;
    D = nettoyer(s.donnees);
    Object.assign(R, reglagesValides(s.reglages));
    sauverReglages(); sauverDonnees(); majAge();
    toast('Sauvegarde restaurée.');
    rendre();
  } catch { toast('Fichier illisible.'); }
}

/* ---------- Réveil et rappels du bracelet ---------- */

// État affiché : à jour, en attente de connexion, ou modèle qui ne répond pas aux réveils
let etatReveils = '', envoiReveils = null, reveilsNonGeres = false;
function modifierVibreur(f) {
  f(R.vibreur);
  reveilsNonGeres = false;   // tu viens de changer quelque chose : on réessaie
  sauverReglages();
  rendreReglages();
  // envoi groupé : plusieurs changements de suite partent ensemble
  clearTimeout(envoiReveils);
  envoiReveils = setTimeout(() => synchroniserReveils().catch(e => { etatReveils = `Envoi impossible (${e.message}).`; rendreReglages(); }), 1200);
}
async function synchroniserReveils() {
  if (!enDirect()) { etatReveils = 'Sera envoyé au bracelet à la prochaine connexion.'; rendreReglages(); return; }
  if (reveilsNonGeres) return;   // déjà sans réponse dans cette session : pas 3 s d'attente à chaque retour sur l'app
  const lus = await lireReveils();
  if (lus == null) { reveilsNonGeres = true; etatReveils = "Le bracelet n'a pas répondu aux réveils : ce modèle ne les gère peut-être pas."; rendreReglages(); return; }
  if (!R.vibreur.importe) {
    // première fois : les réveils déjà dans le bracelet (app Bionny) deviennent des rappels, rien n'est perdu
    R.vibreur.rappels = [...rappelsImportes(lus), ...R.vibreur.rappels].slice(0, 10);
    R.vibreur.importe = true;
    sauverReglages();
  }
  const voulus = reveilsVoulus(R, planSommeil(contexte()), Date.now());
  if (!memesReveils(voulus, lus)) {
    await ecrireReveils(voulus);
    const relus = await lireReveils();
    etatReveils = relus && memesReveils(voulus, relus) ? `Enregistré dans le bracelet à ${hm(Date.now())}.` : "Le bracelet n'a pas confirmé : reconnecte-le pour réessayer.";
  } else etatReveils = `À jour dans le bracelet (vérifié à ${hm(Date.now())}).`;
  rendreReglages();
}
async function testerVibreur() {
  if (!enDirect()) return toast("Connecte le bracelet d'abord.");
  await vibrer();
  toast('Le bracelet doit vibrer.');
}
const hhmmMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const LETTRES = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
function rendreReveils() {
  const v = R.vibreur, plan = planSommeil(contexte());
  $('#vibReveil').checked = v.reveil;
  $('#vibCoucher').checked = v.coucher;
  const parHeure = new Map();
  for (const [j, h] of Object.entries(R.leverJours)) parHeure.set(h, [...(parHeure.get(h) || []), +j]);
  $('#resumeLevers').textContent = !parHeure.size ? "Règle d'abord tes heures de lever, plus haut."
    : [...parHeure].sort().map(([h, jours]) => `${heure(+h.slice(0, 2) * 60 + +h.slice(3))} ${joursCourts(jours)}`).join(' · ');
  $('#listeRappels').innerHTML = v.rappels.map((r, i) => `<div class="rappel" data-rappel="${i}">
    <div class="rappel-ligne"><input type="time" data-champ="heure" value="${hhmmMin(r.minutes)}" aria-label="Heure du rappel">
      <input type="text" data-champ="nom" value="${r.nom.replace(/"/g, '&quot;').replace(/</g, '&lt;')}" maxlength="20" aria-label="Nom du rappel">
      <label class="interrupteur petit"><input type="checkbox" data-champ="actif"${r.actif ? ' checked' : ''}><span>Actif</span></label></div>
    <div class="rappel-ligne"><span class="jours-semaine">${LETTRES.map(([j, l]) => `<button class="petit" data-jour-rappel="${j}" aria-pressed="${r.jours.includes(j)}" aria-label="${JOURS[j]}">${l}</button>`).join('')}</span>
      <button class="lien" data-action="rappel-suppr">Supprimer</button></div>
  </div>`).join('');
  $('#etatReveils').textContent = (tropDeReveils(R, plan, Date.now()) ? 'Plus de 10 réveils et rappels : les derniers ne seront pas envoyés. ' : '')
    + (etatReveils || (enDirect() ? 'Vérification à la prochaine modification.' : 'Envoyé au bracelet à chaque connexion.'));
  $('#vibNotifs').checked = R.notifs;
  $('#aideNotifs').hidden = !R.notifs;
}

/* ---------- Réglages ---------- */

function rendreReglages() {
  const c = contexte();
  $('#prenom').value = R.prenom;
  $('#age').value = R.age;
  $('#objectif').value = R.objectif / 60;
  $('#objectifPas').value = R.objectifPas;
  for (const i of document.querySelectorAll('#leverJours input')) i.value = R.leverJours[i.dataset.jour] ?? '';
  const habituel = planSommeil(c).habituel;
  $('#reveilNote').textContent = `Selon tes cours. Vide : ton heure habituelle${habituel != null ? ` (${heure(habituel)})` : ''}.`;
  $('#fcmaxMesuree').value = R.fcmaxMesuree ?? '';
  $('#fcmaxMesuree').placeholder = String(fcMaxTanaka(R.age));
  $('#fcmaxNote').textContent = R.fcmaxMesuree ? 'ta valeur mesurée' : `vide : estimée à ${fcMaxTanaka(R.age)} bpm`;
  $('#urlApp').textContent = location.origin + location.pathname;
  rendreReveils();
  $('#etatSante').textContent = R.santeJusqua ? `Pouls envoyé jusqu'au ${dateSante(R.santeJusqua).replace(' ', ' à ')}.` : 'Jamais envoyé.';
  const date = t => `le ${new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${hm(t)}`;
  $('#etatBracelet').textContent = (enDirect() ? 'Connecté. ' : 'Pas connecté. ')
    + (D.majBracelet && !D.exemple ? `Dernière synchro ${date(D.majBracelet)}.` : 'Jamais synchronisé ici.');
  const controle = (nom, f, unite, attendu, e = '') => !f.assez
    ? `${nom} : pas encore assez de mesures pour vérifier, donc non affiché${e}.`
    : `${nom} : ${f.fiable ? 'affiché' : 'non affiché'}${e}. Pendant ton sommeil ${Math.round(f.nuit)}${unite}, éveillé ${Math.round(f.jour)}${unite} ; lien avec ton pouls ${f.r >= 0 ? '+' : '−'}${Math.abs(f.r).toFixed(2).replace('.', ',')} (${attendu}).`;
  $('#controles').innerHTML = [
    controle('Variabilité', c.fiab.vfc, ' ms', 'attendu : plus haute la nuit, lien négatif', 'e'),
    controle('Stress', c.fiab.stress, '', 'attendu : plus bas la nuit, lien positif'),
  ].map(t => `<li>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('');
  const jours = [...c.J.keys()];
  $('#etatDonnees').textContent = D.maj
    ? `${D.exemple ? 'Exemple : ' : ''}${c.ns.filter(n => n.tst).length} nuits et ${Object.keys(D.pas).length} jours d'activité`
      + (jours.length ? `, du ${new Date(debutJour(jours[0])).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${new Date(debutJour(jours.at(-1))).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.` : '.')
    : "Aucune donnée pour l'instant.";
}

/* ---------- Navigation ---------- */

function rendre(v = vue) {
  $('#bandeauExemple').hidden = !D.exemple;
  if (v === 'jour') rendreJour(contexte());
  else if (v === 'coach') rendreCoach(contexte());
  else if (v === 'donnees') rendreDonnees(contexte());
  else if (v === 'reglages') rendreReglages();
}
// v peut viser un sous-onglet de Données : « donnees/coeur » ou « donnees/coeur/2026-10-12 »
function montrerVue(v = '') {
  const [nom, onglet, jour] = String(v).split('/');
  if (nom === 'donnees' && onglet) ouvrirDonnees(onglet, jour);
  v = ANCIENNES[nom] ?? nom;
  if (!VUES.includes(v)) v = 'jour';
  vue = v;
  document.querySelectorAll('.vue[data-vue]').forEach(s => { s.hidden = s.dataset.vue !== v; });
  document.querySelectorAll('.onglets button').forEach(b => b.setAttribute('aria-current', b.dataset.vue === v ? 'page' : 'false'));
  history.replaceState(null, '', '#' + v);
  rendre(v);
  scrollTo(0, 0);
}

function demarrer() {
  charger();
  initInfobulles();
  initLive({
    fcMax: fcMaxCourante, toast, importer: importerBracelet, jours: joursASynchroniser, aller: montrerVue,
    dernierReleve: () => (D.exemple ? null : D.fc.at(-1) ?? null),
    synchroUtile: () => D.exemple || !D.majBracelet || Date.now() - D.majBracelet > 30 * 60e3,
    apresConnexion: async () => { await mettreALHeure(); await synchroniserReveils(); },
    activite: a => {
      pasDirect = { cle: cleJour(Date.now()), pas: a.pas };
      const el = $('#valPas');
      if (el) el.textContent = nf(Math.max(D.pas[pasDirect.cle] ?? 0, a.pas));
    },
  });
  brancherDonnees(() => rendre('donnees'));
  brancherCoach(contexte);
  brancherFiches();

  document.querySelectorAll('.onglets button').forEach(b => { b.onclick = () => montrerVue(b.dataset.vue); });
  document.addEventListener('click', e => {
    const aller = e.target.closest('[data-aller]');
    if (aller) { ouvrirDonnees(aller.dataset.onglet, aller.dataset.jour); montrerVue(aller.dataset.aller); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'exemple') chargerExemple();
    if (action === 'synchro') synchroniser();
    if (action === 'connecter') connecterBracelet();
    if (action === 'chercher') chercherBracelet();
    if (action === 'sante') envoyerSante();
    if (action === 'vibrer') testerVibreur();
    if (action === 'rappel-ajouter') modifierVibreur(v => { v.rappels.push({ minutes: 12 * 60, jours: [1, 2, 3, 4, 5], actif: true, nom: 'Rappel' }); });
    if (action === 'rappel-suppr') { const i = +e.target.closest('[data-rappel]').dataset.rappel; modifierVibreur(v => { v.rappels.splice(i, 1); }); }
    const jourRappel = e.target.closest('[data-rappel] [data-jour-rappel]');
    if (jourRappel) {
      const i = +jourRappel.closest('[data-rappel]').dataset.rappel, j = +jourRappel.dataset.jourRappel;
      modifierVibreur(v => { const r = v.rappels[i]; r.jours = r.jours.includes(j) ? r.jours.filter(x => x !== j) : [...r.jours, j]; });
    }
    if (action === 'sieste-oui') modifierSiestes(() => { const b = e.target.closest('[data-action]'); D.siestes.push({ debut: +b.dataset.debut, fin: +b.dataset.fin, source: 'confirmee' }); }, 'Sieste comptée.');
    if (action === 'sieste-non') modifierSiestes(() => { D.nonSiestes.push(+e.target.closest('[data-action]').dataset.debut); }, 'Compris, ce n\'était pas une sieste.');
    if (action === 'sieste-ok') ajouterSieste();
    if (action === 'reveil-retablir') modifierSiestes(() => { delete D.reveils[e.target.closest('[data-action]').dataset.nuit]; }, 'Heure du bracelet rétablie.');
    const supprSieste = e.target.closest('[data-supprimer-sieste]');
    if (supprSieste) modifierSiestes(() => { D.siestes = D.siestes.filter(x => x.debut !== +supprSieste.dataset.supprimerSieste); }, 'Sieste supprimée.');
    if (action === 'sport') {
      const f = $('#formSport'), b = e.target.closest('[data-action]');
      f.hidden = !f.hidden;
      b.setAttribute('aria-expanded', !f.hidden);
    }
    if (action === 'sport-ok') ajouterSport();
    // choix exclusif dans un groupe (durée, intensité)
    const choix = e.target.closest('.form-sport [data-duree], .form-sport [data-intensite], .form-sieste [data-duree]');
    if (choix) choix.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === choix));
    const suppr = e.target.closest('[data-supprimer]');
    if (suppr) supprimerSeance(+suppr.dataset.supprimer);
    const copier = e.target.closest('[data-copier]');
    if (copier) {
      const txt = $('#' + copier.dataset.copier).textContent;
      navigator.clipboard?.writeText(txt).then(() => toast('Copié.'), () => toast('Copie impossible : sélectionne le texte à la main.'));
    }
  });
  // réveil et rappels du bracelet : interrupteurs et champs des rappels
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'vibReveil') modifierVibreur(v => { v.reveil = t.checked; });
    if (t.id === 'vibCoucher') modifierVibreur(v => { v.coucher = t.checked; });
    if (t.id === 'vibNotifs') { R.notifs = t.checked; sauverReglages(); rendreReglages(); }
    const ligne = t.closest('[data-rappel]');
    if (!ligne) return;
    const i = +ligne.dataset.rappel;
    if (t.dataset.champ === 'heure' && HEURE.test(t.value)) modifierVibreur(v => { const [h, m] = t.value.split(':').map(Number); v.rappels[i].minutes = h * 60 + m; });
    if (t.dataset.champ === 'nom') modifierVibreur(v => { v.rappels[i].nom = t.value.trim().slice(0, 20) || 'Rappel'; });
    if (t.dataset.champ === 'actif') modifierVibreur(v => { v.rappels[i].actif = t.checked; });
  });
  // heure de réveil d'une nuit, corrigée à la main dans la fiche Sommeil
  document.addEventListener('change', e => {
    if (e.target.id !== 'reveilNuit') return;
    const cle = e.target.dataset.nuit, [h, m] = e.target.value.split(':').map(Number);
    if (!HEURE.test(e.target.value)) return;
    const [a, mo, j] = cle.split('-').map(Number);
    modifierSiestes(() => { D.reveils[cle] = new Date(a, mo - 1, j, h, m).getTime(); }, `Réveil corrigé : ${e.target.value}.`);
  });
  // heure de lever par jour de la semaine : réglable dans Réglages et directement dans la carte Sommeil
  document.addEventListener('change', e => {
    const j = e.target.dataset?.jour;
    if (j == null || !(e.target.id === 'reveilCarte' || e.target.closest('#leverJours'))) return;
    if (HEURE.test(e.target.value)) R.leverJours[j] = e.target.value; else delete R.leverJours[j];
    sauverReglages();
    if (R.vibreur.reveil || R.vibreur.coucher) modifierVibreur(() => {});   // le réveil vibreur suit l'heure de lever
    if (e.target.id === 'reveilCarte') toast(`Retenu pour tous les ${JOURS[j]}s : modifiable dans Réglages.`);
    rendre();
  });
  $('#btnDemo').onclick = lancerDemo;
  $('#btnExemple').onclick = chargerExemple;
  $('#btnEffacer').onclick = () => effacer();
  $('#btnEffacerExemple').onclick = () => effacer(false);
  $('#btnExport').onclick = exporter;
  $('#btnJournal').onclick = exporterJournal;
  $('#fichierRestaurer').onchange = e => { const f = e.target.files?.[0]; if (f) restaurer(f); e.target.value = ''; };

  const reglage = (id, lire) => { $(id).onchange = e => { const v = lire(e.target.value); if (v !== undefined) { Object.assign(R, v); sauverReglages(); majAge(); rendreReglages(); } }; };
  reglage('#prenom', v => ({ prenom: v.trim().slice(0, 30) }));
  reglage('#age', v => { const a = parseInt(v); return a > 9 && a < 100 ? { age: a } : undefined; });
  reglage('#fcmaxMesuree', v => { if (!v.trim()) return { fcmaxMesuree: null }; const f = parseInt(v); return f >= 120 && f <= 230 ? { fcmaxMesuree: f } : undefined; });
  reglage('#objectif', v => { const h = parseFloat(String(v).replace(',', '.')); return h >= 4 && h <= 12 ? { objectif: Math.round(h * 60) } : undefined; });
  reglage('#objectifPas', v => { const p = parseInt(v); return p >= 1000 && p <= 40000 ? { objectifPas: p } : undefined; });

  addEventListener('hashchange', () => {
    const brut = lireHash(location.hash);
    if (brut != null) { importer(brut); montrerVue('jour'); }
    else montrerVue(location.hash.slice(1));
  });
  let largeur = innerWidth, attente;
  addEventListener('resize', () => {
    clearTimeout(attente);
    attente = setTimeout(() => { if (innerWidth !== largeur) { largeur = innerWidth; rendre(); } }, 150);
  });
  // passé minuit, « aujourd'hui » change : on redessine en revenant sur l'app
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rendre(); });

  // On ouvre toujours sur Aujourd'hui : l'adresse garde le dernier onglet (#reglages…), Bluefy la rouvrirait telle quelle
  const brut = lireHash(location.hash);
  if (brut != null) importer(brut);
  montrerVue('jour');

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

demarrer();
