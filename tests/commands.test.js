'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseCommand, describeFormats, runCommand, USAGE } = require('../src/main/commands');
const { createRouterClient } = require('../src/main/router-client');

test('parses /converti in its forms', () => {
  const win = 'C:\\Users\\me\\Documents\\relazione finale.docx';
  assert.deepEqual(parseCommand(`/converti "${win}" pdf`), { kind: 'convert', path: win, to: 'pdf' });
  assert.deepEqual(parseCommand(`/converti '${win}' in PDF`), { kind: 'convert', path: win, to: 'pdf' });
  assert.deepEqual(parseCommand('/converti C:\\a\\b.png a .jpg'), { kind: 'convert', path: 'C:\\a\\b.png', to: 'jpg' });
  assert.deepEqual(parseCommand('/convert x.csv to xlsx'), { kind: 'convert', path: 'x.csv', to: 'xlsx' });
  assert.deepEqual(parseCommand('  /CONVERTI x.csv xlsx  '), { kind: 'convert', path: 'x.csv', to: 'xlsx' });
});

test('incomplete /converti shows the usage; other commands; plain text is not a command', () => {
  assert.deepEqual(parseCommand('/converti'), { kind: 'usage' });
  assert.deepEqual(parseCommand('/converti file.docx'), { kind: 'usage' });
  assert.deepEqual(parseCommand('/formati'), { kind: 'formats' });
  assert.deepEqual(parseCommand('/reset'), { kind: 'reset' });
  assert.deepEqual(parseCommand('/nuova'), { kind: 'reset' });
  assert.equal(parseCommand('converti questo file'), null);
  assert.equal(parseCommand('/etc/hosts cosa contiene?'), null);
  assert.equal(parseCommand(''), null);
});

test('describeFormats', () => {
  assert.equal(describeFormats({ csv: ['json', 'xlsx'], pdf: ['txt'] }), 'csv → json, xlsx · pdf → txt');
});

function fakeRouter(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null }); handler(req, res); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

function harness(client) {
  const said = [];
  const revealed = [];
  const io = { client, info: (m) => said.push(['info', m]), failure: (m) => said.push(['failure', m]), reveal: (f) => revealed.push(f) };
  return { said, revealed, io };
}

test('convert: asks the router, says it is done and shows the file', async () => {
  const r = await fakeRouter((req, res) => json(res, 200, { ok: true, output: 'C:\\Users\\me\\Documents\\relazione.pdf' }));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: 'tk' }) });
  const { said, revealed, io } = harness(client);
  await runCommand({ kind: 'convert', path: 'C:\\Users\\me\\Documents\\relazione.docx', to: 'pdf' }, io);
  r.server.close();
  assert.deepEqual(r.seen[0].body, { path: 'C:\\Users\\me\\Documents\\relazione.docx', to: 'pdf' });
  assert.equal(r.seen[0].url, '/v1/convert');
  assert.deepEqual(said.map(([k]) => k), ['info', 'info']);
  assert.match(said[1][1], /Done: relazione\.pdf/);
  assert.deepEqual(revealed, ['C:\\Users\\me\\Documents\\relazione.pdf']);
});

test('convert: your mistakes are a calm hint, not a crash', async () => {
  const r = await fakeRouter((req, res) => json(res, 400, { error: { message: 'Non so convertire .csv in .mp3. Da .csv posso arrivare a: json, xlsx.' } }));
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const { said, revealed, io } = harness(client);
  await runCommand({ kind: 'convert', path: 'a.csv', to: 'mp3' }, io);
  r.server.close();
  assert.equal(said.at(-1)[0], 'info');
  assert.match(said.at(-1)[1], /posso arrivare a: json, xlsx/);
  assert.deepEqual(revealed, []);
});

test('convert: router down is a failure', async () => {
  const client = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  const { said, io } = harness(client);
  await runCommand({ kind: 'convert', path: 'a.csv', to: 'xlsx' }, io);
  assert.equal(said.at(-1)[0], 'failure');
  assert.match(said.at(-1)[1], /python server\.py/);
});

test('formats, usage and reset', async () => {
  const r = await fakeRouter((req, res) => {
    if (req.url === '/v1/convert/formats') return json(res, 200, { png: ['jpg', 'pdf'] });
    return json(res, 200, { cleared: 1 });
  });
  const client = createRouterClient({ getSettings: () => ({ url: r.url, model: 'm', token: '' }) });
  const { said, io } = harness(client);
  await runCommand({ kind: 'formats' }, io);
  await runCommand({ kind: 'usage' }, io);
  await runCommand({ kind: 'reset' }, io);
  r.server.close();
  assert.deepEqual(said, [['info', 'png → jpg, pdf'], ['info', USAGE], ['info', 'Conversation cleared.']]);
});

test('formats with the router down says so', async () => {
  const client = createRouterClient({ getSettings: () => ({ url: 'http://127.0.0.1:1', model: 'm', token: '' }) });
  const { said, io } = harness(client);
  await runCommand({ kind: 'formats' }, io);
  assert.match(said[0][1], /not reachable/);
});
