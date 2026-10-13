// Coach : transforme tes données en conseils courts et concrets. Aucune invention : chaque phrase s'appuie sur une
// mesure du bracelet ou une règle reconnue (OMS : 150 min d'effort par semaine ; ACSM : effort modéré dès 64 % de la
// FC max, intense dès 77 %), et dit quand les données manquent. Pur, testé dans test/coach.test.js.
import { duree, cleJour, debutJour, moyenne, ecartType, recuperation, norm, MIN, JOUR } from './sante.js';
import { repere, joursPasses, decalerJour, comparerSemaines } from './stats.js';

export const OBJECTIF_EFFORT = 150;     // minutes par semaine (OMS)
const LATENCE = 15;                      // minutes pour s'endormir, valeur habituelle

/* ---------- Outils ---------- */

const minutesDuJour = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const depuis18h = t => (minutesDuJour(t) + 6 * 60) % 1440;
const mediane = v => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
export const heure = m => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')}`; };
export const minutesHHMM = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const nf = n => Math.round(n).toLocaleString('fr-FR');
const nuits7 = c => c.ns.filter(n => n.tst && n.fin > c.maintenant - 7 * JOUR);

/* ---------- Sommeil : besoin de ce soir et heure de coucher ---------- */

// Besoin = ton objectif + un quart de la dette des 7 dernières nuits (au plus 1 h : on ne rattrape pas tout d'un coup).
// Heure de lever = ton réglage, sinon la médiane de tes 7 derniers réveils. Coucher idéal = lever − besoin − 15 min.
// Avancer son coucher d'un coup marche rarement : si l'idéal est à plus de 30 min avant ton heure habituelle,
// l'objectif de ce soir est ton heure habituelle − 30 min, et on avance encore les soirs suivants.
const AVANCE_MAX = 30;
const vers18h = m => ((m - 18 * 60) % 1440 + 1440) % 1440;
export function planSommeil(c) {
  const obj = c.R.objectif * MIN, nuits = nuits7(c);
  const dette = Math.max(0, nuits.reduce((a, n) => a + obj - n.tst, 0));
  const rattrapage = Math.min(60, Math.round(dette / MIN / 4 / 5) * 5) * MIN;
  const besoin = obj + rattrapage;
  const levers = nuits.map(n => minutesDuJour(n.fin));
  const habituel = levers.length ? Math.round(mediane(levers) / 5) * 5 : null;
  const lever = c.R.reveil ? minutesHHMM(c.R.reveil) : habituel;
  const base = { besoin, dette, rattrapage, lever, habituel, nuits: nuits.length, source: c.R.reveil ? 'reglage' : 'habitude' };
  if (lever == null) return { ...base, coucher: null, ideal: null, progressif: false };
  const ideal = lever - besoin / MIN - LATENCE;
  // heure de coucher habituelle : médiane des endormissements − 15 min, en minutes depuis 18 h (passage de minuit)
  const couchers = nuits.map(n => vers18h(minutesDuJour(n.debut) - LATENCE));
  if (!couchers.length) return { ...base, coucher: ideal, ideal, progressif: false };
  const habitude18 = mediane(couchers), ideal18 = vers18h(ideal);
  const progressif = ideal18 < habitude18 - AVANCE_MAX;
  const coucher18 = progressif ? Math.round((habitude18 - AVANCE_MAX) / 5) * 5 : ideal18;
  return { ...base, ideal, coucher: coucher18 + 18 * 60, coucherHabituel: habitude18 + 18 * 60, progressif };
}

/* ---------- Effort : minutes au sens de l'OMS ---------- */

