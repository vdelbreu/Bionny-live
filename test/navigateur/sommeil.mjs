// Fiche Sommeil : réveil corrigé au pouls puis à la main, sieste proposée puis confirmée, sieste déclarée par-dessus
// (elle remplace l'autre), puis supprimée. Données : dernière matinée à 8 h 10, pouls remonté 10 min avant, creux à 14 h.
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
const { js, ok, texte, clic } = p;
await p.iphone();
await p.avantPage(`
  if (!localStorage.getItem('bionny-sante')) {
    const M = 60e3, H = 60 * M, maintenant = Date.now();
    const ref = new Date(); ref.setHours(8, 10, 0, 0);
    if (ref.getTime() > maintenant - 2 * H) ref.setDate(ref.getDate() - 1);
    const fin = ref.getTime(), debut = fin - 8 * H;
    const quatorze = new Date(ref); quatorze.setHours(14, 0, 0, 0);
    const creux = Math.max(fin + H, Math.min(quatorze.getTime(), Math.floor((maintenant - 75 * M) / (5 * M)) * 5 * M));
    const fc = [];
    for (let t = debut; t < fin; t += 5 * M) fc.push({ t, v: t >= fin - 10 * M ? 78 : 54 });
    for (let t = fin + 5 * M; t < maintenant - 10 * M; t += 5 * M) fc.push({ t, v: t >= creux && t < creux + 45 * M ? 55 : 76 });
    localStorage.setItem('bionny-sante', JSON.stringify({ v: 1, maj: maintenant, majBracelet: maintenant, sommeil: [{ s: debut, e: fin, k: 'core' }], fc }));
  }`);
await p.aller('/index.html');

ok('tuile : sieste à confirmer signalée', /sieste à confirmer/.test(await texte('[data-fiche="sommeil"] .tuile-sous')), await texte('[data-fiche="sommeil"] .tuile-sous'));
await clic('[data-fiche="sommeil"]'); await attendre(300);
ok('fiche : réveil corrigé au pouls', /ton pouls est remonté à 8\sh\s00/.test(await texte('#ficheCorps .note') || ''), await texte('#ficheCorps .note'));
const nuitAvant = await texte('#ficheCorps .tuiles strong');
ok('fiche : sieste proposée', /Sieste de/.test(await texte('.sieste-proposee') || ''), await texte('.sieste-proposee span'));
await p.photo('sommeil-fiche');
await clic('[data-action="sieste-oui"]'); await attendre(300);
ok('confirmée : plus proposée, listée', !(await js(`!!document.querySelector('.sieste-proposee')`)) && /Sieste/.test(await texte('#ficheCorps .liste') || ''));
ok('tuile : sieste comptée', /de sieste/.test(await texte('[data-fiche="sommeil"] .tuile-sous')), await texte('[data-fiche="sommeil"] .tuile-sous'));

await p.saisir('#reveilNuit', '07:30'); await attendre(300);
ok('réveil corrigé par toi', /Corrigé par toi/.test(await texte('#ficheCorps .note') || '') && (await texte('#ficheCorps .tuiles strong')) !== nuitAvant,
  `nuit ${nuitAvant} → ${await texte('#ficheCorps .tuiles strong')}`);
await clic('[data-action="reveil-retablir"]'); await attendre(300);
ok('rétablir : retour au pouls', /ton pouls est remonté/.test(await texte('#ficheCorps .note') || ''));

await js(`document.querySelector('#formSieste').open = true`);
await clic('#formSieste [data-duree="20"]');
await js(`(() => { const d = new Date(Date.now() - 60 * 60e3), i = document.querySelector('#siesteFin'); i.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); })()`);
await clic('[data-action="sieste-ok"]'); await attendre(300);
const n = await js(`document.querySelectorAll('#ficheCorps .liste li').length`);
ok('sieste déclarée par-dessus : remplace la confirmée', n === 1 && /20\smin/.test(await texte('#ficheCorps .liste')) && /remplace/.test(await texte('#toast')),
  `${n} sieste(s) | ${await texte('#toast')}`);
await p.photo('sommeil-siestes');
await clic('[data-supprimer-sieste]'); await attendre(300);
ok('sieste supprimée', (await js(`document.querySelectorAll('#ficheCorps .liste li').length`)) === 0);
ok('heure de coucher toujours calculée', !!(await texte('[data-fiche="coucher"] .tuile-sous')));
p.fin();
