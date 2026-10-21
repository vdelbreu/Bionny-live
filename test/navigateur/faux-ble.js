// Faux Web Bluetooth injecté avant la page : un bracelet qui répond à la batterie et au direct, une autorisation
// retenue entre deux chargements (sessionStorage), et une visibilité de page pilotable (window.__ble.vis).
(() => {
  const etat = window.__ble = { requestDevice: 0, getDevices: 0, connexions: 0, deconnexions: 0, injoignable: false, vis: 'visible', ecrits: [] };
  // réveils en mémoire (charge de la réponse à la lecture), gardés d'un chargement à l'autre ; au départ un réveil
  // « Sport » à 18 h lundi et mercredi, comme réglé avec l'app Bionny
  const SPORT = [0x01, 1, 9, 0x80 | (1 << 1) | (1 << 3), 1080 & 0xff, 1080 >> 8, ...new TextEncoder().encode('Sport')];
  const lireReveils = () => JSON.parse(sessionStorage.getItem('faux-reveils') || JSON.stringify(SPORT));
  const crc = o => { let c = 0xffff; for (const b of o) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; } return c; };
  const gros = (type, charge) => { const c = crc(charge); return [0xbc, type, charge.length & 0xff, charge.length >> 8, c & 0xff, c >> 8, ...charge]; };
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => etat.vis, configurable: true });
  Object.defineProperty(Document.prototype, 'hidden', { get: () => etat.vis !== 'visible', configurable: true });
  if (!localStorage.getItem('bionny-sante')) localStorage.setItem('bionny-sante', JSON.stringify({ v: 1, maj: Date.now(), majBracelet: Date.now() }));
  const p16 = (...o) => { const p = new Uint8Array(16); p.set(o); return p; };
  const ecoutes = [];
  const emettre = o => setTimeout(() => { for (const f of ecoutes) f({ target: { value: new DataView(Uint8Array.from(o).buffer) } }); }, 5);
  const repondre = p => {
    etat.ecrits.push([...p.slice(0, 2)].map(b => b.toString(16).padStart(2, '0')).join(' '));
    if (p[0] === 0xbc && p[1] === 0x2c) {
      const charge = [...p.slice(6)];
      if (charge[0] === 0x02) sessionStorage.setItem('faux-reveils', JSON.stringify([0x01, ...charge.slice(1)]));
      const o = gros(0x2c, charge[0] === 0x02 ? [0x02] : lireReveils());
      for (let i = 0; i < o.length; i += 20) emettre(o.slice(i, i + 20));
    }
    if (p[0] === 0x03) emettre(p16(0x03, 81, 0));
    if (p[0] === 0x69 && p[2] === 1) emettre(p16(0x69, 1, 0, 64));
    // pouls en continu : une valeur par seconde jusqu'à l'arrêt (1e 02) ou la déconnexion
    if (p[0] === 0x1e && p[1] === 0x01 && !etat.continu) etat.continu = setInterval(() => { if (appareil.gatt.connected) emettre(p16(0x1e, 66 + Math.round(Math.random() * 4))); }, 1000);
    if (p[0] === 0x1e && p[1] === 0x02) { clearInterval(etat.continu); etat.continu = null; }
  };
  const carac = () => ({ properties: { write: true }, addEventListener: (_, f) => ecoutes.push(f), startNotifications: async () => {},
    writeValueWithResponse: async p => repondre(p), writeValueWithoutResponse: async p => repondre(p) });
  const introuvable = () => Object.assign(new Error('introuvable'), { name: 'NotFoundError' });
  const appareil = new EventTarget();
  appareil.name = 'Bionny 4.0'; appareil.id = 'faux';
  appareil.gatt = {
    connected: false,
    async connect() {
      if (etat.bloque) return new Promise(() => {});   // le navigateur ne répond jamais
      if (etat.injoignable) { await new Promise(r => setTimeout(r, 300)); throw Object.assign(new Error('injoignable'), { name: 'NetworkError' }); }
      ecoutes.length = 0; this.connected = true; etat.connexions++;
      return { getPrimaryService: async uuid => {
        if (['heart_rate', 'battery_service', 'device_information'].includes(uuid)) throw introuvable();
        return { getCharacteristic: async () => carac() };
      } };
    },
    disconnect() { if (!this.connected) return; this.connected = false; clearInterval(etat.continu); etat.continu = null; etat.deconnexions++; appareil.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
    requestDevice: async options => { etat.requestDevice++; etat.toutMontrer = !!options?.acceptAllDevices; sessionStorage.setItem('faux-autorise', '1'); return appareil; },
    getDevices: async () => { etat.getDevices++; return sessionStorage.getItem('faux-autorise') ? [appareil] : []; },
  } });
})();
