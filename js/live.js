// Direct, en haut d'Aujourd'hui : connexion au bracelet, synchro de l'historique, pouls en temps réel,
// cohérence cardiaque (onglet Coach) et démo. Toutes les mesures, bracelet ou démo, passent par ajouterMesure().
import { ZONES, zoneDe } from './coeur.js';
import * as B from './connexion.js';

const $ = s => document.querySelector(s);
const RESPI_MS = 11000;        // 5,5 s inspiration + 5,5 s expiration
const PERDU_MS = 15000;        // sans valeur depuis 15 s = signal perdu
const O = { fcMax: () => 194, toast: () => {}, importer: () => {}, jours: () => 7, activite: () => {}, aller: () => {}, dernierReleve: () => null, synchroUtile: () => true, apresConnexion: async () => {} };
const ATTENTE_DIRECT_MS = 45000;   // sans valeur en direct après 45 s : on le dit, et on montre le dernier relevé

const S = {
  source: null, t0: performance.now(), mesures: [], bpm: null, derniere: 0,
  coh: { on: false, debut: 0, cycles: {} }, demo: null, appareil: null, wake: null, attente: 0, dernierDessin: 0, libere: false, appareilOk: null,
};
const maintenant = () => (performance.now() - S.t0) / 1000;
const zone = bpm => zoneDe(bpm, O.fcMax());
const perdu = () => S.source === 'ble' && S.derniere && performance.now() - S.derniere > PERDU_MS;
export const enDirect = () => S.source === 'ble' && B.connecte();

/* ---------- Couleurs (lues depuis les tokens) ---------- */
const C = {};
function lireCouleurs() {
  const cs = getComputedStyle(document.documentElement);
  ['--muted', '--grid-minor', '--grid-major', '--breath', ...ZONES.map(z => z.c)].forEach(k => { C[k] = cs.getPropertyValue(k).trim(); });
}

/* ---------- État de la carte ---------- */
// absent (pas de Bluetooth ici), deconnecte, connexion, synchro, mesure (en attente d'une valeur), direct, demo
function carte(etat, texte) {
  $('#carteDirect').dataset.etat = etat;
  if (texte != null) $('#zoneName').textContent = texte;
  if (!['direct', 'demo'].includes(etat)) {
    $('#bpm').innerHTML = '--<small>bpm</small>';
    $('#bpm').classList.add('vide');
  }
  S.attente = etat === 'mesure' ? performance.now() : 0;
  dernierPouls(etat);
  const b = $('#btnConnect');
  b.disabled = etat === 'connexion' || etat === 'synchro';
  b.textContent = { absent: 'Comment faire ?', deconnecte: 'Connecter', connexion: 'Connexion…', synchro: 'Synchro…', demo: 'Arrêter la démo' }[etat] ?? 'Déconnecter';
  b.classList.toggle('primary', etat === 'absent' || etat === 'deconnecte');
}
function puce(texte, cls) { $('#connText').textContent = texte; $('#chipConn').className = 'chip ' + cls; }

// Hors direct, on montre la dernière mesure automatique du bracelet (relevée toutes les 5 min environ)
function dernierPouls(etat) {
  const el = $('#dernierPouls'), r = O.dernierReleve();
  const montrer = r && !['direct', 'demo', 'connexion', 'synchro'].includes(etat);
  el.hidden = !montrer;
  if (!montrer) return;
  const d = new Date(r.t), auj = new Date().toDateString() === d.toDateString();
  const quand = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `Dernier pouls relevé par le bracelet : ${r.v} bpm ${auj ? 'à' : `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à`} ${quand}.`;
}

/* ---------- Réception d'une mesure ---------- */
function ajouterMesure(bpm, contact) {
  if (!bpm || bpm < 25 || bpm > 240) return;
  S.bpm = bpm; S.derniere = performance.now();
  S.mesures.push({ t: maintenant(), bpm });
  if (S.mesures.length > 7200) S.mesures.shift();
  if (S.coh.on) {
    const ci = Math.floor((performance.now() - S.coh.debut) / RESPI_MS);
    const c = S.coh.cycles[ci] ||= { min: bpm, max: bpm };
    c.min = Math.min(c.min, bpm); c.max = Math.max(c.max, bpm);
  }
  $('#chipContact').hidden = contact !== false;
  if ($('#carteDirect').dataset.etat === 'mesure') carte('direct');
  if (!battementEnCours) { battementEnCours = true; planifierBattement(); }
  rendreLive();
}

