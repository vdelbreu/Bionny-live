// ViaWrist : point d'entrée. Stockage, réglages, navigation, imports (bracelet, sauvegarde, raccourci Santé), rendu des vues.
import { parseImport, fusionner, vide, nuits as calculerNuits, lireHash, cleJour, debutJour, duree, JOUR } from './sante.js';
import { impExemple } from './exemple.js';
import { initInfobulles, hm } from './graphes.js';
import { fcMaxTanaka } from './coeur.js';
import { journees, fiabilite } from './stats.js';
import { seanceDeclaree, planSommeil, heure, matinSuivant, JOURS } from './coach.js';
import { initLive, majAge, synchroniserBracelet, connecterBracelet, chercherBracelet, enDirect, lancerDemo } from './live.js';
import { journal } from './connexion.js';
import { $, nf, toast } from './ui.js';
import { rendreJour, brancherFiches } from './vues/jour.js';
import { rendreCoach, brancherCoach } from './vues/coach.js';
import { rendreDonnees, brancherDonnees, ouvrirDonnees } from './vues/donnees.js';

const VUES = ['jour', 'coach', 'donnees', 'reglages'];
const ANCIENNES = { direct: 'jour', semaine: 'donnees', bilan: 'coach' };
// objectif en minutes ; leverJours = heure de lever « HH:MM » par jour de la semaine (0 = dimanche), selon tes cours ;
// reveil = ancienne heure unique, gardée seulement le temps de la reporter sur un jour
const R = { prenom: '', age: 25, fcmaxMesuree: null, objectif: 480, objectifPas: 8000, reveil: null, leverJours: {}, raccourci: 'ViaWrist' };
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
    if (action === 'sport') {
      const f = $('#formSport'), b = e.target.closest('[data-action]');
      f.hidden = !f.hidden;
      b.setAttribute('aria-expanded', !f.hidden);
    }
    if (action === 'sport-ok') ajouterSport();
    // choix exclusif dans un groupe (durée, intensité)
    const choix = e.target.closest('.form-sport [data-duree], .form-sport [data-intensite]');
    if (choix) choix.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === choix));
    const suppr = e.target.closest('[data-supprimer]');
    if (suppr) supprimerSeance(+suppr.dataset.supprimer);
    const copier = e.target.closest('[data-copier]');
    if (copier) {
      const txt = $('#' + copier.dataset.copier).textContent;
      navigator.clipboard?.writeText(txt).then(() => toast('Copié.'), () => toast('Copie impossible : sélectionne le texte à la main.'));
    }
  });
  // heure de lever par jour de la semaine : réglable dans Réglages et directement dans la carte Sommeil
  document.addEventListener('change', e => {
    const j = e.target.dataset?.jour;
    if (j == null || !(e.target.id === 'reveilCarte' || e.target.closest('#leverJours'))) return;
    if (HEURE.test(e.target.value)) R.leverJours[j] = e.target.value; else delete R.leverJours[j];
    sauverReglages();
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
