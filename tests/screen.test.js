'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseUia, needsImage, targetToScreenRect, toRequest, POINT_BOX } = require('../src/main/screen-core');
const { parseCommand, runCommand, USAGE } = require('../src/main/commands');
const { createRouterClient } = require('../src/main/router-client');

const uiaLine = (extra = {}) => JSON.stringify({
  ok: true, title: 'Senza titolo - Blocco note', process: 'Notepad', rect: [156, 156, 1218, 643], visited: 39, truncated: false,
  elements: [
    { i: 1, t: 'MenuItem', n: 'File', a: 'File', e: true, x: 166, y: 198, w: 41, h: 32 },
    { i: 2, t: 'Button', n: 'Impostazioni', a: 'SettingsButton', e: true, x: 1330, y: 198, w: 30, h: 32 },
  ],
  ...extra,
});

// ---------- lettura di uia.ps1 ----------

test('parseUia reads the window and its controls', () => {
  const out = parseUia(uiaLine());
  assert.equal(out.ok, true);
  assert.deepEqual(out.window, { title: 'Senza titolo - Blocco note', process: 'Notepad', rect: [156, 156, 1218, 643] });
  assert.equal(out.elements.length, 2);
  assert.equal(out.truncated, false);
});

test('parseUia copes with a BOM, extra output lines and an invalid line', () => {
  assert.equal(parseUia('﻿' + uiaLine()).ok, true);
  assert.equal(parseUia('warning: something\n' + uiaLine() + '\n').ok, true);
  assert.equal(parseUia('not json').ok, false);
  assert.equal(parseUia('').ok, false);
  assert.equal(parseUia(null).ok, false);
  assert.equal(parseUia(JSON.stringify({ ok: false })).ok, false);
});

test('parseUia drops controls without a numeric id', () => {
  const out = parseUia(uiaLine({ elements: [{ i: 'x' }, null, { i: 3, t: 'Button', n: 'ok', x: 0, y: 0, w: 1, h: 1 }] }));
  assert.deepEqual(out.elements.map((e) => e.i), [3]);
});

// ---------- screenshot or not ----------

const buttons = (n) => Array.from({ length: n }, (_, k) => ({ i: k + 1, t: 'Button', n: `b${k}` }));

test('needsImage: auto sends a picture only when the app shows few controls', () => {
  assert.equal(needsImage({ elements: buttons(3) }, 'auto'), true);       // Chromium-style: just the window chrome
  assert.equal(needsImage({ elements: buttons(30) }, 'auto'), false);
  assert.equal(needsImage({ elements: [...buttons(2), ...Array.from({ length: 40 }, (_, k) => ({ i: 100 + k, t: 'Text', n: 't' }))] }, 'auto'), true); // labels don't count
  assert.equal(needsImage({ elements: buttons(30) }, 'always'), true);
  assert.equal(needsImage({ elements: [] }, 'never'), false);
});

// ---------- where to point ----------

const snapshot = { window: { rect: [100, 200, 800, 400] }, image: { size: [400, 200] } };

test('a control of the list: its own rectangle', () => {
  assert.deepEqual(targetToScreenRect({ source: 'uia', rect: [10, 20, 30, 40] }, snapshot), { x: 10, y: 20, w: 30, h: 40 });
  assert.equal(targetToScreenRect({ source: 'uia', rect: [10, 20, 0, 40] }, snapshot), null);
  assert.equal(targetToScreenRect({ source: 'uia', rect: [10, 20] }, snapshot), null);
});

test('a point of the screenshot is scaled onto the window', () => {
  // the picture is half the window: its middle (200, 100) is the window's middle (500, 400)
  const r = targetToScreenRect({ source: 'image', x: 200, y: 100 }, snapshot);
  assert.deepEqual(r, { x: 500 - POINT_BOX / 2, y: 400 - POINT_BOX / 2, w: POINT_BOX, h: POINT_BOX });
  const corner = targetToScreenRect({ source: 'image', x: 0, y: 0 }, snapshot);
  assert.deepEqual([corner.x + POINT_BOX / 2, corner.y + POINT_BOX / 2], [100, 200]);
});

test('nothing to point at', () => {
  assert.equal(targetToScreenRect(null, snapshot), null);
  assert.equal(targetToScreenRect({ source: 'image', x: 5, y: 5 }, { window: snapshot.window }), null); // no screenshot
  assert.equal(targetToScreenRect({ source: 'image', x: NaN, y: 5 }, snapshot), null);
  assert.equal(targetToScreenRect({ source: 'other' }, snapshot), null);
});

test('toRequest carries names, not the window rectangle; the picture only if there is one', () => {
  const seen = { window: { title: 'T', process: 'P', rect: [1, 2, 3, 4] }, elements: [{ i: 1 }], image: null };
  assert.deepEqual(toRequest('dove?', seen), { question: 'dove?', window: { title: 'T', process: 'P' }, elements: [{ i: 1 }] });
  const withImage = toRequest('dove?', { ...seen, image: { dataUrl: 'data:image/jpeg;base64,AAA', size: [10, 5] } });
  assert.equal(withImage.image, 'data:image/jpeg;base64,AAA');
  assert.deepEqual(withImage.image_size, [10, 5]);
});