let battementEnCours = false, minuterie;
function planifierBattement() {
  clearTimeout(minuterie);
  if (!S.bpm || !S.source || perdu()) { battementEnCours = false; return; }
  minuterie = setTimeout(() => {
    const h = $('#coeur');
    h.classList.add('bat');
    setTimeout(() => h.classList.remove('bat'), 110);
    planifierBattement();
  }, 60000 / S.bpm);
}

function rendreLive() {
  if (S.bpm == null) return;
  $('#bpm').innerHTML = S.bpm + '<small>bpm</small>';
  $('#bpm').classList.remove('vide');
  $('#zoneName').textContent = (S.source === 'demo' ? 'Démo · ' : '') + ZONES[zone(S.bpm)].nom;
  $('#zonePct').textContent = '';
  if (S.coh.on) {
    const a = amplitudeCoh();
    $('#rsa').innerHTML = (a == null ? '…' : a.toFixed(1).replace('.', ',')) + "<small>bpm d'écart</small>";
  }
}

/* ---------- Bluetooth (voir connexion.js) ---------- */
const rappels = {
  mesure: (bpm, rr, contact) => ajouterMesure(bpm, contact),
  batterie: v => { $('#battText').textContent = v + ' %'; $('#chipBatt').hidden = false; },
  contact: ok => { $('#chipContact').hidden = ok; },
  activite: a => O.activite(a),
  direct: d => { if (S.bpm == null) $('#zoneName').textContent = d.erreur === 1 ? 'Bracelet mal porté : serre-le un peu' : 'Mesure du pouls en cours…'; },
};

// tous = sans filtre, si le bracelet s'annonce sous un autre nom. Renvoie true une fois connecté.
// Une recherche ne voit pas un bracelet que l'iPhone tient déjà (il n'émet plus) : il fallait l'éteindre et le
// rallumer. D'où, dans l'ordre :
// 1. le bracelet déjà connecté dans cette page (retour sur l'app, Déconnecter puis Connecter) : connexion directe ;
// 2. à l'ouverture de la page, le bracelet retenu par le navigateur (getDevices) : une tentative discrète, abandonnée
//    pour de bon si elle échoue à chaque fois (Bluefy le retrouve mais ne sait pas toujours s'y reconnecter) ;
// 3. sinon la liste des appareils. Sur iPhone, Bluefy n'y montre pas le bracelet avec un filtre : on montre tout.
async function appareilRetenu() {
  if (!navigator.bluetooth?.getDevices) { B.info('getDevices non disponible dans ce navigateur'); return null; }
  try {
    const liste = await navigator.bluetooth.getDevices();
    B.info(`getDevices : ${liste.length} appareil(s)${liste.length ? ' : ' + liste.map(d => d.name || 'sans nom').join(', ') : ''}`);
    return liste.find(d => /bionny/i.test(d.name || '')) ?? (liste.length === 1 ? liste[0] : null);
  } catch (e) { B.info(`getDevices refusé : ${e.message}`); return null; }
}

// Un appareil retenu n'est joignable qu'une fois son annonce entendue (Chrome) : on l'écoute 5 s au plus
async function attendreAnnonce(a, ms = 5000) {
  if (!a.watchAdvertisements) return;
  try {
    await new Promise((oui, non) => {
      const fin = setTimeout(() => non(new Error('aucune annonce entendue')), ms);
      a.addEventListener('advertisementreceived', () => { clearTimeout(fin); oui(); }, { once: true });
      a.watchAdvertisements().catch(non);
    });
    B.info('annonce du bracelet entendue');
  } catch (e) { B.info(`annonce : ${e.message}`); }
  finally { try { a.unwatchAdvertisements?.(); } catch { /* rien à arrêter */ } }
}

