// Données Apple Santé : lecture du texte envoyé par le raccourci iPhone, fusion avec l'historique local, déductions.
// Aucune dépendance au DOM : testé dans test/sante.test.js.

export const MIN = 60e3, H = 60 * MIN, JOUR = 24 * H;
const ENDORMI = new Set(['asleep', 'core', 'deep', 'rem']);

export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const moyenne = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
export function ecartType(v) {
  if (v.length < 2) return null;
  const m = moyenne(v);
  return Math.sqrt(moyenne(v.map(x => (x - m) ** 2)));
}

export function cleJour(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function debutJour(cle) {
  const [y, m, d] = cle.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// « 7 h 05 », ou « 42 min » sous l'heure
export function duree(ms) {
  const m = Math.round(Math.abs(ms) / MIN);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/* ---------- Lecture des dates, nombres et stades ---------- */

function mois(mot) {
  const w = norm(mot).replace(/\./g, '');
  if (w.startsWith('juin')) return 5;
  if (w.startsWith('juil')) return 6;
  return { jan: 0, fev: 1, feb: 1, mar: 2, avr: 3, apr: 3, mai: 4, may: 4, jun: 5, jul: 6, aou: 7, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }[w.slice(0, 3)];
}

// ISO 8601 (format conseillé dans le raccourci), sinon les formats français par défaut
// (« 13 oct. 2026 à 23:14 », « 13/10/2026 23:14:05 »). Renvoie un timestamp ms ou null.
export function parseDate(txt) {
  const s = String(txt).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (m) {
    const [, y, mo, d, h, mi, se = 0, tz] = m;
    if (!tz) return new Date(+y, mo - 1, +d, +h, +mi, +se).getTime();
    const utc = Date.UTC(+y, mo - 1, +d, +h, +mi, +se);
    if (/z/i.test(tz)) return utc;
    const c = tz.slice(1).replace(':', '');
    const decalage = (+c.slice(0, 2) * 60 + +(c.slice(2, 4) || 0)) * (tz[0] === '-' ? -1 : 1);
    return utc - decalage * MIN;
  }
  m = norm(s).match(/^(\d{1,2})[\s/.-]+([a-z]+\.?|\d{1,2})[\s/.-]+(\d{4}|\d{2})\D+?(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*:\s*(\d{2}))?/);
  if (m) {
    const [, d, moTxt, yTxt, h, mi, se = 0] = m;
    const mo = /^\d+$/.test(moTxt) ? moTxt - 1 : mois(moTxt);
    if (mo == null || mo < 0 || mo > 11) return null;
    const y = yTxt.length === 2 ? 2000 + +yTxt : +yTxt;
    return new Date(y, mo, +d, +h, +mi, +se).getTime();
  }
  return null;
}

// Nombre au format français (« 72,5 », « 8 542 », « 97 % »). entier = accepte « 8,542 » comme milliers.
export function parseNum(txt, entier = false) {
  let s = String(txt).replace(/[\s  ']/g, '');
  if (entier && /^\d{1,3}([.,]\d{3})+(?!\d)/.test(s)) s = s.replace(/[.,](?=\d{3}(?!\d))/g, '');
  const m = s.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? +m[0] : null;
}

// Valeur d'« Analyse du sommeil » (texte FR ou EN, ou code HealthKit 0..5) vers un stade interne
export function stade(v) {
  const s = norm(v);
  if (/^\d$/.test(s)) return ['inBed', 'asleep', 'awake', 'core', 'deep', 'rem'][+s] ?? null;
  if (/au lit|in ?bed|inbed/.test(s)) return 'inBed';
  if (/eveil|awake|reveil/.test(s)) return 'awake';
  if (/parad|\brem\b/.test(s)) return 'rem';
  if (/profond|deep/.test(s)) return 'deep';
  if (/essentiel|core|leger|light/.test(s)) return 'core';
  if (/endormi|asleep|sommeil|sleep/.test(s)) return 'asleep';
  return null;
}

/* ---------- Texte du raccourci ---------- */

const TYPES = {
  sommeil: { nom: 'Sommeil', fin: true },
  fc:      { nom: 'Fréquence cardiaque', min: 25, max: 240 },
  pas:     { nom: 'Pas', min: 0, max: 200000, entier: true },
  vfc:     { nom: 'Variabilité cardiaque', min: 1, max: 400 },
  spo2:    { nom: 'Oxygène', min: 50, max: 100 },
  repos:   { nom: 'FC au repos', min: 25, max: 200 },
};

// Une liste de dates collée sur une seule ligne (séparée par des virgules) est redécoupée
function eclate(liste) {
  if (liste.length === 1 && (liste[0].match(/\d{4}-\d{2}-\d{2}T/g) || []).length > 1) return liste[0].split(/\s*[,;]\s*(?=\d{4}-)/);
  return liste;
}

// Lit le fragment d'URL « #d=… » posé par le raccourci
export function lireHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h.startsWith('d=')) return null;
  const brut = h.slice(2);
  try { return decodeURIComponent(brut); } catch {
    try { return decodeURIComponent(brut.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { return brut; }
  }
}

// Le texte est une suite de blocs « #type_champ » suivis d'une valeur par ligne.
// Les listes d'un même type sont alignées par position (n-ième date avec n-ième valeur).
export function parseImport(texte) {
  const blocs = {};
  let cle = null;
  for (const brut of String(texte).split(/\r\n|\r|\n/)) {
    const ligne = brut.trim();
    if (!ligne) continue;
    const m = ligne.match(/^#\s*(.+)$/);
    if (m) { cle = norm(m[1]).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); blocs[cle] ??= []; continue; }
    // un « + » d'encodage d'espace redevient espace, sauf celui d'un fuseau (+02:00)
    if (cle) blocs[cle].push(ligne.replace(/\+(?!\d{2}:?\d{2}$)/g, ' ').trim());
  }

  const avert = [];
  const out = { sommeil: [], fc: [], pas: [], vfc: [], spo2: [], repos: [], avertissements: avert };
  for (const [type, cfg] of Object.entries(TYPES)) {
    let debuts = blocs[type + '_debut'] ?? blocs[type + '_date'];
    if (!debuts?.length || debuts.every(d => d.includes('‹'))) continue;   // bloc absent ou modèle non rempli
    debuts = eclate(debuts);
    const fins = cfg.fin ? eclate(blocs[type + '_fin'] ?? []) : null;
    let vals = blocs[type + '_valeur'] ?? blocs[type + '_valeurs'] ?? [];
    if (vals.length === 1 && debuts.length > 1) vals = vals[0].split(/\s*;\s*|,\s+/);

    if (debuts.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      avert.push(`${cfg.nom} : les dates n'ont pas d'heure. Dans le raccourci, règle le format de date sur ISO 8601 avec l'heure.`);
      continue;
    }
    const n = Math.min(debuts.length, vals.length, fins ? fins.length : Infinity);
    if (debuts.length !== vals.length || (fins && fins.length !== debuts.length)) {
      avert.push(`${cfg.nom} : ${debuts.length} dates pour ${vals.length} valeurs, seules les ${n} premières sont lues.`);
    }
    let rejets = 0;
    for (let i = 0; i < n; i++) {
      const t = parseDate(debuts[i]);
      if (t == null) { rejets++; continue; }
      if (type === 'sommeil') {
        const e = parseDate(fins[i]), k = stade(vals[i]);
        if (e == null || !k || e <= t || e - t > 24 * H) { rejets++; continue; }
        out.sommeil.push({ s: t, e, k });
      } else {
        let v = parseNum(vals[i], cfg.entier);
        if (type === 'spo2' && v != null && v <= 1) v *= 100;
        if (v == null || v < cfg.min || v > cfg.max) { rejets++; continue; }
        out[type].push({ t, v });
      }
    }
    if (n && rejets === n) avert.push(`${cfg.nom} : aucune ligne lisible. Vérifie les variables de ce bloc dans le raccourci.`);
    else if (rejets > n * .1) avert.push(`${cfg.nom} : ${rejets} lignes ignorées sur ${n}.`);
  }

  for (const type of ['fc', 'pas', 'vfc', 'spo2', 'repos']) out[type].sort((a, b) => a.t - b.t);
  out.sommeil.sort((a, b) => a.s - b.s);
  const jours = new Set(out.pas.map(x => cleJour(x.t))).size;
  if (out.pas.length > jours * 1.5) {
    avert.push("Pas : plusieurs mesures par jour. Dans le raccourci, choisis « Grouper par : Jour », sinon les pas de l'iPhone et du bracelet peuvent être comptés deux fois.");
  }
  return out;
}

export function totauxPas(pas) {
  const parJour = {};
  for (const { t, v } of pas) parJour[cleJour(t)] = (parJour[cleJour(t)] || 0) + v;
  return parJour;
}

/* ---------- Historique local ---------- */

// séries horodatées (t, ou s pour le sommeil) ; pas = totaux par jour ; seances = séances enregistrées en direct
export const SERIES = ['sommeil', 'fc', 'vfc', 'spo2', 'repos', 'stress', 'activite'];
// siestes, nonSiestes, reveils et synchros viennent de toi ou de l'app, pas du bracelet : une synchro ne les touche pas
export const vide = () => ({ v: 1, sommeil: [], fc: [], pas: {}, vfc: [], spo2: [], repos: [], stress: [], activite: [], seances: [],
  siestes: [], nonSiestes: [], reveils: {}, synchros: [], maj: null, exemple: false, avertissements: [] });

// L'import fait foi sur la période qu'il couvre : ce qui est stocké à partir de sa première mesure est remplacé.
// parJour (synchro du bracelet, jour par jour) : seuls les jours présents dans l'import sont remplacés, pour qu'une
// synchro interrompue n'efface jamais un jour déjà enregistré. Le sommeil reste remplacé à partir de sa première nuit.
export function fusionner(base, imp, maintenant, { parJour = false } = {}) {
  const out = { ...vide(), ...base, exemple: false };
  const temps = x => x.s ?? x.t;
  for (const type of SERIES) {
    const nouv = imp[type] || [];
    if (!nouv.length) continue;
    let garder;
    if (parJour && type !== 'sommeil') {
      const jours = new Set(nouv.map(x => cleJour(temps(x))));
      garder = x => !jours.has(cleJour(temps(x)));
    } else {
      const depuis = nouv.reduce((m, x) => Math.min(m, temps(x)), Infinity);
      garder = x => temps(x) < depuis;
    }
    out[type] = [...(base[type] || []).filter(garder), ...nouv].sort((a, b) => temps(a) - temps(b));
  }
  const jours = totauxPas(imp.pas), premier = Object.keys(jours).sort()[0];
  out.pas = { ...(base.pas || {}) };
  for (const [k, v] of Object.entries(jours)) {
    // le premier jour de la fenêtre du raccourci est souvent incomplet : on garde le plus grand total
    out.pas[k] = k === premier && out.pas[k] ? Math.max(out.pas[k], v) : v;
  }
  // 120 jours de tout : à 1 relevé de FC toutes les 5 min, cela tient dans le stockage du navigateur
  for (const type of SERIES) out[type] = (out[type] || []).filter(x => temps(x) > maintenant - 120 * JOUR);
  for (const k of Object.keys(out.pas)) if (debutJour(k) < maintenant - 120 * JOUR) delete out.pas[k];
  out.maj = maintenant;
  out.avertissements = imp.avertissements;
  return out;
}

/* ---------- Intervalles ---------- */

export function union(iv) {
  const t = iv.map(({ s, e }) => ({ s, e })).sort((a, b) => a.s - b.s), out = [];
  for (const x of t) {
    const p = out.at(-1);
    if (p && x.s <= p.e) p.e = Math.max(p.e, x.e); else out.push(x);
  }
  return out;
}

// a privé de b (les deux triés et fusionnés)
export function soustraire(a, b) {
  const out = [];
  for (const x of a) {
    let cur = x.s;
    for (const y of b) {
      if (y.e <= cur || y.s >= x.e) continue;
      if (y.s > cur) out.push({ s: cur, e: y.s });
      cur = Math.max(cur, y.e);
      if (cur >= x.e) break;
    }
    if (cur < x.e) out.push({ s: cur, e: x.e });
  }
  return out;
}

export const total = iv => iv.reduce((a, x) => a + x.e - x.s, 0);

/* ---------- Nuits ---------- */

export function analyseNuit(segs) {
  const de = f => union(segs.filter(x => f(x.k)));
  const eveilDeclare = de(k => k === 'awake');
  const dort = soustraire(de(k => ENDORMI.has(k)), eveilDeclare);
  const tout = union(segs);
  const debutLit = tout[0].s, finLit = tout.at(-1).e;
  const tst = total(dort);
  const debut = dort[0]?.s ?? debutLit, fin = dort.at(-1)?.e ?? finLit;
  const stades = {};
  for (const k of ['deep', 'rem', 'core']) stades[k] = total(soustraire(de(x => x === k), eveilDeclare));
  stades.asleep = Math.max(0, tst - stades.deep - stades.rem - stades.core);
  let reveils = 0;
  for (let i = 1; i < dort.length; i++) if (dort[i].s - dort[i - 1].e >= 5 * MIN) reveils++;
  const auLit = de(k => k === 'inBed');
  const latence = tst && auLit.length && auLit[0].s < debut && debut - auLit[0].s < 3 * H ? debut - auLit[0].s : null;
  const lit = finLit - debutLit;
  return {
    segs, dort, debut, fin, debutLit, finLit, tst, lit,
    // sans heure de coucher (« au lit »), le temps au lit n'est pas connu : pas d'efficacité
    efficacite: tst && auLit.length ? tst / lit : null,
    reveils, eveil: tst ? fin - debut - tst : 0, latence, stades,
    aDesStades: stades.deep + stades.rem + stades.core > 0,
  };
}

// Sommeil principal : au moins 3 h, ou au moins 30 min qui recouvrent 2 h à 5 h du matin. Le reste = sieste.
function estNuit(n) {
  const d = n.tst || n.lit;
  if (d >= 3 * H) return true;
  if (d < 30 * MIN) return false;
  for (const t of [n.debutLit, n.finLit]) {
    const j = new Date(t), a = new Date(j.getFullYear(), j.getMonth(), j.getDate(), 2).getTime();
    if (n.debutLit < a + 3 * H && n.finLit > a) return true;
  }
  return false;
}

// FC de repos = moyenne du décile le plus bas des mesures prises pendant le sommeil (6 mesures minimum)
export function fcRepos(fc, a, b) {
  const v = fc.filter(x => x.t >= a && x.t <= b).map(x => x.v).sort((x, y) => x - y);
  if (v.length < 6) return null;
  const k = Math.max(3, Math.round(v.length / 10));
  return { repos: Math.round(moyenne(v.slice(0, k))), moy: Math.round(moyenne(v)), min: v[0], max: v.at(-1), n: v.length };
}

function dans(serie, a, b) { return serie.filter(x => x.t >= a && x.t <= b).map(x => x.v); }

// Segments regroupés en périodes de sommeil (trous de moins de 2 h = même période)
function grappesSommeil(d) {
  const segs = [...d.sommeil].sort((a, b) => a.s - b.s);
  const grappes = [];
  for (const x of segs) {
    const g = grappes.at(-1);
    if (g && x.s <= g.fin + 2 * H) { g.segs.push(x); g.fin = Math.max(g.fin, x.e); }
    else grappes.push({ segs: [x], fin: x.e });
  }
  return grappes;
}

const mediane = v => { const t = [...v].sort((a, b) => a - b); return t.length ? (t.length % 2 ? t[t.length >> 1] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : null; };
const couperA = (segs, t) => segs.filter(x => x.s < t).map(x => (x.e > t ? { ...x, e: t } : x));
const prolongerA = (segs, t) => { const fin = Math.max(...segs.map(x => x.e)); return t > fin ? [...segs, { s: fin, e: t, k: 'asleep' }] : segs; };

// Réveil au pouls : le bracelet arrête parfois la nuit au moment d'une synchro, alors que tu es réveillé mais encore
// au lit. Deux relevés de suite nettement au-dessus de ton pouls de la nuit (+ 12 bpm), sans retour au calme ensuite
// (pas sous + 6), dans la dernière heure : tu étais réveillé. Un pic isolé (micro-réveil) ne compte pas.
export function reveilAuPouls(n, fc) {
  const base = mediane(dans(fc, n.debut, n.fin - 45 * MIN));
  if (base == null) return null;
  const fin = fc.filter(x => x.t >= n.fin - H && x.t <= n.fin).sort((a, b) => a.t - b.t);
  for (let i = 0; i + 1 < fin.length; i++) {
    if (fin[i].t < n.debut + H) continue;
    if (fin[i].v >= base + 12 && fin[i + 1].v >= base + 12 && fin.slice(i).every(x => x.v >= base + 6)) return fin[i].t;
  }
  return null;
}

// Nuits, datées par le jour du réveil, telles que le bracelet les a détectées (comme l'app Bionny). Seule exception :
// l'heure de réveil que tu corriges toi-même. finProvisoire : le bracelet a arrêté la nuit au moment d'une synchro.
// (reveilAuPouls reste disponible mais n'est plus appliqué : à la demande de l'utilisateur, on garde le bracelet.)
export function nuits(d) {
  const parJour = new Map();
  for (const g of grappesSommeil(d)) {
    const n = analyseNuit(g.segs);
    if (!estNuit(n)) continue;
    const cle = cleJour(n.fin), prec = parJour.get(cle);
    parJour.set(cle, prec ? analyseNuit([...prec.segs, ...g.segs]) : n);
  }
  return [...parJour.entries()].map(([cle, brute]) => {
    let n = brute, finSource = 'bracelet';
    const toi = d.reveils?.[cle];
    if (Number.isFinite(toi) && toi > brute.debut + H && toi < brute.fin + 3 * H) {
      n = analyseNuit(toi < brute.finLit ? couperA(brute.segs, toi) : prolongerA(brute.segs, toi));
      finSource = 'toi';
    }
    const finProvisoire = finSource === 'bracelet' && (d.synchros || []).some(t => t - brute.fin >= -2 * MIN && t - brute.fin <= 10 * MIN);
    const vfc = n.tst ? dans(d.vfc || [], n.debut - H, n.fin + 2 * H) : [];
    const spo2 = n.tst ? dans(d.spo2 || [], n.debut, n.fin) : [];
    return {
      cle, ...n, finBracelet: brute.fin, finSource, finProvisoire,
      fcNuit: n.tst ? fcRepos(d.fc || [], n.debut, n.fin) : null,
      vfcNuit: vfc.length ? Math.round(moyenne(vfc)) : null,
      spo2Nuit: spo2.length ? { moy: Math.round(moyenne(spo2)), min: Math.round(Math.min(...spo2)) } : null,
    };
  }).sort((a, b) => a.fin - b.fin);
}

// Siestes. Le bracelet n'en enregistre pas (une seule période de sommeil par jour) : elles viennent de toi, déclarées
// ou proposées puis confirmées, et du bracelet s'il en note une un jour. Elles comptent dans ton sommeil de la semaine.
const chevauche = (liste, a, b) => liste.some(x => x.debut < b && x.fin > a);
export function siestesFaites(d) {
  const faites = (d.siestes || []).map(x => ({ ...x }));
  for (const g of grappesSommeil(d)) {
    const n = analyseNuit(g.segs);
    if (!estNuit(n) && n.tst >= 10 * MIN && !chevauche(faites, n.debut, n.fin)) faites.push({ debut: n.debut, fin: n.fin, source: 'bracelet' });
  }
  return faites.sort((a, b) => a.debut - b.debut);
}

// Siestes probables, à confirmer, jamais comptées seules : de 45 min après ton réveil jusqu'à 21 h, au moins 20 min où
// ton pouls reste au niveau de tes nuits (moyenne ≤ pouls moyen de la nuit + 4, aucun relevé au-delà de + 9), et
// presque pas de pas dans ces heures-là (150 par heure au plus ; une heure absente = aucun pas, le bracelet ne note que
// les heures où tu marches). Rester assis au calme peut y ressembler : d'où la confirmation.
export function siestesProbables(d, ns, maintenant, jours = 2) {
  const refs = ns.map(n => n.fcNuit?.moy).filter(Number.isFinite);
  if (!refs.length) return [];
  const ref = mediane(refs.slice(-7)), seuil = ref + 4, plafond = ref + 9;
  const faites = siestesFaites(d), refusees = d.nonSiestes || [];
  const pasHeure = new Map((d.activite || []).map(x => [Math.floor(x.t / H), x.v]));
  const horsNuit = t => !ns.some(n => t >= n.debut - 30 * MIN && t <= n.fin + 45 * MIN);
  const jour = t => { const h = new Date(t).getHours(); return h >= 6 && h < 21; };
  const fc = (d.fc || []).filter(x => x.t > maintenant - jours * JOUR && x.t <= maintenant && jour(x.t) && horsNuit(x.t)).sort((a, b) => a.t - b.t);
  const out = [];
  let i = 0;
  while (i < fc.length) {
    if (fc[i].v > seuil) { i++; continue; }
    let j = i;
    while (j + 1 < fc.length && fc[j + 1].t - fc[j].t <= 10 * MIN && fc[j + 1].v <= plafond) j++;
    const debut = fc[i].t, fin = fc[j].t + 5 * MIN, v = fc.slice(i, j + 1).map(x => x.v);
    const heures = []; for (let h = Math.floor(debut / H); h <= Math.floor((fin - 1) / H); h++) heures.push(pasHeure.get(h) ?? 0);
    const pasMoy = moyenne(heures);
    if (fin - debut >= 20 * MIN && moyenne(v) <= seuil && pasMoy <= 150 && !chevauche(faites, debut, fin)
      && !refusees.some(t => Math.abs(t - debut) < 20 * MIN)) out.push({ debut, fin, moy: Math.round(moyenne(v)) });
    i = j + 1;
  }
  return out;
}

// minutes depuis 18 h, pour moyenner des heures de coucher de part et d'autre de minuit
const depuis18h = t => { const d = new Date(t); return ((d.getHours() + 6) % 24) * 60 + d.getMinutes(); };
export const heureDepuis18h = m => {
  const tot = ((Math.round(m) + 18 * 60) % 1440 + 1440) % 1440;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
};

export function resume(liste, objectifMin, maintenant, jours = 7) {
  const r = liste.filter(n => n.tst && n.fin > maintenant - jours * JOUR);
  if (!r.length) return null;
  const c = r.map(n => depuis18h(n.debut)), l = r.map(n => depuis18h(n.fin));
  const rhr = r.map(n => n.fcNuit?.repos).filter(Number.isFinite);
  const vfc = r.map(n => n.vfcNuit).filter(Number.isFinite);
  return {
    n: r.length,
    tstMoy: moyenne(r.map(n => n.tst)),
    coucher: heureDepuis18h(moyenne(c)), lever: heureDepuis18h(moyenne(l)),
    regCoucher: ecartType(c), regLever: ecartType(l),
    bilan: r.reduce((a, n) => a + n.tst - objectifMin * MIN, 0),
    fcRepos: rhr.length ? Math.round(moyenne(rhr)) : null,
    vfc: vfc.length ? Math.round(moyenne(vfc)) : null,
  };
}

// Verdict du matin : la dernière nuit comparée aux 14 précédentes. Chaque point est expliqué.
export function recuperation(liste, objectifMin, maintenant) {
  const n = liste.at(-1);
  if (!n || !n.tst || maintenant - n.fin > 20 * H) return null;
  const base = liste.slice(-15, -1).filter(x => x.tst);
  const raisons = [];
  let points = 0;
  const obj = objectifMin * MIN, ratio = n.tst / obj;
  if (ratio >= .95) raisons.push({ niveau: 'ok', texte: `${duree(n.tst)} de sommeil, objectif atteint` });
  else if (ratio >= .8) { points += 1; raisons.push({ niveau: 'moyen', texte: `Nuit un peu courte : ${duree(n.tst)} pour ${duree(obj)} visées` }); }
  else { points += 2; raisons.push({ niveau: 'bas', texte: `Nuit courte : ${duree(n.tst)} pour ${duree(obj)} visées` }); }

  if (n.efficacite != null && n.efficacite < .8 && n.lit > 2 * H) {
    points += 1;
    raisons.push({ niveau: 'moyen', texte: `Sommeil agité : endormi ${Math.round(n.efficacite * 100)} % du temps au lit` });
  }

  const rhr = base.map(x => x.fcNuit?.repos).filter(Number.isFinite);
  if (n.fcNuit && rhr.length >= 3) {
    const ref = Math.round(moyenne(rhr)), d = n.fcNuit.repos - ref;
    if (d >= 5) { points += 2; raisons.push({ niveau: 'bas', texte: `FC de repos haute : ${n.fcNuit.repos} bpm, +${d} par rapport à ta moyenne (${ref})` }); }
    else if (d >= 3) { points += 1; raisons.push({ niveau: 'moyen', texte: `FC de repos un peu haute : ${n.fcNuit.repos} bpm, +${d} par rapport à ta moyenne (${ref})` }); }
    else raisons.push({ niveau: 'ok', texte: `FC de repos normale : ${n.fcNuit.repos} bpm (ta moyenne : ${ref})` });
  } else if (n.fcNuit) {
    raisons.push({ niveau: 'info', texte: `FC de repos ${n.fcNuit.repos} bpm. Il faut 3 nuits d'historique pour la comparer.` });
  }

  const vfc = base.map(x => x.vfcNuit).filter(Number.isFinite);
  if (n.vfcNuit && vfc.length >= 3) {
    const ref = Math.round(moyenne(vfc)), p = Math.round((n.vfcNuit - ref) / ref * 100);
    if (p <= -20) { points += 2; raisons.push({ niveau: 'bas', texte: `Variabilité basse : ${n.vfcNuit} ms, ${p} % sous ta moyenne (${ref})` }); }
    else if (p <= -10) { points += 1; raisons.push({ niveau: 'moyen', texte: `Variabilité un peu basse : ${n.vfcNuit} ms, ${p} % sous ta moyenne (${ref})` }); }
    else raisons.push({ niveau: 'ok', texte: `Variabilité normale : ${n.vfcNuit} ms (ta moyenne : ${ref})` });
  }

  const niveau = points >= 4 ? 'bas' : points >= 1 ? 'moyen' : 'ok';
  return { niveau, titre: { ok: 'Bien récupéré', moyen: 'Récupération moyenne', bas: 'Fatigue probable' }[niveau], raisons, nuit: n };
}
