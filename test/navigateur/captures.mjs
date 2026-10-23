// Captures d'écran iPhone (pas un test) : CAPTURES=dossier bash test/navigateur/lancer.sh captures
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
await p.iphone();
await p.aller('/outils/apercu.html#jour', 2500);
const cacherExemple = () => p.js(`document.querySelector('#bandeauExemple').hidden = true`);
await cacherExemple();
await p.photo('onglet-jour');
for (const v of ['detente', 'reveil']) {
  await p.clic(`.onglets [data-vue="${v}"]`); await attendre(400);
  await cacherExemple();
  await p.photo(`onglet-${v}`);
}
await p.clic('.onglets [data-vue="donnees"]'); await attendre(300);
await p.clic('.sous-onglets [data-onglet="coeur"]'); await attendre(300);
await p.clic('[data-zoom="1"]'); await attendre(400);
await cacherExemple();
await p.js(`document.querySelector('.zoom').scrollIntoView({ block: 'start' }); scrollBy(0, -90)`); await attendre(200);
await p.photo('coeur-zoom-1h');
p.fin();
