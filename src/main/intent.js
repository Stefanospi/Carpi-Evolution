'use strict';

// Does a plain question need her to look at your PC? "Which apps do I have open?", "how do I use this
// program?", "where do I click to save?": she reads the window list and/or the window you were in, and
// answers with Claude (what's on your screen is private). No slash command needed.
//
// Cheap on purpose: a few patterns, no model. A question that doesn't match is just a question: she
// answers it as herself and, if you meant the screen, tells you to say "guarda lo schermo".

const OPEN = '(?:apert[aeio]|in esecuzione|avviat[aeio])';

// which programs/windows are open
const APPS = [
  new RegExp(`\\b(?:cosa|quali?|che\\s+cosa)\\s+(?:ho|hai|c['’]è|ci\\s+sono|è)\\s+(?:\\w+\\s+){0,2}${OPEN}\\b`, 'i'),
  new RegExp(`\\b(?:app|applicazion[ei]|programm[ai]|finestr[ae]|software)\\b[^.?!]{0,40}\\b${OPEN}\\b`, 'i'),
  /\b(?:vedi|vedere|elenca|mostrami|dimmi|controlla)\b[^.?!]{0,40}\b(?:app|applicazion[ei]|programmi|finestre)\b/i,
];

// the window in front: "this program", "what am I doing", "where do I click"
const HERE = [
  /\b(?:quest[oaie]|quell[oaie]|qui)\b[^.?!]{0,12}\b(?:programma|app|applicazione|finestra|schermata|software|sito|pagina|menu|menù|pulsante|tasto|documento|schermo)\b/i,
  /\bquest['’]\s*(?:app|applicazione)\b/i,
  /\b(?:sul(?:lo)?|nel(?:lo)?|dal(?:lo)?)\s+(?:mio\s+)?(?:schermo|pc|computer)\b/i,
  /\bcosa\s+(?:vedi|sto\s+(?:facendo|usando|guardando))\b/i,
  /\bcosa\s+c['’]è\s+(?:qui|sullo\s+schermo|sul\s+(?:mio\s+)?(?:pc|computer)|davanti)\b/i,
  /\bguarda(?:mi)?\s+(?:lo\s+)?(?:schermo|qui|questa|questo)\b/i,
  /\bdove\s+(?:clicco|premo|devo\s+(?:cliccare|premere))\b/i,
  /\bdov['’]è\s+(?:il|lo|la|l['’])\s*(?:pulsante|tasto|menu|menù|opzione|comando|icona|scheda)\b/i,
  /\baiutami\s+(?:con|a\s+usare|ad\s+usare)\s+(?:quest|il\s+programma|l['’]app)/i,
];

// -> 'apps' (which programs are open) | 'window' (the one in front) | 'both' | null (just a question)
function detectPcIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.startsWith('/')) return null;
  const apps = APPS.some((re) => re.test(t));
  const here = HERE.some((re) => re.test(t));
  if (apps && here) return 'both';
  if (apps) return 'apps';
  return here ? 'window' : null;
}

module.exports = { detectPcIntent };