// Jamais d'attente sans fin : si le navigateur ne répond pas, on abandonne au bout de 15 s et l'aide s'affiche
const DELAI_CONNEXION = 15000;
async function brancherAppareil(appareil, { delai = DELAI_CONNEXION, discret = false } = {}) {
  arreterDemo(); remiseAZero();
  S.appareil = appareil; S.source = 'ble'; S.libere = false;
  appareil.addEventListener('gattserverdisconnected', deconnexion);
  carte('connexion', 'Connexion au bracelet…'); puce('Connexion…', '');
  try {
    await brancher(true, delai);
    B.info(`connecté à ${appareil.name || 'appareil sans nom'}`);
    S.appareilOk = appareil;
    $('#aideConnexion').hidden = true;
    return true;
  } catch (e) {
    B.info(`connexion impossible : ${e.message}`);
    S.source = null; B.fermer();
    carte('deconnecte', 'Bracelet non connecté'); puce('Déconnecté', '');
    if (!discret) {
      $('#aideConnexion').hidden = false;
      O.toast(e.name === 'NotFoundError' ? `« ${appareil.name || 'Cet appareil'} » n'est pas le bracelet.` : "Connexion impossible : ferme l'app Bionny, puis réessaie.");
    }
    return false;
  }
}

async function connecter() {
  if (!navigator.bluetooth) { O.aller('reglages'); const g = $('#guide'); if (g) { g.open = true; g.scrollIntoView({ behavior: 'smooth' }); } return false; }
  if (B.connecte()) return true;
  if (S.appareilOk) {
    B.info(`connexion directe à ${S.appareilOk.name || 'appareil sans nom'}`);
    if (await brancherAppareil(S.appareilOk, { delai: 8000, discret: true })) return true;
    $('#aideConnexion').hidden = false;
    O.toast("Bracelet injoignable : ferme l'app Bionny, puis « Chercher ».");
    return false;
  }
  return chercher();
}

async function chercher(tous = false) {
  if (!navigator.bluetooth || B.connecte()) return B.connecte();
  const toutMontrer = tous || matchMedia('(pointer: coarse)').matches;
  B.info(toutMontrer ? 'liste de tous les appareils' : 'recherche du bracelet');
  let appareil;
  try {
    appareil = await B.choisir(toutMontrer);
  } catch (e) {
    B.info(`liste fermée : ${e.name}`);
    // liste fermée sans choisir (Bluefy renvoie parfois NotAllowedError) : on reste sur Aujourd'hui, l'aide s'affiche
    $('#aideConnexion').hidden = false;
    return false;
  }
  return brancherAppareil(appareil);
}
const avecDelai = (p, ms) => Promise.race([p, new Promise((_, non) => setTimeout(() => non(new Error('délai dépassé')), ms))]);
async function brancher(avecHistorique, delai = DELAI_CONNEXION) {
  const ouverture = B.ouvrir(S.appareil, rappels);
  const mode = await avecDelai(ouverture, delai);
  puce('Connecté · ' + (S.appareil.name || 'Bionny'), 'live');
  if (mode === 'colmi') {
    if (avecHistorique && O.synchroUtile()) await synchroniserHistorique();
    // heure et réveils du bracelet : un échec ici ne doit jamais couper la connexion
    try { await O.apresConnexion(); } catch (e) { B.info(`après connexion : ${e.message}`); }
    B.demarrerDirect();
  }
  carte(S.bpm == null ? 'mesure' : 'direct', S.bpm == null ? 'Mesure du pouls en cours…' : null);
  try { S.wake = await navigator.wakeLock?.request('screen'); } catch { /* pas de wake lock */ }
}
async function deconnexion() {
  if (S.source !== 'ble') return;
  carte('connexion', 'Reconnexion…'); puce('Reconnexion…', '');
  B.arreterDirect();
  for (let k = 0; k < 3; k++) {
    try { await brancher(false); return; } catch { await new Promise(r => setTimeout(r, 1500 * (k + 1))); }
  }
  S.source = null;
  carte('deconnecte', 'Bracelet déconnecté'); puce('Déconnecté', '');
}
function deconnecter() {
  S.source = null;
  B.fermer();
  carte('deconnecte', 'Bracelet non connecté'); puce('Déconnecté', '');
}

