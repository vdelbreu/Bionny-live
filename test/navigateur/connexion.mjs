// Connexion avec le faux bracelet : la liste seulement la 1re fois, reconnexion directe ensuite, bracelet libéré en
// quittant l'app, pause de la reconnexion automatique quand elle échoue toujours, liste complète sur iPhone.
import { readFileSync } from 'node:fs';
import { ouvrirChrome, attendre } from './cdp.mjs';

const p = await ouvrirChrome();
const { js, cmd, ok } = p;
const ble = () => js('JSON.stringify(window.__ble)').then(JSON.parse);
const puce = () => p.texte('#connText');
const visibilite = async v => { await js(`(() => { window.__ble.vis = '${v}'; document.dispatchEvent(new Event('visibilitychange')); })()`); await attendre(800); };
const etat = async () => `${await puce()} ${JSON.stringify(await ble())}`;

await p.avantPage(readFileSync(new URL('./faux-ble.js', import.meta.url), 'utf-8'));
await p.aller('/index.html#jour');

let b = await ble();
ok('1er lancement : pas de connexion auto sans autorisation', b.connexions === 0, await etat());
await p.clic('#btnConnect'); await attendre(1500);
b = await ble();
ok('1er lancement : Connecter ouvre la liste une fois', b.requestDevice === 1 && b.connexions === 1, await etat());

await visibilite('hidden');
b = await ble();
ok('app quittée : bracelet libéré', b.deconnexions === 1 && !(await puce()).startsWith('Connecté'), await etat());
await visibilite('visible'); await attendre(1200);
b = await ble();
ok('retour : reconnecté sans liste', b.requestDevice === 1 && b.connexions === 2, await etat());

await p.clic('#btnConnect'); await attendre(500);
await p.clic('#btnConnect'); await attendre(1500);
b = await ble();
ok('Déconnecter puis Connecter : sans liste', b.requestDevice === 1 && b.connexions === 3, await etat());

await cmd('Page.reload'); await attendre(3000);
b = await ble();
ok('rechargement : reconnexion auto par getDevices', b.requestDevice === 0 && b.getDevices >= 1 && b.connexions === 1, await etat());

await p.clic('#btnConnect'); await attendre(500);
await js('window.__ble.injoignable = true');
await p.clic('#btnConnect'); await attendre(1500);
b = await ble();
ok('injoignable : aide affichée, pas de liste', b.requestDevice === 0 && !(await js(`document.querySelector('#aideConnexion').hidden`)), await etat());
await js('window.__ble.injoignable = false');
await p.clic('[data-action="chercher"]'); await attendre(1500);
b = await ble();
ok('« Chercher » ouvre la liste et connecte', b.requestDevice === 1 && (await puce()).startsWith('Connecté'), await etat());

// navigateur qui ne répond plus : au bout de 15 s, on abandonne au lieu de rester en « Connexion… »
await p.clic('#btnConnect'); await attendre(500);            // déconnecter
await js('window.__ble.bloque = true');
await js(`document.querySelector('[data-action="chercher"]').click()`); await attendre(1000);
ok('bloqué : « Connexion… » affiché', /Connexion/.test(await puce()), await puce());
await attendre(15500);
ok('bloqué : abandon au bout de 15 s, aide affichée', (await puce()) === 'Déconnecté' && !(await js(`document.querySelector('#aideConnexion').hidden`)), await puce());
await js('window.__ble.bloque = false');
await p.clic('[data-action="chercher"]'); await attendre(1500);
ok('bloqué puis débloqué : la connexion repart', (await puce()).startsWith('Connecté'), await puce());

const j = await js(`import('./js/connexion.js').then(m => m.journal())`);
ok('journal : étapes de connexion notées', /getDevices : 1 appareil/.test(j) && /connexion directe|libéré/.test(j));

await js(`localStorage.setItem('viawrist-reconnexion', JSON.stringify({ ok: 0, ko: 2, t: Date.now() }))`);
await cmd('Page.reload'); await attendre(2500);
b = await ble();
ok('pause : pas de tentative au chargement', b.getDevices === 0 && b.connexions === 0, await etat());
await p.clic('#btnConnect'); await attendre(1500);
b = await ble();
ok('pause : Connecter ouvre la liste directement', b.requestDevice === 1 && (await puce()).startsWith('Connecté'), await etat());
ok('ordinateur : liste filtrée sur le bracelet', b.toutMontrer === false);

await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cmd('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
await cmd('Page.reload'); await attendre(2500);
await p.clic('#btnConnect'); await attendre(1500);
b = await ble();
ok('iPhone : liste de tous les appareils', b.toutMontrer === true && (await puce()).startsWith('Connecté'), JSON.stringify(b));
ok('iPhone : « Afficher tous les appareils » masqué', await js(`document.querySelector('#btnTous').hidden`));
p.fin();
