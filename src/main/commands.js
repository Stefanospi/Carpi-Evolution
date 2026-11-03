'use strict';

// Slash commands typed in her input box. They never reach a model: the router does the work
// locally (file conversion with Python libraries), so they cost no tokens.
//
//   /converti "C:\Users\me\Documents\relazione.docx" pdf     (also: in pdf · a pdf · to pdf, quotes optional if no spaces)
//   /formati                                                  what can be converted into what
//   /schermo where do I save this file?                       she looks at the window you were in and answers (and points)
//   /schermo+ ...                                             the same, also sending a screenshot of that window
//   /reset                                                    forget the conversation

const path = require('node:path');
const { toRequest, targetToScreenRect } = require('./screen-core');

const USAGE = 'Usage: /schermo <question>   ·   /converti "C:\\path\\file.docx" pdf   ·   /formati';

const SCREEN = /^\/(?:schermo|screen)(\+)?(?:\s+([\s\S]+))?$/i;

const CONVERT = /^\/(?:converti|convert)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:(?:in|a|to)\s+)?\.?([A-Za-z0-9]{1,8})\s*$/i;

// -> { kind: 'reset' } | { kind: 'formats' } | { kind: 'convert', path, to } | { kind: 'screen', question, image } | { kind: 'usage' } | null (not a command)
function parseCommand(text) {
  const t = String(text || '').trim();
  if (/^\/(reset|nuova)$/i.test(t)) return { kind: 'reset' };
  if (/^\/(formati|formats)$/i.test(t)) return { kind: 'formats' };
  const shown = SCREEN.exec(t);
  if (shown) return shown[2] ? { kind: 'screen', question: shown[2].trim(), image: shown[1] ? 'always' : 'auto' } : { kind: 'usage' };
  if (/^\/(converti|convert)(\s|$)/i.test(t)) {
    const m = CONVERT.exec(t);
    return m ? { kind: 'convert', path: m[1] || m[2] || m[3], to: m[4].toLowerCase() } : { kind: 'usage' };
  }
  return null;
}

// { docx: ['html', 'md', 'pdf', 'txt'], ... } -> "docx → html, md, pdf, txt · ..."
function describeFormats(map) {
  return Object.entries(map || {}).map(([from, to]) => `${from} → ${to.join(', ')}`).join(' · ');
}

// Run a parsed command. info(message) is a quiet line from her, failure(error) is her "something broke" reaction,
// reveal(file) shows the new file in Explorer.
async function runCommand(cmd, { client, info, failure, reveal = () => {}, screen, target, sendCommand, sendEvent }) {
  switch (cmd.kind) {
    case 'reset':
      return info((await client.reset()) ? 'Conversation cleared.' : 'Could not clear it: the router is not reachable.');
    case 'usage':
      return info(USAGE);
    case 'formats': {
      const map = await client.formats();
      return info(map ? describeFormats(map) : 'The router is not reachable: start it with "python server.py".');
    }
    case 'convert': {
      info(`Converting to ${cmd.to}…`);
      const out = await client.convert(cmd.path, cmd.to);
      if (out.ok) {
        info(`Done: ${path.basename(out.output)}`);
        return reveal(out.output);
      }
      // a mistake of yours (unknown format, file not found...) is a calm hint; a broken router is a failure
      return out.kind === 'invalid' ? info(out.error) : failure(out.error);
    }
    case 'screen':
      return askAboutScreen(cmd, { client, info, failure, screen, target, sendCommand, sendEvent });
    default:
      return undefined;
  }
}

// She looks at the window you were in when you opened her box, asks the router (always Claude), shows the
// answer and points at the control it picked. The router doesn't send her "done": this does, once she knows where to point.
async function askAboutScreen(cmd, { client, info, failure, screen, target, sendCommand, sendEvent }) {
  const hwnd = target?.();
  if (!screen || !hwnd) return info('Click the window you want help with, then open me again and ask.');
  info('Looking at that window…');
  const seen = await screen.snapshot(hwnd, cmd.image);
  if (!seen.ok) return info(seen.error);
  sendCommand('ask', { on: true }); // the answer is shown whole
  const out = await client.screenAsk(toRequest(cmd.question, seen));
  if (!out.ok) {
    sendCommand('ask', { on: false });
    return out.kind === 'router' ? undefined : failure(out.error); // the router already told her about its own failures
  }
  const rect = targetToScreenRect(out.target, seen);
  sendCommand('screenTarget', rect ? { rect: screen.toOverlayRect(rect), label: out.target?.name || '' } : {});
  return sendEvent({ hook_event_name: 'Stop', session_id: 'router', last_assistant_message: out.text || '…' });
}

module.exports = { parseCommand, describeFormats, runCommand, USAGE };
