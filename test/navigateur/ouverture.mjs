// L'app s'ouvre toujours sur Aujourd'hui, même si l'adresse garde un autre onglet (#reglages…)
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
for (const h of ['#reglages', '#coach', '#donnees', '']) {
  await p.cmd('Page.navigate', { url: 'about:blank' }); await attendre(300);
  await p.aller('/index.html' + h, 1500);
  const vue = await p.js(`[...document.querySelectorAll('section.vue')].find(s => !s.hidden)?.dataset.vue`);
  p.ok(`ouverture avec « ${h || '(rien)'} »`, vue === 'jour', vue);
}
p.fin();