// Historique (sommeil, FC, pas…) lu dans le bracelet puis transmis à l'app
let synchroEnCours = false;
async function synchroniserHistorique() {
  if (B.mode() !== 'colmi' || synchroEnCours) return false;
  synchroEnCours = true;
  try {
    const imp = await B.synchroniser(O.jours(), t => { carte('synchro', 'Synchronisation · ' + t); puce('Synchro…', ''); });
    O.importer(imp);
    return true;
  } catch (e) {
    O.toast('Synchronisation impossible : ' + e.message);
    return false;
  } finally {
    synchroEnCours = false;
    if (B.connecte()) {
      puce('Connecté · ' + (S.appareil?.name || 'Bionny'), 'live');
      carte(S.bpm == null ? 'mesure' : 'direct', S.bpm == null ? 'Mesure du pouls en cours…' : null);
    }
  }
}

// Boutons « Synchroniser » : se connecte si besoin (la connexion synchronise déjà)
export async function synchroniserBracelet() {
  if (!B.connecte()) return connecter();
  return synchroniserHistorique();
}
export const connecterBracelet = () => connecter();
export const chercherBracelet = () => chercher();

// À l'ouverture de l'app et au retour dessus : reconnexion directe, discrète, puis synchro si la dernière date de plus
// de 30 min. Le bilan des tentatives par getDevices est gardé : après 2 échecs sans aucune réussite, on ne les tente
// plus qu'une fois par semaine, pour ne pas faire attendre 15 s à chaque ouverture.
const RECO = 'viawrist-reconnexion', SEMAINE = 7 * 24 * 3600e3;
const lireReco = () => { try { return { ok: 0, ko: 0, t: 0, ...JSON.parse(localStorage.getItem(RECO) || '{}') }; } catch { return { ok: 0, ko: 0, t: 0 }; } };
function noterReco(reussi) {
  const r = lireReco();
  r[reussi ? 'ok' : 'ko']++; r.t = Date.now();
  try { localStorage.setItem(RECO, JSON.stringify(r)); } catch { /* stockage indisponible */ }
}
let derniereTentative = 0;
async function reconnexionAuto(immediat = false) {
  if (!navigator.bluetooth || S.source || (!immediat && Date.now() - derniereTentative < 60000)) return;
  derniereTentative = Date.now();
  if (S.appareilOk) {
    B.info('reconnexion automatique (même page)');
    await brancherAppareil(S.appareilOk, { delai: 10000, discret: true });
    return;
  }
  const r = lireReco();
  if (r.ko >= 2 && !r.ok && Date.now() - r.t < SEMAINE) { B.info('reconnexion automatique en pause : elle échoue dans ce navigateur'); return; }
  const a = await appareilRetenu();
  if (!a || S.source) return;
  B.info(`reconnexion automatique à ${a.name || 'appareil sans nom'}`);
  await attendreAnnonce(a);
  if (S.source) return;
  noterReco(await brancherAppareil(a, { delai: 10000, discret: true }));
}

// Quitter ViaWrist (autre app, écran verrouillé, page fermée) libère le bracelet : l'app Bionny, ou une recherche,
// le retrouvent sans l'éteindre. Au retour, reconnexion directe. Pas pendant une synchro, pour ne pas la couper.
function liberer(raison) {
  if (S.source !== 'ble' || synchroEnCours) return;
  B.info(`bracelet libéré (${raison})`);
  S.source = null; S.libere = true;
  B.fermer();
  carte('deconnecte', 'Bracelet non connecté'); puce('Déconnecté', '');
}

