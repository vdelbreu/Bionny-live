// Pilote un Chrome sans fenêtre par le protocole DevTools, pour les scénarios de test/navigateur (voir lancer.sh).
import { writeFileSync } from 'node:fs';

export const SITE = 'http://127.0.0.1:8765';
export const attendre = ms => new Promise(r => setTimeout(r, ms));

export async function ouvrirChrome(port = process.argv[2] || 9333) {
  let url;
  for (let i = 0; i < 40 && !url; i++) {
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch { await attendre(250); }
  }
  if (!url) throw new Error(`Chrome introuvable sur le port ${port}`);
  const ws = new WebSocket(url);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const attente = new Map(), erreurs = [], res = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') erreurs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erreurs.push(m.params.args.map(a => a.value).join(' '));
  });
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; attente.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  const p = {
    cmd, js, erreurs,
    texte: sel => js(`document.querySelector(${JSON.stringify(sel)})?.textContent?.trim() ?? null`),
    clic: sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`),
    // change la valeur d'un champ comme le ferait l'utilisateur (événement change)
    saisir: (sel, v) => js(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); })()`),
    aller: async (chemin, ms = 2000) => { await cmd('Page.navigate', { url: SITE + chemin }); await attendre(ms); },
    iphone: () => cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }),
    avantPage: source => cmd('Page.addScriptToEvaluateOnNewDocument', { source }),
    photo: async nom => { if (process.env.CAPTURES) writeFileSync(`${process.env.CAPTURES}/${nom}.png`, Buffer.from((await cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); },
    ok: (nom, v, d = '') => res.push(`${v ? 'OK ' : 'ÉCHEC'} ${nom}${d ? ' : ' + d : ''}`),
    fin() {
      p.ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' / '));
      console.log(res.join('\n'));
      ws.close();
      process.exitCode = res.some(l => l.startsWith('ÉCHEC')) ? 1 : 0;
    },
  };
  return p;
}
