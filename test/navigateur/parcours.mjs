// Parcours complet avec les données d'exemple : tuiles et fiches, Coach, Données, Réglages, démo du direct
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
const { js, ok, texte, clic } = p;
await p.iphone();
await p.aller('/outils/apercu.html#jour', 2500);

// Aujourd'hui : tuiles, puis fiches au toucher
ok('tuile forme', !!(await texte('.tuile.forme .forme-titre')), await texte('.tuile.forme .forme-titre'));
ok('6 tuiles de chiffres', (await js(`document.querySelectorAll('.grille-tuiles .tuile').length`)) === 6);
ok('heure de coucher proposée', /h|Au lit/.test(await texte('[data-fiche="coucher"] .tuile-valeur') || ''), await texte('[data-fiche="coucher"] .tuile-valeur'));
await clic('[data-fiche="coucher"]'); await attendre(300);
ok('fiche coucher ouverte', await js(`document.querySelector('#fiche').open`), await texte('#ficheTitre'));
const avant = (await texte('#ficheCorps .fiche-cle')) + (await texte('[data-fiche="coucher"]'));
await p.saisir('#reveilCarte', '06:30'); await attendre(300);
const apres = (await texte('#ficheCorps .fiche-cle')) + (await texte('[data-fiche="coucher"]'));
ok('lever retenu pour ce jour de la semaine', /Retenu pour tous les/.test(await texte('#toast')), await texte('#toast'));
ok('changer le lever change le coucher, fiche restée ouverte', avant !== apres && await js(`document.querySelector('#fiche').open`));
await clic('[data-fermer]'); await attendre(200);
ok('fiche refermée par la croix', !(await js(`document.querySelector('#fiche').open`)));
const effortAvant = await texte('[data-fiche="effort"] .tuile-valeur');
await clic('[data-fiche="effort"]'); await attendre(300);
await clic('#formSport [data-duree="60"]'); await clic('#formSport [data-intensite="soutenu"]');
await clic('[data-action="sport-ok"]'); await attendre(300);
ok('sport déclaré compté', parseInt(await texte('[data-fiche="effort"] .tuile-valeur')) > parseInt(effortAvant), `${effortAvant} → ${await texte('[data-fiche="effort"] .tuile-valeur')}`);
await js(`document.querySelector('#fiche').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await attendre(200);
ok('toucher le fond referme la fiche', !(await js(`document.querySelector('#fiche').open`)));
for (const id of ['forme', 'sommeil', 'pas', 'coeur', 'oxygene']) {
  await clic(`[data-fiche="${id}"]`); await attendre(150);
  ok(`fiche ${id}`, !!(await texte('#ficheCorps .fiche-cle')), await texte('#ficheTitre'));
  await clic('[data-fermer]'); await attendre(100);
}

// Coach
await clic('.onglets [data-vue="coach"]'); await attendre(400);
ok('coach : message d’accueil', (await js(`document.querySelectorAll('#chat .bulle.coach').length`)) >= 1);
await clic('[data-q="coucher"]'); await attendre(800);
ok('coach : réponse sous la question', /au lit vers|va te coucher maintenant/.test(await texte('#chat .echange .bulle.coach')));
const pos = await js(`(() => { const r = document.querySelector('#chat .echange').getBoundingClientRect(); return [Math.round(r.top), innerHeight]; })()`);
ok('coach : réponse visible à l’écran', pos[0] >= 0 && pos[0] < pos[1] - 120, pos.join(' / '));
await js(`(() => { document.querySelector('#question').value = 'je suis crevé'; document.querySelector('#saisieCoach').requestSubmit(); })()`); await attendre(300);
ok('coach : question libre comprise', !/pas compris/.test(await texte('#chat .echange .bulle.coach')), (await texte('#chat .echange .bulle.coach')).slice(0, 70));
await js(`(() => { document.querySelector('#question').value = 'bonjour'; document.querySelector('#saisieCoach').requestSubmit(); })()`); await attendre(300);
ok('coach : question incomprise signalée', /pas compris/.test(await texte('#chat .echange .bulle.coach')));
await clic('#btnCoh'); await attendre(1500);
ok('respiration guidée', /Inspire|Expire|Retiens/.test(await texte('#orbText')), await texte('#orbText'));
await clic('#btnCoh');

// Données
await clic('.onglets [data-vue="donnees"]'); await attendre(400);
for (const o of ['sommeil', 'activite', 'coeur', 'oxygene']) {
  await clic(`.sous-onglets [data-onglet="${o}"]`); await attendre(300);
  ok(`données ${o}`, (await js(`document.querySelector('.sous-onglets [data-onglet="${o}"]').getAttribute('aria-selected')`)) === 'true' && !!(await js(`document.querySelector('#vue-donnees svg')`)));
}
await clic('.cal-jour:not([disabled]):not(.vide)'); await attendre(300);
ok('clic dans le calendrier', !!(await texte('.jour-nav strong')), await texte('.jour-nav strong'));
await clic('[data-plage="90"]'); await attendre(250);
ok('période 90 jours', (await js(`document.querySelector('[data-plage="90"]').getAttribute('aria-pressed')`)) === 'true');

// Réglages, puis démo du direct
await clic('.onglets [data-vue="reglages"]'); await attendre(300);
const jourVise = await js(`new Date(Date.now() + (new Date().getHours() >= 5 ? 864e5 : 0)).getDay()`);
ok('réglages : lever enregistré pour ce jour de la semaine', (await js(`document.querySelector('#leverJours input[data-jour="${jourVise}"]').value`)) === '06:30');
await clic('#btnDemo'); await attendre(3500);
ok('démo : pouls affiché sur Aujourd’hui', /^\d{2,3}/.test(await texte('#bpm') || ''), await texte('#bpm'));
ok('démo : tracé visible', (await js(`getComputedStyle(document.querySelector('#chart')).display`)) !== 'none');
p.fin();
