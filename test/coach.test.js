import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSommeil, effort, conseilJour, detecter, repondre, heure, SUGGESTIONS, phraseCoeur } from '../js/coach.js';
import { vide, nuits, cleJour, MIN, H } from '../js/sante.js';
import { journees, fiabilite } from '../js/stats.js';

const jour = (j, h = 0, m = 0) => new Date(2026, 9, j, h, m).getTime();
const R = { prenom: '', age: 23, objectif: 480, objectifPas: 8000, reveil: null };

// 7 nuits de 7 h (23 h → 6 h), FC de repos stable, 9 000 pas par jour
function contexte({ heures = 7, reveil = null, fcJour = 75 } = {}) {
  const D = vide();
  for (let j = 8; j <= 14; j++) {
    D.sommeil.push({ s: jour(j - 1, 23), e: jour(j - 1, 23) + heures * H, k: 'core' });
    let i = 0;
    for (let t = jour(j - 1, 23); t < jour(j - 1, 23) + heures * H; t += 5 * MIN) D.fc.push({ t, v: 50 + (i++ % 3) });
    for (let t = jour(j, 8); t < jour(j, 22); t += 5 * MIN) D.fc.push({ t, v: fcJour });
    D.pas[cleJour(jour(j))] = 9000;
  }
  D.fc.sort((a, b) => a.t - b.t);
  const ns = nuits(D), r = { ...R, reveil };
  return { D, R: r, ns, J: journees(D, ns, 200), fiab: fiabilite(D, ns), fcmax: 200, maintenant: jour(14, 12), pasDirect: null };
}

test('planSommeil : dette, rattrapage plafonné à 1 h, coucher calculé depuis le lever, jamais depuis l\'habitude', () => {
  const p = planSommeil(contexte());
  assert.equal(p.dette, 7 * H);                    // 7 nuits à 1 h sous l'objectif
  assert.equal(p.moyenne, 7 * H);
  assert.equal(p.rattrapage, 60 * MIN);             // un quart de la dette, plafonné à 1 h
  assert.equal(p.besoin, 9 * H);
  assert.equal(heure(p.lever), '6 h 00');           // médiane des réveils
  assert.equal(heure(p.coucher), '20 h 45');        // 6 h − 9 h − 15 min : assez de sommeil, même si c'est tôt
  assert.equal(p.avance, 120);                      // 2 h avant l'endormissement habituel (23 h) : on le signale
  assert.equal(p.tard, false);
  const r = planSommeil(contexte({ heures: 8, reveil: '07:30' }));
  assert.equal(r.dette, 0);
  assert.equal(r.source, 'reglage');
  assert.equal(heure(r.coucher), '23 h 15');        // 7 h 30 − 8 h − 15 min
  assert.equal(r.avance, 0);
});

test('planSommeil : le lever suit le jour de la semaine (cours à 8 h ou 9 h 30)', () => {
  const c = contexte({ heures: 8 });                // mercredi 14 à midi : la nuit visée finit jeudi 15
  c.R.leverJours = { 4: '09:00', 5: '07:00' };
  const p = planSommeil(c);
  assert.equal(p.matin.nom, 'jeudi');
  assert.equal(heure(p.coucher), '0 h 45');         // 9 h − 8 h − 15 min
  c.maintenant = jour(15, 12);                      // le lendemain, on vise vendredi
  assert.equal(heure(planSommeil(c).coucher), '22 h 45');
  c.maintenant = jour(16, 2);                       // en pleine nuit, le matin visé est celui du jour même
  assert.equal(planSommeil(c).matin.nom, 'vendredi');
});

test('planSommeil : passé l\'heure, il dit combien de sommeil reste possible', () => {
  const c = contexte({ heures: 8, reveil: '07:00' });
  c.maintenant = jour(14, 23, 30);
  const p = planSommeil(c);
  assert.equal(heure(p.coucher), '22 h 45');
  assert.equal(p.tard, true);
  assert.equal(p.possible, 7 * H + 15 * MIN);       // 23 h 30 → 7 h, moins 15 min pour s'endormir
  assert.match(repondre('coucher', c).lignes[0], /va te coucher maintenant\*\*, tu peux encore dormir 7 h 15/);
});

test('effort : 64 % de la FC max = modéré, 77 % = intense compté double, une séance remplace les relevés', () => {
  const c = contexte();
  const t0 = jour(15, 18);
  c.D.fc = [0, 5, 10, 15, 20, 25].map(m => ({ t: t0 + m * MIN, v: 130 }))
    .concat([30, 35].map(m => ({ t: t0 + m * MIN, v: 160 })), [{ t: t0 + 40 * MIN, v: 60 }]);
  assert.deepEqual(effort(c, t0, t0 + H), { moderes: 30, intenses: 10, total: 50 });
  c.D.seances = [{ debut: t0, fin: t0 + 20 * MIN, effort: { moderes: 20, intenses: 0 } }];
  assert.deepEqual(effort(c, t0, t0 + H), { moderes: 25, intenses: 10, total: 45 });
});

