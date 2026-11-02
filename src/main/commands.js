'use strict';

// Slash commands typed in her input box. They never reach a model: the router does the work
// locally (file conversion with Python libraries), so they cost no tokens.
//
//   /converti "C:\Users\me\Documents\relazione.docx" pdf     (also: in pdf · a pdf · to pdf, quotes optional if no spaces)
//   /formati                                                  what can be converted into what
//   /reset                                                    forget the conversation

const path = require('node:path');

const USAGE = 'Usage: /converti "C:\\path\\file.docx" pdf   ·   /formati';

const CONVERT = /^\/(?:converti|convert)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:(?:in|a|to)\s+)?\.?([A-Za-z0-9]{1,8})\s*$/i;

// -> { kind: 'reset' } | { kind: 'formats' } | { kind: 'convert', path, to } | { kind: 'usage' } | null (not a command)
function parseCommand(text) {
  const t = String(text || '').trim();
  if (/^\/(reset|nuova)$/i.test(t)) return { kind: 'reset' };
  if (/^\/(formati|formats)$/i.test(t)) return { kind: 'formats' };
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
async function runCommand(cmd, { client, info, failure, reveal = () => {} }) {
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
    default:
      return undefined;
  }
}

module.exports = { parseCommand, describeFormats, runCommand, USAGE };
