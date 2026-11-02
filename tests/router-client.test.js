'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRouterClient, SESSION } = require('../src/main/router-client');

function fakeRouter(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body, seen.length);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, url: `http://127.0.0.1:${server.address().port}`,
  })));
}

const chunk = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content } }] })}\n\n`;

// an SSE answer, the pieces written one after the other
const stream = (res, pieces, { end = true } = {}) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const p of pieces) res.write(chunk(p));
  if (end) res.end('data: [DONE]\n\n');
};

const settings = (r, extra = {}) => () => ({ url: r.url, model: 'brain-auto', token: '', ...extra });

test('sends only the new message with the session id, and streams the answer', async () => {
  const r = await fakeRouter((req, res) => stream(res, ['Ci', 'ao ', 'mondo']));
  const client = createRouterClient({ getSettings: settings(r) });
  const seenDeltas = [];
  const out = await client.ask('uno', { onDelta: (full) => seenDeltas.push(full) });
  r.server.close();
  assert.deepEqual(out, { ok: true, text: 'Ciao mondo' });
  assert.deepEqual(seenDeltas, ['Ci', 'Ciao ', 'Ciao mondo']);
  assert.equal(r.seen[0].url, '/v1/chat/completions');
  assert.equal(r.seen[0].body.model, 'brain-auto');
  assert.equal(r.seen[0].body.stream, true);
  assert.equal(r.seen[0].body.session, SESSION);
  assert.deepEqual(r.seen[0].body.messages, [{ role: 'user', content: 'uno' }]); // history is the router's job
});

test('a second question is sent alone too', async () => {
  const r = await fakeRouter((req, res, body, n) => stream(res, [`risposta ${n}`]));
  const client = createRouterClient({ getSettings: settings(r) });
  await client.ask('uno');
  await client.ask('due');
  r.server.close();
  assert.deepEqual(r.seen[1].body.messages, [{ role: 'user', content: 'due' }]);
});

test('events split across network chunks are still read', async () => {
  const r = await fakeRouter((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const whole = chunk('spezzato') + 'data: [DONE]\n\n';
    res.write(whole.slice(0, 20));
    setTimeout(() => res.end(whole.slice(20)), 30);
  });
  const client = createRouterClient({ getSettings: settings(r) });
  const out = await client.ask('x');
  r.server.close();
  assert.deepEqual(out, { ok: true, text: 'spezzato' });
});

test('reset asks the router to forget the session', async () => {
  const r = await fakeRouter((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"cleared":2}'); });
  const client = createRouterClient({ getSettings: settings(r, { token: 'tk' }) });
  assert.equal(await client.reset(), true);
  r.server.close();
  assert.equal(r.seen[0].method, 'POST');
  assert.equal(r.seen[0].url, `/v1/sessions/${SESSION}/reset`);
  assert.equal(r.seen[0].headers.authorization, 'Bearer tk');
});

test('reset with the router down: false, no throw', async () => {
  const client = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  assert.equal(await client.reset(), false);
});

test('bearer token is sent when configured', async () => {
  const r = await fakeRouter((req, res) => stream(res, ['ok']));
  const client = createRouterClient({ getSettings: settings(r, { token: 's3cret' }) });
  await client.ask('x');
  r.server.close();
  assert.equal(r.seen[0].headers.authorization, 'Bearer s3cret');
});

test('router down: offline', async () => {
  const client = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  const out = await client.ask('x');
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'offline');
  assert.match(out.error, /python server\.py/);
});

test('quota or budget refused (502): kind router, with the router message', async () => {
  const r = await fakeRouter((req, res) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Quota del piano da 5 ore al 52%' } }));
  });
  const client = createRouterClient({ getSettings: settings(r) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.kind, 'router');
  assert.equal(out.status, 502);
  assert.match(out.error, /Quota del piano/);
});

test('an error in the middle of the stream: kind router, the partial text is not an answer', async () => {
  const r = await fakeRouter((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(chunk('metà'));
    res.write(`data: ${JSON.stringify({ error: { message: 'La CLI è stata interrotta', type: 'server_error', code: '502' } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  const client = createRouterClient({ getSettings: settings(r) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'router');
  assert.match(out.error, /interrotta/);
});

test('wrong token: auth', async () => {
  const r = await fakeRouter((req, res) => { res.writeHead(401); res.end('{}'); });
  const client = createRouterClient({ getSettings: settings(r, { token: 'bad' }) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.kind, 'auth');
});

test('empty answer: empty', async () => {
  const r = await fakeRouter((req, res) => stream(res, []));
  const client = createRouterClient({ getSettings: settings(r) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.kind, 'empty');
});

test('a second question while one is running is refused', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const r = await fakeRouter(async (req, res) => { await gate; stream(res, ['ok']); });
  const client = createRouterClient({ getSettings: settings(r) });
  const first = client.ask('a');
  const second = await client.ask('b');
  assert.equal(second.kind, 'busy');
  release();
  assert.equal((await first).ok, true);
  r.server.close();
});