// Relevés automatiques : chaque relevé vaut jusqu'au suivant (10 min au plus). Les séances de sport que tu déclares
// (le bracelet n'est pas porté au sport) s'ajoutent ; pendant leur durée, on ignore les relevés pour ne pas compter
// deux fois. L'effort intense compte double (OMS).
export function effort(c, debut, fin) {
  const seances = (c.D.seances || []).filter(s => s.fin > debut && s.debut < fin);
  const dansSeance = t => seances.some(s => t >= s.debut && t <= s.fin);
  const fc = c.D.fc.filter(x => x.t >= debut && x.t < fin && !dansSeance(x.t));
  let moderes = 0, intenses = 0;
  for (let i = 0; i < fc.length; i++) {
    const dt = Math.min((fc[i + 1]?.t ?? fc[i].t + 5 * MIN) - fc[i].t, 10 * MIN) / MIN;
    const p = fc[i].v / c.fcmax;
    if (p >= .77) intenses += dt; else if (p >= .64) moderes += dt;
  }
  for (const s of seances) { moderes += s.effort?.moderes ?? 0; intenses += s.effort?.intenses ?? 0; }
  return { moderes: Math.round(moderes), intenses: Math.round(intenses), total: Math.round(moderes + 2 * intenses) };
}
export const effortSemaine = c => effort(c, debutJour(decalerJour(cleJour(c.maintenant), -6)), c.maintenant);
export const seuilsEffort = fcmax => ({ modere: Math.round(.64 * fcmax), intense: Math.round(.77 * fcmax) });

/* ---------- Conseil du jour ---------- */

export function conseilJour(c) {
  const rec = recuperation(c.ns, c.R.objectif, c.maintenant);
  const reste = Math.max(0, OBJECTIF_EFFORT - effortSemaine(c).total);
  if (!rec) return { niveau: 'info', titre: 'Synchronise après ta nuit', phrase: "Sans ta dernière nuit, je ne peux pas juger ta récupération. Synchronise le bracelet le matin.", rec };
  if (rec.niveau === 'bas') return { niveau: 'bas', titre: 'Journée calme', phrase: 'Ton corps récupère mal : marche tranquille et étirements, pas de séance intense aujourd\'hui.', rec };
  if (rec.niveau === 'moyen') {
    return { niveau: 'moyen', titre: 'Effort modéré', rec,
      phrase: reste ? `Une séance facile de 30 à 40 min (footing lent, vélo, natation) : il te manque ${reste} min d'effort cette semaine.` : 'Ton compte d\'effort de la semaine est fait : marche ou séance légère.' };
  }
  return { niveau: 'ok', rec, titre: reste ? 'Bonne journée pour du sport' : 'En forme',
    phrase: reste ? `Tu as bien récupéré : c'est le moment d'une vraie séance (course, foot, vélo, salle). Il te manque ${reste} min cette semaine.`
      : 'Objectif d\'effort de la semaine atteint : séance au choix ou repos actif.' };
}

/* ---------- Ta semaine ---------- */

export function semaine(c) {
  const nuits = nuits7(c), couchers = nuits.map(n => depuis18h(n.debut));
  // décalage du week-end : lever moyen samedi et dimanche face aux autres jours
  const levers = j => nuits.filter(n => j(new Date(n.fin).getDay())).map(n => minutesDuJour(n.fin));
  const we = levers(d => d === 0 || d === 6), sem = levers(d => d > 0 && d < 6);
  return {
    nuits: nuits.length,
    tst: nuits.length ? moyenne(nuits.map(n => n.tst)) : null,
    coucher: couchers.length ? moyenne(couchers) - 6 * 60 : null,
    regularite: couchers.length >= 3 ? ecartType(couchers) : null,
    decalageWeekend: we.length && sem.length ? moyenne(we) - moyenne(sem) : null,
    rhr: comparerSemaines(c.J, c.maintenant, j => j.rhr),
    pas: comparerSemaines(c.J, c.maintenant, j => j.pas, true),
    effort: effortSemaine(c),
  };
}

/* ---------- Phrases d'explication selon le cas ---------- */

export function phraseCoeur(v, r) {
  if (v == null) return 'Pas de mesure cette nuit.';
  if (!r) return 'Je la comparerai à ta normale dès 5 nuits mesurées.';
  if (v >= r.moy + 5) return 'Nettement plus haute que d\'habitude : manque de sommeil, alcool, stress ou rhume qui arrive. Lève le pied.';
  if (v > r.haut) return 'Un peu plus haute que d\'habitude : surveille ton sommeil ces prochains jours.';
  if (v < r.bas) return 'Plus basse que d\'habitude : bon signe de récupération.';
  return 'Normale pour toi. Basse et stable, c\'est le signe d\'un cœur en forme.';
}