/* ---------- Démo : données simulées, toujours affichées comme telles ---------- */
function demarrerDemo() {
  if (S.source === 'ble') return;
  remiseAZero(); S.source = 'demo';
  const d = S.demo = { t0: performance.now(), base: 72, bruit: 0 };
  d.timer = setInterval(() => {
    const t = (performance.now() - d.t0) / 1000;
    let rsa = 2.2 * Math.sin(2 * Math.PI * t / 4.3);
    if (S.coh.on) { const p = ((performance.now() - S.coh.debut) % RESPI_MS) / RESPI_MS; rsa = 7.5 * Math.sin(2 * Math.PI * (p - .15)); }
    const cible = S.coh.on ? 63 : 70 + 25 * (.5 - .5 * Math.cos(2 * Math.PI * t / 240));
    d.base += (cible - d.base) * .12;
    d.bruit = Math.max(-3, Math.min(3, d.bruit + (Math.random() - .5)));
    ajouterMesure(Math.round(d.base + d.bruit + rsa), true);
  }, 1000);
  carte('demo', 'Démo');
  puce('Démo · données simulées', 'demo');
}
function arreterDemo() {
  if (S.demo) clearInterval(S.demo.timer);
  S.demo = null;
  if (S.source === 'demo') { S.source = null; carte('deconnecte', 'Bracelet non connecté'); puce('Déconnecté', ''); }
}
export function lancerDemo() { demarrerDemo(); O.aller('jour'); }

/* ---------- Cohérence cardiaque (onglet Coach) ---------- */
let finCoh;
function basculerCoh() {
  S.coh.on = !S.coh.on;
  $('#btnCoh').setAttribute('aria-pressed', S.coh.on);
  $('#btnCoh').textContent = S.coh.on ? 'Arrêter' : 'Démarrer';
  clearTimeout(finCoh);
  if (S.coh.on) {
    S.coh.debut = performance.now(); S.coh.cycles = {};
    if (!S.source) $('#rsa').innerHTML = "–<small>connecte le bracelet pour voir l'effet</small>";
    finCoh = setTimeout(() => { if (S.coh.on) { basculerCoh(); O.toast('5 minutes de respiration : bien joué.'); } }, 300000);
  } else $('#orbText').textContent = 'Prêt';
}
function amplitudeCoh() {
  const cur = Math.floor((performance.now() - S.coh.debut) / RESPI_MS);
  const finis = Object.entries(S.coh.cycles).filter(([k]) => +k < cur).map(([, c]) => c.max - c.min);
  return finis.length ? finis.reduce((a, b) => a + b, 0) / finis.length : null;
}
function dessinerOrbe() {
  if (!S.coh.on) { $('#orb').style.transform = 'scale(.55)'; return; }
  const p = ((performance.now() - S.coh.debut) % RESPI_MS) / RESPI_MS, inspire = p < .5;
  const k = inspire ? p * 2 : 1 - (p - .5) * 2, e = .5 - .5 * Math.cos(Math.PI * k);
  $('#orb').style.transform = `scale(${.55 + .45 * e})`;
  $('#orbText').textContent = (inspire ? 'Inspire ' : 'Expire ') + Math.ceil((inspire ? .5 - p : 1 - p) * RESPI_MS / 1000);
}

