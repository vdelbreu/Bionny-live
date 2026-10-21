// Envoi vers Apple Santé : fausses mesures de pouls, presse-papiers intercepté
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
const { js, ok } = p;
await p.avantPage(`
  if (!localStorage.getItem('bionny-sante')) {
    const t0 = Date.now() - 30 * 3600e3, fc = [];
    for (let t = t0; t < Date.now() - 60e3; t += 5 * 60e3) fc.push({ t, v: 60 + Math.round(10 * Math.sin(t / 3.6e6)) });
    localStorage.setItem('bionny-sante', JSON.stringify({ v: 1, maj: Date.now(), majBracelet: Date.now(), fc }));
  }
  window.__copies = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copies.push(t); } } });`);
await p.aller('/index.html');
await p.clic('.onglets [data-vue="reglages"]'); await attendre(300);
ok('état initial', (await p.texte('#etatSante')) === 'Jamais envoyé.');
await p.clic('#vue-reglages [data-action="sante"]'); await attendre(800);
const lignes = (await js(`window.__copies.at(-1) || ''`)).split('\n');
ok('24 h de pouls, un par quart d’heure, format jj/mm/aaaa hh:mm;bpm',
  lignes.length >= 94 && lignes.length <= 98 && lignes.every(l => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2};\d{2,3}$/.test(l)), `${lignes.length} lignes, ex. ${lignes[0]}`);
ok('page toujours là après le lancement du raccourci', !!(await p.texte('#etatSante')));
ok('état mis à jour', /Pouls envoyé jusqu'au \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/.test(await p.texte('#etatSante')), await p.texte('#etatSante'));
await p.clic('#vue-reglages [data-action="sante"]'); await attendre(500);
ok('2e envoi : rien de nouveau, rien copié', (await js('window.__copies.length')) === 1 && /Rien de nouveau/.test(await p.texte('#toast')), await p.texte('#toast'));
await p.clic('.onglets [data-vue="jour"]'); await attendre(300);
await p.clic('[data-fiche="coeur"]'); await attendre(300);
ok('bouton Santé dans la fiche Cœur', await js(`!!document.querySelector('#ficheCorps [data-action="sante"]')`));
p.fin();