// comparée à ton objectif (le rattrapage de dette ne compte que pour l'heure de coucher)
export function phraseSommeil(n, plan) {
  if (!n) return 'Pas de nuit enregistrée : garde le bracelet la nuit et synchronise le matin.';
  const ecart = n.tst - (plan.besoin - plan.rattrapage);
  if (ecart >= -15 * MIN) return 'Nuit complète : tu as atteint ton objectif.';
  if (ecart >= -60 * MIN) return 'Un peu court : la concentration baisse souvent en fin de journée.';
  return 'Nuit courte : ta concentration et ton humeur en pâtissent. Couche-toi plus tôt ce soir.';
}

export function phrasePas(pas, objectif, enCours) {
  if (pas == null) return 'Pas encore de pas reçus aujourd\'hui.';
  if (pas >= objectif) return 'Objectif atteint, bravo.';
  if (!enCours) return `${nf(objectif - pas)} pas sous ton objectif.`;
  const h = new Date().getHours();
  return h >= 17 ? `Encore ${nf(objectif - pas)} pas : une marche de ${Math.ceil((objectif - pas) / 100)} min suffit.` : 'Journée en cours : 10 min de marche après le déjeuner aident beaucoup.';
}

/* ---------- Questions au coach ---------- */

export const SUGGESTIONS = [
  ['jour', "Je fais quoi aujourd'hui ?"],
  ['coucher', 'À quelle heure me coucher ?'],
  ['sport', 'Je fais du sport ?'],
  ['energie', 'Pourquoi je suis fatigué ?'],
  ['sommeil', 'Comment je dors ?'],
  ['coeur', 'Mon cœur va bien ?'],
  ['semaine', 'Ma semaine'],
  ['mieuxDormir', 'Comment mieux dormir ?'],
];