test('detecter : la question libre va vers la bonne réponse', () => {
  assert.equal(detecter('Je dois me coucher à quelle heure ce soir ?'), 'coucher');
  assert.equal(detecter("Combien d'heures je dois dormir ?"), 'coucher');
  assert.equal(detecter('je suis crevé'), 'energie');
  assert.equal(detecter('Est-ce que je dors bien ?'), 'sommeil');
  assert.equal(detecter('je ne dors pas bien'), 'sommeil');
  assert.equal(detecter('je peux aller courir ?'), 'sport');
  assert.equal(detecter("j'ai fait combien de pas aujourd'hui"), 'pas');
  assert.equal(detecter('mon pouls est normal ?'), 'coeur');
  assert.equal(detecter('fais moi un bilan'), 'semaine');
  assert.equal(detecter('bonjour'), 'aide');
});

test('repondre : chaque suggestion donne des phrases complètes, sans valeur manquante', () => {
  for (const c of [contexte(), contexte({ heures: 8, reveil: '07:30', fcJour: 140 })]) {
    for (const [id] of [...SUGGESTIONS, ['pas'], ['oxygene'], ['stress'], ['calories'], ['aide']]) {
      const r = repondre(id, c);
      assert.equal(r.id, id);
      assert.ok(r.lignes.length >= 1, id);
      assert.ok(r.lignes.length <= 3, `${id} : réponse trop longue (${r.lignes.length} lignes)`);
      for (const l of r.lignes) {
        assert.doesNotMatch(l, /undefined|NaN|null|\[object/, `${id} : ${l}`);
        assert.ok(l.length <= 170, `${id} : phrase trop longue : ${l}`);
      }
    }
  }
  const coucher = repondre('coucher', contexte()).lignes;
  assert.match(coucher[0], /au lit vers 20 h 45\*\*, pour te lever à 6 h 00/);
  assert.match(coucher[1], /Vise \*\*9 h 00\*\*, plus que tes 8 h 00 : tes 7 dernières nuits font 7 h 00 en moyenne, il te manque 7 h 00/);
  assert.match(coucher[2], /bien plus tôt que d'habitude/);
  assert.match(repondre('coucher', contexte({ heures: 8, reveil: '07:30' })).lignes[1], /\*\*8 h 00\*\* suffisent/);
});

test('repondre : une question libre incomprise le dit, au lieu de répondre à côté', () => {
  const r = repondre('bonjour', contexte());
  assert.equal(r.id, 'aide');
  assert.match(r.lignes[0], /pas compris/);
  assert.doesNotMatch(repondre('aide', contexte()).lignes[0], /pas compris/);
});

test('conseilJour : après une bonne nuit et peu d\'effort, il propose une vraie séance', () => {
  const c = contexte({ heures: 8 });
  const cj = conseilJour(c);
  assert.equal(cj.niveau, 'ok');
  assert.match(cj.titre, /sport/);
  assert.match(cj.phrase, /Il te manque 150 min/);
  const fatigue = conseilJour(contexte({ heures: 5 }));
  assert.equal(fatigue.niveau, 'moyen');            // nuit très courte : 2 points, sans autre signal
});

test('phraseCoeur : explication selon le cas', () => {
  const r = { moy: 50, bas: 48, haut: 52 };
  assert.match(phraseCoeur(50, r), /Normale/);
  assert.match(phraseCoeur(56, r), /Nettement plus haute/);
  assert.match(phraseCoeur(53, r), /Un peu plus haute/);
  assert.match(phraseCoeur(46, r), /Plus basse/);
  assert.match(phraseCoeur(50, null), /dès 5 nuits/);
});

test('planSommeil : les siestes de la semaine réduisent la dette', () => {
  const c = contexte();                                   // 7 nuits de 7 h : 7 h de dette
  const avant = planSommeil(c).dette;
  c.D.siestes = [{ debut: jour(13, 14), fin: jour(13, 15), source: 'declaree' }, { debut: jour(12, 14), fin: jour(12, 14, 30), source: 'confirmee' }];
  const p = planSommeil(c);
  assert.equal(avant - p.dette, 90 * MIN);
  assert.equal(p.siestes, 90 * MIN);
  assert.match(repondre('coucher', c).lignes[1], /\(\+ 1 h 30 de siestes\)/);
});
