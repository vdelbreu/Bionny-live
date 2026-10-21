// Captures d'écran iPhone des onglets (pas un test) : CAPTURES=dossier bash test/navigateur/lancer.sh captures
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
await p.iphone();
await p.aller('/outils/apercu.html#jour', 2500);
await p.js(`document.querySelector('#bandeauExemple').hidden = true`);
await p.photo('onglet-jour');
for (const v of ['detente', 'reveil']) {
  await p.clic(`.onglets [data-vue="${v}"]`); await attendre(400);
  await p.js(`document.querySelector('#bandeauExemple').hidden = true`);
  await p.photo(`onglet-${v}`);
}
await p.clic('.onglets [data-vue="detente"]'); await attendre(300);
await p.clic('[data-exo="soupir"]'); await p.clic('#btnCoh'); await attendre(1500);
await p.photo('detente-en-cours');
p.fin();