const REGLES = [
  ['coucher', /(coucher|ce soir|quelle heure|reveil|lever|combien d.?heures)/],
  ['mieuxDormir', /(mieux dormir|astuce|m.?endormir|insomni|conseil.*(dorm|sommeil))/],
  ['energie', /(fatigu|creve|energie|epuis|pas en forme|coup de barre)/],
  ['sport', /(sport|entrain|courir|course|muscu|seance|cardio|bouger|velo|foot|salle|effort)/],
  ['sommeil', /(dormi|dors|dormir|sommeil|nuit|profond|paradoxal|reve)/],
  ['coeur', /(coeur|\bfc\b|pouls|cardiaque|bpm|tension)/],
  ['pas', /(\bpas\b.*(jour|aujourd|fait|combien)|nombre de pas|marche|\bkm\b|distance)/],
  ['semaine', /(semaine|bilan|global|resume|tendance|mois|progres|evolution)/],
  ['oxygene', /(oxygen|spo2|saturation|respir)/],
  ['stress', /(stress|variabilit|hrv|vfc)/],
  ['calories', /(calorie|kcal|manger|poids|maigrir)/],
  ['jour', /(aujourd|quoi faire|programme|journee)/],
];
export function detecter(texte) {
  const t = norm(texte).replace(/['’]/g, ' ');
  return REGLES.find(([, r]) => r.test(t))?.[0] ?? 'aide';
}

const derniereNuit = c => { const n = c.ns.filter(x => x.tst).at(-1); return n && c.maintenant - n.fin < 20 * 3600e3 ? n : null; };
const NIVEAU = { ok: 'bonne', moyen: 'moyenne', bas: 'faible' };
const phraseCoucher = p => p.progressif
  ? `**au lit vers ${heure(p.coucher)}** (30 min plus tôt que d'habitude), puis un peu plus tôt chaque soir jusqu'à ${heure(p.ideal)}`
  : `**au lit vers ${heure(p.coucher)}**`;
const pourcent = (a, b) => Math.round(a / b * 100);

const REPONSES = {
  jour(c) {
    const cj = conseilJour(c), plan = planSommeil(c), n = derniereNuit(c);
    return [
      n ? `Cette nuit : **${duree(n.tst)}** de sommeil, récupération **${NIVEAU[cj.rec?.niveau] ?? 'non calculée'}**.` : "Je n'ai pas encore ta dernière nuit : synchronise le bracelet.",
      `Aujourd'hui : **${cj.titre.toLowerCase()}**. ${cj.phrase}`,
      plan.coucher != null ? `Ce soir : ${phraseCoucher(plan)}, pour te lever à ${heure(plan.lever)}.` : '',
    ];
  },

  coucher(c) {
    const p = planSommeil(c), s = semaine(c);
    if (p.coucher == null) return ["Il me faut au moins une nuit, ou ton heure de lever dans Réglages, pour calculer ton heure de coucher."];
    return [
      `Pour te lever à **${heure(p.lever)}**${p.source === 'habitude' ? ' (ton heure habituelle)' : ''} : ${phraseCoucher(p)}.`,
      p.progressif ? `L'idéal, ${heure(p.ideal)}, est loin de ton heure habituelle (${heure(p.coucherHabituel)}) : changer d'un coup marche rarement, ton corps s'adapte de 15 à 30 min à la fois.` : '',
      p.rattrapage ? `Ton besoin ce soir : ${duree(p.besoin)}, soit ton objectif de ${duree(c.R.objectif * MIN)} plus ${duree(p.rattrapage)} pour rattraper ta dette de la semaine (${duree(p.dette)}).`
        : `Ton besoin ce soir : ${duree(p.besoin)}, ton objectif. Pas de dette à rattraper cette semaine.`,
      s.decalageWeekend != null && s.decalageWeekend > 90 ? `Le week-end, tu te lèves ${duree(Math.round(s.decalageWeekend / 5) * 5 * MIN)} plus tard qu'en semaine : ce décalage rend le lundi difficile. Essaie de rester à moins d'une heure.`
        : s.regularite != null && s.regularite > 45 ? `Tes heures d'endormissement varient beaucoup (± ${Math.round(s.regularite)} min) : une heure fixe aide à s'endormir plus vite.` : '',
      p.source === 'habitude' ? 'Tu peux régler ton heure de lever dans Réglages.' : '',
    ];
  },

  sommeil(c) {
    const n = derniereNuit(c), s = semaine(c), obj = c.R.objectif * MIN;
    if (!s.nuits) return ['Aucune nuit ces 7 derniers jours : garde le bracelet la nuit et synchronise le matin.'];
    const lignes = [];
    if (n) lignes.push(`Cette nuit : **${duree(n.tst)}** (${heure(minutesDuJour(n.debut))} → ${heure(minutesDuJour(n.fin))}), ${pourcent(n.tst, obj)} % de ton objectif.`);
    lignes.push(`Sur ${s.nuits} nuits : **${duree(s.tst)}** en moyenne, endormi vers ${heure(s.coucher)}${s.regularite != null ? ` (± ${Math.round(s.regularite)} min)` : ''}.`);
    if (n?.aDesStades) lignes.push(`Sommeil profond ${duree(n.stades.deep)}, paradoxal ${duree(n.stades.rem)}. Le profond répare le corps, le paradoxal (les rêves) trie la mémoire et les émotions.`);
    if (s.tst < obj - 30 * MIN) lignes.push('Tu dors moins que ton objectif : le plus simple est d\'avancer ton coucher de 30 min.');
    else if (s.regularite > 45) lignes.push('Tes horaires bougent beaucoup : vise la même heure de coucher chaque soir.');
    else lignes.push('Bon rythme, continue comme ça.');
    return lignes;
  },

  sport(c) {
    const cj = conseilJour(c), e = effortSemaine(c), sl = seuilsEffort(c.fcmax), s = semaine(c);
    const lignes = [`**${cj.titre}**. ${cj.phrase}`,
      `Cette semaine : **${e.total} min d'effort** sur les ${OBJECTIF_EFFORT} conseillées par l'OMS (cœur au-dessus de ${sl.modere} bpm, et l'intense au-dessus de ${sl.intense} bpm compte double).`];
    if (e.total < 30 && s.pas.cette?.moy > 7000) lignes.push(`Tu marches beaucoup (${nf(s.pas.cette.moy)} pas par jour) mais ton cœur monte rarement : 2 ou 3 séances de cardio par semaine feraient la différence.`);
    if (e.total < OBJECTIF_EFFORT) lignes.push('Tu ne portes pas le bracelet au sport : ajoute tes séances avec « J\'ai fait du sport » (carte Activité) pour qu\'elles comptent.');
    return lignes;
  },

  energie(c) {
    const s = semaine(c), p = planSommeil(c), cj = conseilJour(c), e = effortSemaine(c);
    const causes = [];
    if (p.dette >= 60 * MIN) causes.push(`Tu as **${duree(p.dette)} de sommeil en retard** sur 7 nuits.`);
    if (s.coucher != null && s.coucher > 30 && s.coucher < 6 * 60) causes.push(`Tu t'endors tard (vers ${heure(s.coucher)}) : la fin de nuit est souvent écourtée par le réveil.`);
    if (s.regularite > 45) causes.push(`Tes horaires varient de ± ${Math.round(s.regularite)} min : ton horloge interne se dérègle.`);
    if (s.decalageWeekend > 90) causes.push(`Tu te lèves ${duree(Math.round(s.decalageWeekend / 5) * 5 * MIN)} plus tard le week-end : c'est un petit décalage horaire chaque semaine.`);
    if (cj.rec?.raisons.some(r => /FC de repos/.test(r.texte) && r.niveau !== 'ok')) causes.push('Ta FC de repos est au-dessus de ta normale : fatigue accumulée, stress, alcool ou début de maladie.');
    if (e.total < 30) causes.push('Très peu d\'effort cardio cette semaine : bouger régulièrement donne plus d\'énergie, pas moins.');
    if (!causes.length) return ['Tes données ne montrent rien d\'anormal : sommeil, rythme et cœur sont bons.', "Regarde du côté de l'alimentation, de l'eau et de ta charge de travail. Si la fatigue dure plus de 2 semaines, parles-en à un médecin."];
    return ['D\'après tes données, les causes les plus probables :', ...causes.slice(0, 3), 'Commence par la première : c\'est là que tu gagneras le plus.'];
  },

  coeur(c) {
    const n = derniereNuit(c), auj = cleJour(c.maintenant);
    const r = repere(c.J, decalerJour(auj, n ? 0 : 1), j => j.rhr);
    const v = n?.fcNuit?.repos ?? [...c.J.values()].reverse().find(j => j.rhr != null)?.rhr ?? null;
    if (v == null) return ['Pas encore de FC de repos : il faut une nuit mesurée.'];
    const lignes = [`FC de repos : **${v} bpm**${r ? ` (ta normale : ${Math.round(r.bas)} à ${Math.round(r.haut)})` : ''}. ${phraseCoeur(v, r)}`,
      'Chez un adulte, 50 à 70 bpm au repos est courant ; plus bas veut souvent dire un cœur entraîné.'];
    // tendance sur 30 jours : moyenne des 10 premiers jours face aux 10 derniers
    const serie = joursPasses(30, c.maintenant).map(k => c.J.get(k)?.rhr).filter(Number.isFinite);
    if (serie.length >= 14) {
      const d = moyenne(serie.slice(-7)) - moyenne(serie.slice(0, 7));
      if (d <= -2) lignes.push(`Elle a baissé de ${Math.round(-d)} bpm en un mois : ta forme progresse.`);
      else if (d >= 3) lignes.push(`Elle a monté de ${Math.round(d)} bpm en un mois : plus de sommeil et moins d'alcool aident à la faire redescendre.`);
      else lignes.push('Elle est stable sur le mois.');
    }
    if (v >= (r?.moy ?? 999) + 10) lignes.push('Si elle reste aussi haute plusieurs jours ou si tu te sens mal, parles-en à un médecin.');
    return lignes;
  },

  pas(c) {
    const auj = cleJour(c.maintenant), j = c.J.get(auj), s = semaine(c);
    const pas = Math.max(j?.pas ?? 0, c.pasDirect?.cle === auj ? c.pasDirect.pas : 0);
    return [`Aujourd'hui : **${nf(pas)} pas** pour un objectif de ${nf(c.R.objectifPas)}. ${phrasePas(pas, c.R.objectifPas, true)}`,
      s.pas.cette ? `Moyenne des 7 derniers jours : ${nf(s.pas.cette.moy)} pas par jour.` : '',
      'Marcher compte pour ta santé, mais pour le cœur, il faut aussi des moments où il accélère vraiment.'];
  },

  semaine(c) {
    const s = semaine(c), p = planSommeil(c);
    const d = s.rhr.ecart;
    return [
      s.nuits ? `Sommeil : **${duree(s.tst)}** par nuit en moyenne, endormi vers ${heure(s.coucher)}${s.regularite != null ? ` (± ${Math.round(s.regularite)} min)` : ''}. Dette : ${duree(p.dette)}.` : 'Sommeil : pas de nuit cette semaine.',
      s.rhr.cette ? `Cœur au repos : **${Math.round(s.rhr.cette.moy)} bpm**${d != null ? `, ${Math.abs(d) < 1 ? 'stable' : d > 0 ? `+${Math.round(d)} par rapport à la semaine d'avant` : `${Math.round(d)} par rapport à la semaine d'avant`}` : ''}.` : '',
      s.pas.cette ? `Activité : **${nf(s.pas.cette.moy)} pas** par jour, **${s.effort.total} min d'effort** sur ${OBJECTIF_EFFORT}.` : `Effort : ${s.effort.total} min sur ${OBJECTIF_EFFORT}.`,
      s.effort.total < OBJECTIF_EFFORT / 2 ? 'Ta priorité cette semaine : 2 ou 3 séances où ton cœur monte vraiment.'
        : s.tst != null && s.tst < c.R.objectif * MIN - 30 * MIN ? 'Ta priorité cette semaine : dormir plus, en avançant ton coucher.' : 'Belle semaine, garde ce rythme.',
    ];
  },

  mieuxDormir(c) {
    const s = semaine(c), conseils = [];
    if (s.regularite > 45 || s.decalageWeekend > 90) conseils.push('**Même heure de coucher et de lever**, week-end compris : c\'est le conseil le plus efficace pour toi d\'après tes données.');
    const p = planSommeil(c);
    if (p.progressif) conseils.push(`**Avance ton coucher** de 15 à 30 min tous les 2 ou 3 soirs, jusqu'à ${heure(p.ideal)}.`);
    conseils.push('**Lumière du jour le matin**, écrans en mode nuit le soir.', '**Pas de café après 14 h**, et une chambre fraîche (18 °C) et sombre.');
    return [...conseils.slice(0, 3), 'Les conseils en gras viennent d\'abord de tes données, puis des recommandations classiques sur le sommeil.'];
  },

  oxygene(c) {
    const v = [...c.J.values()].filter(j => j.nuit?.spo2Nuit).slice(-7);
    if (!v.length) return ["Pas encore de mesure d'oxygène la nuit."];
    const moy = Math.round(moyenne(v.map(j => j.nuit.spo2Nuit.moy))), min = Math.min(...v.map(j => j.nuit.spo2Nuit.min));
    return [`Oxygène la nuit : **${moy} %** en moyenne, minimum ${min} % (${v.length} nuit${v.length > 1 ? 's' : ''}).`,
      moy >= 95 ? 'Normal : entre 95 et 100 %, ton sang transporte bien l\'oxygène.' : 'Un peu bas. Au poignet la mesure est imprécise ; si ça se répète, parles-en à un médecin.'];
  },

  stress(c) {
    return [
      c.fiab.stress.fiable ? 'Ton indice de stress est affiché dans Données.' : 'Le bracelet donne un « stress », mais il ne réagit pas comme un vrai : il est plus haut quand tu dors. Je ne l\'utilise pas pour ne pas te tromper.',
      c.fiab.vfc.fiable ? 'Ta variabilité cardiaque est affichée dans Données.' : 'Même chose pour la « variabilité » : ses valeurs restent entre 30 et 50 quoi qu\'il arrive. Ta FC de repos est un bien meilleur indicateur de fatigue.',
    ];
  },

  calories() {
    return ['Je n\'affiche pas les calories : le bracelet ne précise pas leur unité, et je préfère ne rien montrer plutôt qu\'un chiffre faux.',
      'Pour ta forme, regarde plutôt ton sommeil, tes minutes d\'effort et ta FC de repos.'];
  },

  aide() {
    return ['Je réponds à partir de tes données : sommeil, heure de coucher, sport, fatigue, cœur, pas, ta semaine.', 'Choisis une question ci-dessous ou écris la tienne simplement.'];
  },
};

// Réponse en lignes de texte (**gras** autorisé). question = identifiant de suggestion ou texte libre.
export function repondre(question, c) {
  const id = REPONSES[question] ? question : detecter(question);
  return { id, lignes: REPONSES[id](c).filter(Boolean) };
}

// Séance de sport déclarée : soutenu (souffle court) compte comme intense, tranquille comme modéré
export function seanceDeclaree(fin, minutes, intensite) {
  const m = Math.max(5, Math.min(300, Math.round(minutes)));
  return { debut: fin - m * MIN, fin, declare: true, intensite,
    effort: intensite === 'soutenu' ? { moderes: 0, intenses: m } : { moderes: m, intenses: 0 } };
}
