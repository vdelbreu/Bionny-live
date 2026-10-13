// Onglet Coach : ta semaine en bref, puis une conversation. Les réponses viennent de coach.js :
// des règles appliquées à tes données, sur ce téléphone (pas d'IA en ligne, donc rien d'inventé, rien d'envoyé).
import { duree } from '../sante.js';
import { esc } from '../graphes.js';
import { repondre, SUGGESTIONS, semaine, planSommeil, heure, OBJECTIF_EFFORT } from '../coach.js';
import { $, aDesDonnees } from '../ui.js';

const fil = [];
let contexte = null;
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export function rendreCoach(c) {
  contexte = c;
  const s = semaine(c), p = planSommeil(c);
  $('#coachSemaine').innerHTML = aDesDonnees(c.D) ? `<div class="tuiles grandes resume-semaine">
    <div><span>Sommeil</span><strong>${s.tst ? duree(s.tst) : '–'}</strong><em>en moyenne, ${s.nuits} nuit${s.nuits > 1 ? 's' : ''}</em></div>
    <div><span>Au lit ce soir</span><strong>${p.coucher != null ? heure(p.coucher) : '–'}</strong><em>${p.lever != null ? 'pour te lever à ' + heure(p.lever) : ''}</em></div>
    <div><span>Effort</span><strong>${s.effort.total}<small> / ${OBJECTIF_EFFORT} min</small></strong><em>cette semaine</em></div>
    <div><span>Cœur au repos</span><strong>${s.rhr.cette ? Math.round(s.rhr.cette.moy) + '<small>bpm</small>' : '–'}</strong><em>moyenne 7 jours</em></div>
  </div>` : '';
  if (!fil.length) fil.push({ qui: 'coach', ...repondre(aDesDonnees(c.D) ? 'jour' : 'aide', c) });
  dessiner();
}

function dessiner() {
  $('#chat').innerHTML = fil.slice(-30).map(m => `<div class="bulle ${m.qui}">${m.lignes.map(l => `<p>${m.qui === 'moi' ? esc(l) : md(l)}</p>`).join('')}</div>`).join('');
  $('#chips').innerHTML = SUGGESTIONS.map(([id, q]) => `<button class="chip-q" data-q="${id}">${esc(q)}</button>`).join('');
  const chat = $('#chat');
  chat.scrollTop = chat.scrollHeight;
}

function poser(question, texte) {
  fil.push({ qui: 'moi', lignes: [texte] });
  fil.push({ qui: 'coach', ...repondre(question, contexte) });
  dessiner();
}

export function brancherCoach(obtenirContexte) {
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (b) { contexte = obtenirContexte(); poser(b.dataset.q, b.textContent); }
  });
  $('#saisieCoach').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#question').value.trim();
    if (!q) return;
    $('#question').value = '';
    contexte = obtenirContexte();
    poser(q, q.slice(0, 200));
  });
}
