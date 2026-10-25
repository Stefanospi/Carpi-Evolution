'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRouterClient, MAX_HISTORY } = require('../src/main/router-client');

function fakeRouter(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ url: req.url, headers: req.headers, body });
      handler(req, res, body, seen.length);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, url: `http://127.0.0.1:${server.address().port}`,
  })));
}

const reply = (res, content) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
};

test('sends the whole conversation each time and keeps the answers', async () => {
  const r = await fakeRouter((req, res, body, n) => reply(res, `risposta ${n}`));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'router-auto', token: '' }) });
  assert.deepEqual(await client.ask('uno'), { ok: true, text: 'risposta 1' });
  assert.deepEqual(await client.ask('due'), { ok: true, text: 'risposta 2' });
  r.server.close();
  assert.equal(r.seen[0].url, '/v1/chat/completions');
  assert.equal(r.seen[0].body.model, 'router-auto');
  assert.equal(r.seen[0].body.stream, false);
  assert.deepEqual(r.seen[1].body.messages.map((m) => m.content), ['uno', 'risposta 1', 'due']);
});

test('reset starts a new conversation', async () => {
  const r = await fakeRouter((req, res) => reply(res, 'ok'));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  await client.ask('a');
  client.reset();
  await client.ask('b');
  r.server.close();
  assert.deepEqual(r.seen[1].body.messages.map((m) => m.content), ['b']);
});

test('history is capped', async () => {
  const r = await fakeRouter((req, res) => reply(res, 'ok'));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  for (let i = 0; i < MAX_HISTORY; i++) await client.ask(`q${i}`);
  r.server.close();
  assert.ok(client.history.length <= MAX_HISTORY);
  assert.ok(r.seen.at(-1).body.messages.length <= MAX_HISTORY);
});

test('bearer token is sent when configured', async () => {
  const r = await fakeRouter((req, res) => reply(res, 'ok'));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: 's3cret' }) });
  await client.ask('x');
  r.server.close();
  assert.equal(r.seen[0].headers.authorization, 'Bearer s3cret');
});

test('router down: offline, and the failed question is not kept', async () => {
  const client = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  const out = await client.ask('x');
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'offline');
  assert.match(out.error, /python server\.py/);
  assert.equal(client.history.length, 0);
});

test('every model failed (502): kind router, with the router message', async () => {
  const r = await fakeRouter((req, res) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Tutti i modelli hanno fallito' } }));
  });
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.kind, 'router');
  assert.equal(out.status, 502);
  assert.match(out.error, /Tutti i modelli/);
});

test('wrong token: auth', async () => {
  const r = await fakeRouter((req, res) => { res.writeHead(401); res.end('{}'); });
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: 'bad' }) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.kind, 'auth');
});

test('empty answer (tool call): not stored', async () => {
  const r = await fakeRouter((req, res) => reply(res, ''));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const out = await client.ask('x');
  r.server.close();
  assert.equal(out.kind, 'empty');
  assert.equal(client.history.length, 0);
});

test('a second question while one is running is refused', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const r = await fakeRouter(async (req, res) => { await gate; reply(res, 'ok'); });
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const first = client.ask('a');
  const second = await client.ask('b');
  assert.equal(second.kind, 'busy');
  release();
  assert.equal((await first).ok, true);
  r.server.close();
});
