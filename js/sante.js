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
// synchro interrompue n'efface jamais un jour déjà enregistré. Le sommeil, lui, est remplacé nuit par nuit : chaque
// période renvoyée remplace ce qui était noté pendant elle (à 2 h près, comme elles sont regroupées) ; une nuit que le
// bracelet ne renvoie plus (il n'en garde qu'une par jour) reste, et une ancienne nuit redatée (sansCopies) n'en
// remplace jamais une vraie.
export function fusionner(base, imp, maintenant, { parJour = false } = {}) {
  const out = { ...vide(), ...base, exemple: false };
  const temps = x => x.s ?? x.t;
  for (const type of SERIES) {
    let nouv = imp[type] || [];
    if (parJour && type === 'sommeil' && nouv.length) {
      const vraies = new Set(sansCopies([...(base.sommeil || []), ...nouv]));
      nouv = nouv.filter(x => vraies.has(x));
    }
    if (!nouv.length) continue;
    let garder;
    if (parJour && type === 'sommeil') {
      const plages = grappesSommeil({ sommeil: nouv }).map(g => ({ s: g.segs[0].s - 2 * H, e: g.fin + 2 * H }));
      garder = x => !plages.some(p => x.s < p.e && x.e > p.s);
    } else if (parJour) {
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

// Sommeil principal : au moins 30 min qui recouvrent 2 h à 5 h du matin, ou au moins 3 h hors de l'après-midi (le
// bracelet prend parfois un long moment immobile en journée pour du sommeil). Le reste = sieste.
function estNuit(n) {
  const d = n.tst || n.lit;
  if (d < 30 * MIN) return false;
  for (const t of [n.debutLit, n.finLit]) {
    const j = new Date(t), a = new Date(j.getFullYear(), j.getMonth(), j.getDate(), 2).getTime();
    if (n.debutLit < a + 3 * H && n.finLit > a) return true;
  }
  const milieu = new Date((n.debutLit + n.finLit) / 2).getHours();
  return d >= 3 * H && !(milieu >= 12 && milieu < 19);
}

// FC de repos = moyenne du décile le plus bas des mesures prises pendant le sommeil (6 mesures minimum)
export function fcRepos(fc, a, b) {
  const v = fc.filter(x => x.t >= a && x.t <= b).map(x => x.v).sort((x, y) => x - y);
  if (v.length < 6) return null;
  const k = Math.max(3, Math.round(v.length / 10));
  return { repos: Math.round(moyenne(v.slice(0, k))), moy: Math.round(moyenne(v)), min: v[0], max: v.at(-1), n: v.length };
}

function dans(serie, a, b) { return serie.filter(x => x.t >= a && x.t <= b).map(x => x.v); }

// Le bracelet renvoie parfois une ancienne nuit redatée : mêmes phases, même heure, autre jour (vu en octobre : les
// nuits du 11 au 14 revenues 5 à 10 jours plus tard, posées sur de vraies nuits). Une session (suite de phases
// contiguës) dont les phases reprennent, depuis la même heure, celles d'une session plus ancienne d'au moins 4 phases
// (une vraie nuit du bracelet en a une vingtaine : deux nuits pareilles à la minute près n'existent pas) est une
// copie : on garde la plus ancienne. Une nuit d'une seule phase (Santé, réglage du coucher) n'est jamais comparée.
const minutesJour = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
export function sansCopies(segs) {
  const sessions = [];
  for (const x of [...segs].sort((a, b) => a.s - b.s || a.e - b.e)) {
    const c = sessions.find(c => c.at(-1).e === x.s);
    if (c) c.push(x); else sessions.push([x]);
  }
  const phases = c => c.map(x => `${x.k} ${Math.round((x.e - x.s) / MIN)}`);
  const gardees = [];
  for (const c of sessions.sort((a, b) => a[0].s - b[0].s)) {
    const p = phases(c), h = minutesJour(c[0].s), jour = cleJour(c[0].s);
    const copie = gardees.some(g => g.length >= 4 && cleJour(g[0].s) !== jour && minutesJour(g[0].s) === h && p.length <= g.length
      && phases(g).every((x, i) => i >= p.length || x === p[i]));
    if (!copie) gardees.push(c);
  }
  return gardees.flat().sort((a, b) => a.s - b.s);
}

// Segments regroupés en périodes de sommeil (trous de moins de 2 h = même période), sans les copies
function grappesSommeil(d) {
  const segs = sansCopies(d.sommeil || []);
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

// Périodes du bracelet rangées par jour de réveil. Deux périodes qui finissent le même jour ne font une seule nuit que
// si moins de 4 h les séparent (réveillé au milieu de la nuit) ; sinon la plus longue est la nuit, l'autre une sieste.
function periodesBracelet(d) {
  const parJour = new Map(), siestes = [];
  for (const g of grappesSommeil(d)) {
    const n = analyseNuit(g.segs);
    if (!estNuit(n)) { if (n.tst >= 10 * MIN) siestes.push(n); continue; }
    const cle = cleJour(n.fin), prec = parJour.get(cle);
    if (!prec) parJour.set(cle, n);
    else if (n.debutLit - prec.finLit < 4 * H) parJour.set(cle, analyseNuit([...prec.segs, ...g.segs]));
    else { parJour.set(cle, n.tst > prec.tst ? n : prec); siestes.push(n.tst > prec.tst ? prec : n); }
  }
  return { parJour, siestes };
}

/* ---------- Ton pouls, relevé toutes les 5 min ---------- */

const indexDe = (fc, t) => { let a = 0, b = fc.length; while (a < b) { const m = (a + b) >> 1; if (fc[m].t < t) a = m + 1; else b = m; } return a; };
const entre = (fc, a, b) => fc.slice(indexDe(fc, a), indexDe(fc, b));   // fc trié
// le pouls est déjà trié par fusionner : on ne le retrie que s'il ne l'est pas
const trie = (fc = []) => fc.every((x, i) => !i || fc[i - 1].t <= x.t) ? fc : [...fc].sort((a, b) => a.t - b.t);
const centile = (v, q) => { const t = [...v].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(q * t.length))]; };
const CALME = 10;                 // relevé au niveau du sommeil : pouls de sommeil + 10 bpm au plus

// Ton pouls de sommeil : 10e centile de tes relevés des 7 jours précédents. Tu dors un tiers du temps, ce centile tombe
// donc dans tes nuits, sans dépendre de ce que le bracelet appelle sommeil. Il faut environ 2 jours de relevés.
export function poulsDeSommeil(fc, t) {
  const v = entre(fc, t - 7 * JOUR, t).map(x => x.v);
  return v.length >= 600 ? centile(v, .1) : null;
}

// Pendant que le bracelet te dit endormi, ton pouls doit être au niveau du sommeil (60 % des relevés au moins ; 85 à
// 95 % sur tes vraies nuits), ou sinon nettement plus bas que pendant les 6 h d'éveil autour (5 bpm au moins : une nuit
// de fièvre, pouls haut, reste une nuit). Ni l'un ni l'autre : contredite (6 à 23 bpm d'écart sur tes vraies nuits,
// 4 au plus sur les mêmes décalées de 6 h). Pouls sur moins de 40 % de la nuit : on ne confirme pas sur si peu, mais
// un pouls d'éveil net (moins de 30 % au niveau du sommeil, pas plus bas qu'autour) la contredit. Moins de 6 relevés
// (30 min) : verdict null, on ne peut pas juger.
export function controleAuPouls(n, fc, ref, autres = []) {
  if (ref == null || !n.tst) return null;
  const v = n.dort.flatMap(x => entre(fc, x.s, x.e)).map(x => x.v);
  if (v.length < 6) return null;
  const part = v.filter(x => x <= ref + CALME).length / v.length;
  const endormi = x => autres.some(p => p !== n && x.t >= p.debut && x.t < p.fin);
  const autour = [...entre(fc, n.debut - 6 * H, n.debut), ...entre(fc, n.fin, n.fin + 6 * H)].filter(x => !endormi(x)).map(x => x.v);
  const ecart = autour.length >= 12 ? mediane(autour) - mediane(v) : null;
  const contredite = ecart != null && ecart < 5;
  const verdict = v.length >= .4 * n.tst / (5 * MIN)
    ? (part >= .6 || ecart >= 5 ? 'confirmee' : contredite ? 'contredite' : null)
    : (part < .3 && contredite ? 'contredite' : null);
  return { part, ecart, verdict };
}

// Pas par heure (quarts d'heure additionnés), indexés par heure depuis 1970
function pasParHeure(activite = []) {
  const m = new Map();
  for (const x of activite) { const h = Math.floor(x.t / H); m.set(h, (m.get(h) || 0) + x.v); }
  return m;
}
const pasMax = (pasH, a, b) => { let m = 0; for (let h = Math.floor(a / H); h <= Math.floor((b - 1) / H); h++) m = Math.max(m, pasH.get(h) || 0); return m; };

/* ---------- Ta règle : au-dessus de ton seuil d'éveil, tu es éveillé ---------- */
// Donnée par toi le 14/11 : au-dessus de 65 bpm tu es éveillé, en dessous tu dors. Un pic juste au-dessus pendant la
// nuit est un rêve ; plus long, tu t'es réveillé ; le matin, plusieurs pics veulent dire que tu es levé ; la journée,
// longtemps en dessous, c'est peut-être une sieste. Le seuil se règle dans Réglages.
export const SEUIL_EVEIL = 65;
// Tes horaires (14/11) : endormi entre 23 h et 2 h, levé entre 7 h et 10 h. À 1 h près, ce qui finit avant 22 h ne
// commence pas ta nuit (calme du soir) et ce qui commence après 11 h ne la prolonge pas (sieste à proposer).
const SOIR_TOT = 22, MATIN_TARD = 11;

// Relevé par relevé : éveillé si au-dessus du seuil 10 min de suite (2 relevés) ou en plusieurs pics rapprochés (3 au
// moins sur 5 relevés) ; un pic isolé est un rêve, tu dors. Un creux isolé au milieu de l'éveil ne te rendort pas.
export function etatsAuSeuil(fc, seuil = SEUIL_EVEIL) {
  const haut = fc.map(x => x.v > seuil);
  const pres = (i, j) => j >= 0 && j < fc.length && Math.abs(fc[j].t - fc[i].t) <= 10 * MIN;
  const eveil = fc.map((x, i) => haut[i] && ((pres(i, i - 1) && haut[i - 1]) || (pres(i, i + 1) && haut[i + 1])));
  for (let i = 0; i + 4 < fc.length; i++) {
    if (fc[i + 4].t - fc[i].t > 25 * MIN) continue;
    const pics = [0, 1, 2, 3, 4].filter(k => haut[i + k]);
    if (pics.length >= 3) for (const k of pics) eveil[i + k] = true;
  }
  return eveil.map((e, i) => e || (pres(i, i - 1) && pres(i, i + 1) && eveil[i - 1] && eveil[i + 1]));
}

// Blocs de sommeil d'au moins 20 min ; 20 min sans relevé coupent un bloc
function blocsSommeil(fc, seuil) {
  const ev = etatsAuSeuil(fc, seuil), suites = [];
  fc.forEach((x, i) => {
    const p = suites.at(-1);
    if (p && p.dort === !ev[i] && x.t - p.dernier <= 20 * MIN) { p.dernier = x.t; p.e = x.t + 5 * MIN; }
    else suites.push({ dort: !ev[i], s: x.t, e: x.t + 5 * MIN, dernier: x.t });
  });
  return suites.filter(x => x.dort && x.e - x.s >= 20 * MIN).map(({ s, e }) => ({ s, e }));
}

// Ta nuit d'après ta règle, entre 18 h la veille et 14 h :
// - elle part du plus long bloc de sommeil qui passe entre minuit et 7 h ;
// - avant lui, un bloc en fait partie si moins de 30 min d'éveil l'en séparent (sinon c'était du calme du soir) ;
// - après lui : réveil dans la nuit si tu te rendors en moins de 30 min, ou en moins d'1 h pour 1 h au moins ; sinon,
//   ou si tu as marché entre deux (250 pas dans l'heure), tu es levé ;
// - au matin, des bouts de calme de moins de 30 min entre des pics ne prolongent pas la nuit ;
// - rien qui finit avant 22 h ou commence après 11 h (tes horaires, à 1 h près) ;
// - il faut 3 h de sommeil, et 30 min de relevés après ton réveil (une nuit en cours n'est pas comptée).
// Sur tes nuits d'octobre : à 15 min près du bracelet une fois sur deux ; ailleurs ton pouls était au-dessus de 65
// quand le bracelet te disait endormi (ou l'inverse), et c'est ton pouls qui compte.
export function nuitAuSeuil(fc, pasH, cle, seuil = SEUIL_EVEIL) {
  const j = debutJour(cle), brut = entre(fc, j - 6 * H, j + 14 * H);
  if (brut.length < 60) return null;
  const blocs = blocsSommeil(brut, seuil);
  const coeur = blocs.filter(x => x.s < j + 7 * H && x.e > j).sort((x, y) => (y.e - y.s) - (x.e - x.s))[0];
  if (!coeur) return null;
  const marche = (a, b) => pasMax(pasH, a, b) >= 250;
  let i0 = blocs.indexOf(coeur), i1 = i0;
  while (i0 > 0 && blocs[i0].s - blocs[i0 - 1].e <= 30 * MIN && blocs[i0 - 1].e > j - (24 - SOIR_TOT) * H && !marche(blocs[i0 - 1].e, blocs[i0].s)) i0--;
  while (i1 + 1 < blocs.length && blocs[i1 + 1].s < j + MATIN_TARD * H && !marche(blocs[i1].e, blocs[i1 + 1].s)) {
    const trou = blocs[i1 + 1].s - blocs[i1].e, duree = blocs[i1 + 1].e - blocs[i1 + 1].s;
    if (trou <= 30 * MIN || (trou <= H && duree >= H)) i1++; else break;
  }
  while (i1 > i0 && blocs[i1].e - blocs[i1].s < 30 * MIN && blocs[i1].s - blocs[i1 - 1].e >= 10 * MIN) i1--;
  const dort = blocs.slice(i0, i1 + 1);
  if (total(dort) < 3 * H || brut.at(-1).t < dort.at(-1).e + 30 * MIN) return null;
  return { debut: dort[0].s, fin: dort.at(-1).e, dort, eveil: dort.slice(1).map((x, k) => ({ s: dort[k].e, e: x.s })) };
}

const couperAvant = (segs, t) => segs.filter(x => x.e > t).map(x => (x.s < t ? { ...x, s: t } : x));
const lendemain = cle => cleJour(debutJour(cle) + 36 * H);

// Nuits, datées par le jour du réveil. Avec assez de pouls, les heures viennent de ta règle (nuitAuSeuil) : les phases
// du bracelet (profond, paradoxal) sont gardées entre ces heures si sa nuit est la même (la moitié au moins en commun),
// et tes réveils dans la nuit comptent éveillés. Sans nuit au pouls (relevés manquants, ou pouls au-dessus du seuil
// toute la nuit, fièvre par exemple), les heures du bracelet restent, sauf si ton pouls les contredit
// (controleAuPouls) : alors pas de nuit. C'est signalé (source, debutSource, finSource). L'heure de réveil que tu
// corriges toi-même passe avant tout. finProvisoire : nuit arrêtée au moment d'une synchro.
export function nuits(d, { seuil = SEUIL_EVEIL } = {}) {
  const fc = trie(d.fc), pasH = pasParHeure(d.activite);
  const { parJour, siestes } = periodesBracelet(d);
  const periodes = [...parJour.values(), ...siestes];
  const cles = new Set(parJour.keys());
  if (fc.length) for (let k = cleJour(fc[0].t); debutJour(k) <= fc.at(-1).t; k = lendemain(k)) cles.add(k);
  const out = [];
  for (const cle of cles) {
    const brute = parJour.get(cle) ?? null, p = nuitAuSeuil(fc, pasH, cle, seuil);
    if (p) {
      const commun = brute ? Math.min(brute.fin, p.fin) - Math.max(brute.debut, p.debut) : 0;
      const meme = !!brute && commun >= .5 * (brute.fin - brute.debut);
      const phases = meme ? couperA(couperAvant(brute.segs, p.debut), p.fin) : [];
      const n = analyseNuit([...phases, ...p.dort.map(x => ({ ...x, k: 'asleep' })), ...p.eveil.map(x => ({ ...x, k: 'awake' }))]);
      const ecart = (a, b) => (!meme || Math.abs(a - b) > 5 * MIN ? 'pouls' : 'bracelet');
      out.push({ cle, brute, n, source: meme ? 'bracelet' : 'pouls', debutSource: ecart(n.debut, brute?.debut), finSource: ecart(n.fin, brute?.fin),
        controle: { verdict: brute ? (meme ? 'confirmee' : 'contredite') : null } });
      continue;
    }
    if (!brute) continue;
    const controle = controleAuPouls(brute, fc, poulsDeSommeil(fc, brute.fin), periodes);
    if (controle?.verdict === 'contredite') continue;      // pas de nuit au pouls et pouls d'éveil : pas de nuit
    out.push({ cle, brute, n: brute, source: 'bracelet', debutSource: 'bracelet', finSource: 'bracelet', controle });
  }
  return out.map(({ cle, brute, n, source, debutSource, finSource, controle }) => {
    const toi = d.reveils?.[cle], finAuto = n.fin, finAutoSource = finSource;   // avant ta correction
    if (Number.isFinite(toi) && toi > n.debut + H && toi < n.fin + 3 * H) {
      n = analyseNuit(toi < n.finLit ? couperA(n.segs, toi) : prolongerA(n.segs, toi));
      finSource = 'toi';
    }
    const finProvisoire = finSource === 'bracelet' && (d.synchros || []).some(t => t - brute.fin >= -2 * MIN && t - brute.fin <= 10 * MIN);
    const vfc = n.tst ? dans(d.vfc || [], n.debut - H, n.fin + 2 * H) : [];
    const spo2 = n.tst ? dans(d.spo2 || [], n.debut, n.fin) : [];
    return {
      cle, ...n, source, debutSource, finSource, finProvisoire,
      controle: controle?.verdict ?? null, partCalme: controle?.part != null ? Math.round(controle.part * 100) : null,
      debutBracelet: brute?.debut ?? null, finBracelet: brute?.fin ?? null, finAuto, finAutoSource,
      fcNuit: n.tst ? fcRepos(fc, n.debut, n.fin) : null,
      vfcNuit: vfc.length ? Math.round(moyenne(vfc)) : null,
      spo2Nuit: spo2.length ? { moy: Math.round(moyenne(spo2)), min: Math.round(Math.min(...spo2)) } : null,
    };
  }).sort((a, b) => a.fin - b.fin);
}

// Siestes. Le bracelet n'en enregistre pas (une seule période de sommeil par jour) : elles viennent de toi, déclarées
// ou proposées puis confirmées, et du bracelet s'il en note une un jour (sauf si ton pouls le contredit). Elles comptent
// dans ton sommeil de la semaine, sauf celles qui chevauchent une nuit (ns) : elles en font partie, comptées une fois.
const chevauche = (liste, a, b) => liste.some(x => x.debut < b && x.fin > a);
export function siestesFaites(d, ns = []) {
  const faites = (d.siestes || []).map(x => ({ ...x }));
  const fc = trie(d.fc), { parJour, siestes } = periodesBracelet(d), periodes = [...parJour.values(), ...siestes];
  for (const n of siestes) {
    if (chevauche(faites, n.debut, n.fin) || controleAuPouls(n, fc, poulsDeSommeil(fc, n.fin), periodes)?.verdict === 'contredite') continue;
    faites.push({ debut: n.debut, fin: n.fin, source: 'bracelet' });
  }
  return faites.filter(x => !chevauche(ns, x.debut, x.fin)).sort((a, b) => a.debut - b.debut);
}

// Nuit sans mesure : le bracelet a relevé ton pouls la veille et après 6 h, mais presque rien entre 1 h et 6 h du matin
// (moins d'un quart des relevés). Il était retiré, déchargé ou éteint : rien ne dit si tu as dormi, la nuit n'est ni
// comptée ni devinée. (Pas encore synchronisé, ou bracelet pas encore porté : ce n'est pas une nuit muette.)
export function nuitMuette(d, cle, maintenant) {
  const j = debutJour(cle), fc = trie(d.fc);
  return entre(fc, j - 24 * H, j + H).length > 0 && entre(fc, j + 6 * H, maintenant + 1).length > 0
    && entre(fc, j + H, j + 6 * H).length < 15;
}

// Bracelet silencieux : la dernière synchro a eu lieu plus de 3 h après son dernier relevé de pouls (toutes les 5 min
// d'habitude). Renvoie l'heure de ce dernier relevé, ou null.
export function silenceBracelet(d) {
  const derniere = (d.fc || []).reduce((m, x) => Math.max(m, x.t), 0);
  return derniere && d.majBracelet && !d.exemple && d.majBracelet - derniere > 3 * H ? derniere : null;
}

// Siestes probables, à confirmer, jamais comptées seules (ta règle) : en journée, de 45 min après ton réveil jusqu'à
// 21 h, au moins 30 min sous ton seuil d'éveil (un pic isolé n'interrompt pas), presque sans marcher (150 pas par heure
// au plus ; une heure absente = aucun pas, le bracelet ne note que les heures où tu marches). Rester assis au calme
// peut y ressembler : d'où la confirmation.
export function siestesProbables(d, ns, maintenant, jours = 2, seuil = SEUIL_EVEIL) {
  const faites = siestesFaites(d, ns), refusees = d.nonSiestes || [], pasH = pasParHeure(d.activite);
  const horsNuit = t => !ns.some(n => t >= n.debut - 30 * MIN && t <= n.fin + 45 * MIN);
  const jour = t => { const h = new Date(t).getHours(); return h >= 6 && h < 21; };
  const fc = trie(d.fc).filter(x => x.t > maintenant - jours * JOUR && x.t <= maintenant && jour(x.t) && horsNuit(x.t));
  return blocsSommeil(fc, seuil).filter(b => b.e - b.s >= 30 * MIN).flatMap(({ s: debut, e: fin }) => {
    const heures = [];
    for (let h = Math.floor(debut / H); h <= Math.floor((fin - 1) / H); h++) heures.push(pasH.get(h) ?? 0);
    if (moyenne(heures) > 150 || chevauche(faites, debut, fin) || refusees.some(t => Math.abs(t - debut) < 20 * MIN)) return [];
    return [{ debut, fin, moy: Math.round(moyenne(entre(fc, debut, fin).map(x => x.v))) }];
  });
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