// ---------- the command ----------

test('parses /schermo', () => {
  assert.deepEqual(parseCommand('/schermo dove salvo il file?'), { kind: 'screen', question: 'dove salvo il file?', image: 'auto' });
  assert.deepEqual(parseCommand('/schermo+ cosa vedi'), { kind: 'screen', question: 'cosa vedi', image: 'always' });
  assert.deepEqual(parseCommand('/screen where is Save'), { kind: 'screen', question: 'where is Save', image: 'auto' });
  assert.deepEqual(parseCommand('/schermo'), { kind: 'usage' });
  assert.equal(parseCommand('/schermata'), null);       // another word, not the command
  assert.equal(parseCommand('guarda lo schermo'), null);
  assert.match(USAGE, /\/schermo/);
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

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

function harness(client, { hwnd = 4242, snap } = {}) {
  const said = [];
  const commands = [];
  const events = [];
  const asked = [];
  const screen = {
    snapshot: async (h, mode) => { asked.push([h, mode]); return snap || { ok: true, window: { title: 'Blocco note', process: 'Notepad', rect: [0, 0, 1000, 500] }, elements: [{ i: 1, t: 'Button', n: 'Salva' }], image: null }; },
    toOverlayRect: (r) => ({ x: r.x / 2, y: r.y / 2, w: r.w / 2, h: r.h / 2 }), // pretend the screen is scaled 200%
  };
  const io = {
    client, screen, target: () => hwnd,
    info: (m) => said.push(['info', m]), failure: (m) => said.push(['failure', m]),
    sendCommand: (name, payload) => commands.push([name, payload]), sendEvent: (e) => events.push(e),
  };
  return { said, commands, events, asked, io };
}

test('/schermo: looks, asks, then tells the overlay where to point and what she says', async () => {
  const r = await fakeRouter((req, res) => json(res, 200, { text: 'Premi Salva.', target: { source: 'uia', id: 1, name: 'Salva', rect: [100, 60, 80, 30] }, model: 'claude/haiku' }));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const h = harness(client);
  await runCommand(parseCommand('/schermo come salvo?'), h.io);
  r.server.close();
  assert.deepEqual(h.asked, [[4242, 'auto']]);
  assert.equal(r.seen[0].url, '/v1/screen/ask');
  assert.deepEqual(r.seen[0].body, { question: 'come salvo?', window: { title: 'Blocco note', process: 'Notepad' }, elements: [{ i: 1, t: 'Button', n: 'Salva' }] });
  assert.deepEqual(h.commands, [['ask', { on: true }], ['screenTarget', { rect: { x: 50, y: 30, w: 40, h: 15 }, label: 'Salva' }]]);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].hook_event_name, 'Stop');
  assert.equal(h.events[0].last_assistant_message, 'Premi Salva.');
});

test('/schermo+ forces the screenshot; an answer without a target still answers', async () => {
  const r = await fakeRouter((req, res) => json(res, 200, { text: 'Non lo vedo.', target: null }));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const h = harness(client);
  await runCommand(parseCommand('/schermo+ dov\'è il logo?'), h.io);
  r.server.close();
  assert.equal(h.asked[0][1], 'always');
  assert.deepEqual(h.commands.at(-1), ['screenTarget', {}]);
  assert.equal(h.events[0].last_assistant_message, 'Non lo vedo.');
});

test('/schermo: no window remembered, or the window cannot be read: a calm hint, nothing sent', async () => {
  const client = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  const none = harness(client, { hwnd: null });
  await runCommand(parseCommand('/schermo x'), none.io);
  assert.match(none.said[0][1], /Click the window/);
  assert.equal(none.asked.length, 0);

  const unreadable = harness(client, { snap: { ok: false, error: 'I could not read that window.' } });
  await runCommand(parseCommand('/schermo x'), unreadable.io);
  assert.equal(unreadable.said.at(-1)[1], 'I could not read that window.');
  assert.deepEqual(unreadable.commands, []);
  assert.deepEqual(unreadable.events, []);
});

test('/schermo: router refused (quota, budget): she is not told twice; router down: a failure', async () => {
  const refused = await fakeRouter((req, res) => json(res, 502, { error: { message: 'Quota del piano da 5 ore al 52%' } }));
  const client = createRouterClient({ getSettings: () => ({ url: refused.url, model: 'm', token: '' }) });
  const a = harness(client);
  await runCommand(parseCommand('/schermo x'), a.io);
  refused.server.close();
  assert.deepEqual(a.said.filter(([k]) => k === 'failure'), []);        // the router already sent her a StopFailure
  assert.deepEqual(a.commands.at(-1), ['ask', { on: false }]);
  assert.deepEqual(a.events, []);

  const down = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  const b = harness(down);
  await runCommand(parseCommand('/schermo x'), b.io);
  assert.equal(b.said.at(-1)[0], 'failure');
  assert.match(b.said.at(-1)[1], /python server\.py/);
  assert.deepEqual(b.commands.at(-1), ['ask', { on: false }]);
});
