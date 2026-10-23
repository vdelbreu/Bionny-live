// Bracelet dont les mesures automatiques sont coupées : à la connexion, l'app les rallume (pouls toutes les 5 min,
// oxygène, stress, variabilité), relit pour vérifier, et l'affiche dans Réglages → Bracelet.
import { readFileSync } from 'node:fs';
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
const { js, ok } = p;
await p.avantPage(readFileSync(new URL('./faux-ble.js', import.meta.url), 'utf-8') + `\nwindow.__ble.mesuresCoupees = true;`);
await p.aller('/index.html');
await p.clic('#btnConnect'); await attendre(6000);
const b = await js('JSON.stringify(window.__ble)').then(JSON.parse);
ok('mesures coupées : pouls rallumé toutes les 5 min', b.ecrits.includes('16 02'), b.ecrits.filter(x => /^(16|2c|36|38) /.test(x)).join(' | '));
ok('oxygène, stress et variabilité rallumés', ['2c 02', '36 02', '38 02'].every(x => b.ecrits.includes(x)));
await p.clic('.onglets [data-vue="reglages"]'); await attendre(300);
ok('Réglages : mesures rallumées affichées', /Mesures automatiques rallumées \(pouls, oxygène, stress, variabilité\)\. Mesures automatiques actives, pouls toutes les 5 min/.test(await p.texte('#etatMesures')), await p.texte('#etatMesures'));
const j = await js(`import('./js/connexion.js').then(m => m.journal())`);
ok('journal : avant et après notés', /mesures automatiques : pouls NON/.test(j) && /mesures automatiques rallumées/.test(j));
p.fin();
