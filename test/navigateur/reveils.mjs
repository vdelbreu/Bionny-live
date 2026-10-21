// Réveil et rappels : à la connexion, mise à l'heure et lecture des réveils du bracelet (le « Sport » réglé avec l'app
// Bionny devient un rappel), puis réveil vibreur activé, rappel ajouté, vibreur testé, notifications désactivées de base.
import { readFileSync } from 'node:fs';
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
const { js, ok, texte, clic } = p;
const ble = () => js('JSON.stringify(window.__ble)').then(JSON.parse);
const reveilsDuBracelet = () => js(`(() => { const o = JSON.parse(sessionStorage.getItem('faux-reveils') || '[]'); const out = []; let i = 2;
  for (let k = 0; k < (o[1] || 0); k++) { const t = o[i]; out.push([o[i + 1] & 0x80 ? 'actif' : 'inactif', (o[i + 2] | (o[i + 3] << 8)), new TextDecoder().decode(Uint8Array.from(o.slice(i + 4, i + t)))].join(' ')); i += t; }
  return out; })()`);
await p.iphone();
// une nuit et du pouls, pour que l'écran Aujourd'hui ait ses tuiles
await p.avantPage(`if (!localStorage.getItem('bionny-sante')) {
    const H = 3600e3, fin = new Date(new Date().setHours(7, 0, 0, 0)).getTime() - (new Date().getHours() < 8 ? 24 * H : 0), fc = [];
    for (let t = fin - 8 * H; t < fin; t += 3e5) fc.push({ t, v: 55 });
    localStorage.setItem('bionny-sante', JSON.stringify({ v: 1, maj: Date.now(), majBracelet: Date.now(), sommeil: [{ s: fin - 8 * H, e: fin, k: 'core' }], fc }));
  }` + readFileSync(new URL('./faux-ble.js', import.meta.url), 'utf-8') + `
  if (!localStorage.getItem('bionny-reglages')) localStorage.setItem('bionny-reglages', JSON.stringify({ leverJours: { 1: '07:20', 2: '07:20', 3: '08:00', 4: '07:20', 5: '09:30' } }));`);
await p.aller('/index.html');

await clic('#btnConnect'); await attendre(5000);
let b = await ble();
ok('connexion : bracelet remis à l’heure', b.ecrits.includes('01 ' + (await js(`(new Date().getFullYear() % 100).toString().padStart(2, '0')`))), b.ecrits.join(' | '));
ok('connexion : réveils lus', b.ecrits.includes('bc 2c'));
await clic('.onglets [data-vue="reglages"]'); await attendre(400);
ok('réveil « Sport » de l’app Bionny gardé comme rappel', (await js(`document.querySelector('#listeRappels [data-champ="nom"]')?.value`)) === 'Sport');
ok('rien réécrit tant que rien ne change', b.ecrits.filter(x => x === 'bc 2c').length === 1 && /À jour/.test(await texte('#etatReveils')), await texte('#etatReveils'));
ok('notifications désactivées de base', !(await js(`document.querySelector('#vibNotifs').checked`)) && await js(`document.querySelector('#aideNotifs').hidden`));

await js(`(() => { const i = document.querySelector('#vibReveil'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await attendre(4000);
let liste = await reveilsDuBracelet();
ok('réveil vibreur : une alarme par heure de lever, écrite et vérifiée', liste.length === 4 && liste.filter(x => / Reveil$/.test(x)).length === 3 && /Enregistré dans le bracelet/.test(await texte('#etatReveils')),
  `${liste.join(' / ')} | ${await texte('#etatReveils')}`);
ok('résumé des heures de lever', /7\sh\s20 lun, mar, jeu/.test(await texte('#resumeLevers')), await texte('#resumeLevers'));

await clic('[data-action="rappel-ajouter"]'); await attendre(200);
await p.saisir('#listeRappels [data-rappel="1"] [data-champ="nom"]', 'Médicament');
await p.saisir('#listeRappels [data-rappel="1"] [data-champ="heure"]', '21:00');
await clic('#listeRappels [data-rappel="1"] [data-jour-rappel="0"]');
await attendre(4000);
liste = await reveilsDuBracelet();
ok('rappel ajouté, nommé et daté, envoyé au bracelet', liste.some(x => x === `actif ${21 * 60} Médicament`), liste.join(' / '));
ok('dimanche ajouté aux jours du rappel', (await js(`document.querySelector('#listeRappels [data-rappel="1"] [data-jour-rappel="0"]').getAttribute('aria-pressed')`)) === 'true');

await clic('[data-action="vibrer"]'); await attendre(600);
ok('tester le vibreur', (await ble()).ecrits.includes('50 55') && /vibrer/.test(await texte('#toast')), await texte('#toast'));
await js(`(() => { const i = document.querySelector('#vibNotifs'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await attendre(200);
ok('notifications : explication et marche à suivre affichées', !(await js(`document.querySelector('#aideNotifs').hidden`)));
await js(`document.querySelector('#carteReveils').scrollIntoView()`); await attendre(200);
await p.photo('reveils');
await js(`document.querySelector('#leverJours').scrollIntoView()`); await attendre(200);
await p.photo('levers');

await clic('.onglets [data-vue="jour"]'); await attendre(300);
await clic('[data-fiche="coucher"]'); await attendre(300);
ok('fiche coucher : le bracelet vibrera à l’heure de lever', /Le bracelet vibrera à|Réveil vibreur désactivé/.test(await texte('#ficheCorps')), (await texte('#ficheCorps')).match(/Le bracelet vibrera[^.]*\.|Réveil vibreur désactivé\./)?.[0]);
p.fin();
