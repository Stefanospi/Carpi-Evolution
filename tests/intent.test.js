'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPcIntent } = require('../src/main/intent');
const { parseWindows, toRequest } = require('../src/main/screen-core');
const { runCommand } = require('../src/main/commands');
const { createRouterClient } = require('../src/main/router-client');
const http = require('node:http');

test('which programs are open', () => {
  for (const q of [
    'puoi vedere le mie applicazioni aperte?',
    'Quali programmi ho aperti?',
    'cosa ho aperto?',
    'che app ho aperte in questo momento',
    'elenca i programmi',
    'vedi quali finestre ho?',
    'dimmi le app in esecuzione',
  ]) assert.equal(detectPcIntent(q), 'apps', q);
});

test('the window in front', () => {
  for (const q of [
    'come si usa questo programma?',
    'dove clicco per salvare?',
    'cosa vedi?',
    'Cosa sto facendo?',
    'aiutami con questa app',
    'dov\'è il pulsante di stampa?',
    'guarda lo schermo',
    'cosa c\'è sullo schermo',
    'che cos\'è questa finestra?',
    'non capisco questo menu',
  ]) assert.equal(detectPcIntent(q), 'window', q);
});

test('both', () => {
  assert.equal(detectPcIntent('quali app ho aperte e come si usa questo programma?'), 'both');
});

test('a plain question is just a question', () => {
  for (const q of [
    'come si fa la carbonara?',
    'ciao come stai?',
    'scrivi una mail a Mario per spostare la riunione',
    'cosa significa flatline?',
    'cosa c\'è di nuovo in Python 3.13?',
    'spiegami cos\'è un programma',
    'cosa significa file aperto?',
    'quale app di note mi consigli?',
    'converti il documento in pdf',
    '',
    null,
  ]) assert.equal(detectPcIntent(q), null, String(q));
});

test('slash commands are never an intent', () => {
  assert.equal(detectPcIntent('/schermo dove clicco?'), null);
  assert.equal(detectPcIntent('/converti questo programma'), null);
});

// ---------- what is open ----------

const winLine = (extra = {}) => JSON.stringify({
  ok: true,
  windows: [
    { process: 'Code', title: 'brain.py - Sistema_AI - Visual Studio Code', fg: true, min: false },
    { process: 'chrome', title: 'Posta in arrivo', fg: false, min: true },
    { process: '', title: '' },
  ],
  ...extra,
});

test('parseWindows', () => {
  const out = parseWindows('﻿' + winLine());
  assert.equal(out.ok, true);
  assert.deepEqual(out.windows.map((w) => [w.process, w.fg, w.min]), [['Code', true, false], ['chrome', false, true]]);
  assert.equal(parseWindows('boh').ok, false);
  assert.equal(parseWindows('').ok, false);
  assert.equal(parseWindows(JSON.stringify({ ok: false })).ok, false);
  assert.equal(parseWindows(JSON.stringify({ ok: true })).ok, false);
});

test('toRequest carries the open windows only when there are some', () => {
  const base = { window: { title: '', process: '' }, elements: [], windows: [] };
  assert.equal('windows' in toRequest('q', base), false);
  const withWindows = toRequest('q', { ...base, windows: [{ process: 'Code', title: 't', fg: true, min: false }] });
  assert.deepEqual(withWindows.windows, [{ process: 'Code', title: 't', fg: true, min: false }]);
});

function fakeRouter(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { seen.push({ url: req.url, body: raw ? JSON.parse(raw) : null }); handler(req, res); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('"which apps are open?" needs no window in front: she checks and answers, nothing to point at', async () => {
  const r = await fakeRouter((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: 'Hai VS Code e Chrome, choom.', target: null })); });
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const said = [];
  const commands = [];
  const events = [];
  const asked = [];
  const screen = {
    snapshot: async (hwnd, mode, scope) => {
      asked.push([hwnd, mode, scope]);
      return { ok: true, window: { title: '', process: '', rect: [0, 0, 0, 0] }, elements: [], image: null, windows: [{ process: 'Code', title: 'brain.py', fg: true, min: false }] };
    },
    toOverlayRect: (x) => x,
  };
  await runCommand({ kind: 'screen', question: 'quali app ho aperte?', image: 'auto', scope: 'apps' }, {
    client, screen, target: () => null,
    info: (m) => said.push(m), failure: (m) => said.push('FAIL ' + m),
    sendCommand: (n, p) => commands.push([n, p]), sendEvent: (e) => events.push(e),
  });
  r.server.close();
  assert.deepEqual(asked, [[null, 'auto', 'apps']]);
  assert.equal(said[0], 'Checking what is open…');
  assert.deepEqual(r.seen[0].body.windows, [{ process: 'Code', title: 'brain.py', fg: true, min: false }]);
  assert.deepEqual(commands.at(-1), ['screenTarget', {}]);
  assert.equal(events[0].last_assistant_message, 'Hai VS Code e Chrome, choom.');
});

test('a question about "this window" with no window remembered still asks you to pick one', async () => {
  const said = [];
  await runCommand({ kind: 'screen', question: 'come si usa questo programma?', image: 'auto', scope: 'window' }, {
    client: {}, screen: { snapshot: async () => { throw new Error('should not look'); } }, target: () => null,
    info: (m) => said.push(m), failure: () => {}, sendCommand: () => {}, sendEvent: () => {},
  });
  assert.match(said[0], /Click the window/);
});