/* ---------- Tracé des 2 dernières minutes ---------- */
function ajuster(c) {
  const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  return [ctx, r.width, r.height];
}
function dessinerTrace() {
  const [ctx, W, Hc] = ajuster($('#chart'));
  if (!W) return;
  ctx.clearRect(0, 0, W, Hc);
  const L = 30, R = 6, T = 6, Bm = 16, pw = W - L - R, ph = Hc - T - Bm, duree = 120, tn = maintenant(), x0 = tn - duree;
  const vis = S.mesures.filter(s => s.t >= x0 - 2);
  let lo = 50, hi = 110;
  if (vis.length) { lo = Math.min(...vis.map(s => s.bpm)); hi = Math.max(...vis.map(s => s.bpm)); }
  lo = Math.floor((lo - 6) / 10) * 10; hi = Math.ceil((hi + 6) / 10) * 10;
  if (hi - lo < 30) { const m = Math.round((hi + lo) / 20) * 10; lo = m - 15; hi = m + 15; }
  const X = t => L + (t - x0) / duree * pw, Y = b => T + (1 - (b - lo) / (hi - lo)) * ph;
  ctx.lineWidth = 1;
  for (let s = Math.ceil(x0 / 10) * 10; s <= tn; s += 10) {
    ctx.strokeStyle = s % 30 === 0 ? C['--grid-major'] : C['--grid-minor'];
    ctx.beginPath(); ctx.moveTo(X(s), T); ctx.lineTo(X(s), T + ph); ctx.stroke();
  }
  ctx.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  for (let b = lo; b <= hi; b += 10) {
    ctx.strokeStyle = C['--grid-minor'];
    ctx.beginPath(); ctx.moveTo(L, Y(b)); ctx.lineTo(L + pw, Y(b)); ctx.stroke();
    ctx.fillStyle = C['--muted']; ctx.fillText(b, L - 5, Y(b));
  }
  ctx.textBaseline = 'alphabetic';
  [[-120, '−2 min', 'left'], [-60, '−1 min', 'center'], [0, 'maintenant', 'right']].forEach(([o, l, a]) => { ctx.textAlign = a; ctx.fillText(l, X(tn + o), Hc - 3); });
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  ctx.lineWidth = 2.5; ctx.lineJoin = ctx.lineCap = 'round';
  for (let i = 1; i < vis.length; i++) {
    if (vis[i].t - vis[i - 1].t > 10) continue;   // trou dans les mesures : on ne relie pas
    ctx.strokeStyle = C[ZONES[zone(vis[i].bpm)].c];
    ctx.beginPath(); ctx.moveTo(X(vis[i - 1].t), Y(vis[i - 1].bpm)); ctx.lineTo(X(vis[i].t), Y(vis[i].bpm)); ctx.stroke();
  }
  ctx.restore();
  const der = vis.at(-1);
  if (der && !perdu()) {
    ctx.fillStyle = C[ZONES[zone(der.bpm)].c];
    ctx.beginPath(); ctx.arc(X(der.t), Y(der.bpm), 4, 0, 7); ctx.fill();
  }
}

function remiseAZero() {
  S.t0 = performance.now(); S.mesures = []; S.bpm = null; S.derniere = 0;
}

export function majAge() { rendreLive(); }

export function initLive(opts) {
  Object.assign(O, opts);
  lireCouleurs();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', lireCouleurs);
  new MutationObserver(lireCouleurs).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  if (!navigator.bluetooth) carte('absent', "Le direct passe par l'app Bluefy");
  else carte('deconnecte', 'Bracelet non connecté');
  $('#btnConnect').onclick = () => (S.source === 'ble' ? deconnecter() : S.source === 'demo' ? arreterDemo() : connecter());
  $('#btnTous').onclick = () => chercher(true);
  $('#btnTous').hidden = matchMedia('(pointer: coarse)').matches;   // sur iPhone, « Chercher » montre déjà tout
  addEventListener('pagehide', () => liberer('page fermée'));
  $('#btnCoh').onclick = basculerCoh;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return liberer('app quittée');
    if (S.source === 'ble') try { S.wake = await navigator.wakeLock?.request('screen'); } catch { /* pas de wake lock */ }
    else reconnexionAuto(S.libere);
  });
  reconnexionAuto();

  (function boucle() {
    if (!$('#vue-jour').hidden) {
      const p = perdu();
      $('#chipPerdu').hidden = !p;
      $('#bpm').classList.toggle('perime', !!p);
      if (!p && S.source && S.bpm && !battementEnCours) { battementEnCours = true; planifierBattement(); }
      const etat = $('#carteDirect').dataset.etat, t = performance.now();
      // 4 images par seconde suffisent au tracé et ménagent la batterie
      if (['direct', 'demo'].includes(etat) && t - S.dernierDessin > 250) { dessinerTrace(); S.dernierDessin = t; }
      if (etat === 'mesure' && S.attente && t - S.attente > ATTENTE_DIRECT_MS) {
        S.attente = 0;
        $('#zoneName').textContent = 'Pas de mesure en direct pour le moment';
        dernierPouls('deconnecte');
      }
    }
    if (!$('#vue-coach').hidden) dessinerOrbe();
    requestAnimationFrame(boucle);
  })();
}
