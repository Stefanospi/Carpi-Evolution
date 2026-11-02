'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { toHookEvent } = require('../src/main/agent-events');
const { createBridge } = require('../src/main/bridge');

const v1 = (type, fields = {}) => ({ v: 1, type, session_id: 'router', cwd: 'C:/x', ...fields });

test('hook events from Claude Code pass through untouched', () => {
  const hook = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.js' } };
  assert.equal(toHookEvent(hook), hook);
});

test('request.start becomes UserPromptSubmit', () => {
  assert.deepEqual(toHookEvent(v1('request.start', { prompt: 'ciao', title: 'router · coding' })), {
    session_id: 'router', cwd: 'C:/x', hook_event_name: 'UserPromptSubmit', prompt: 'ciao', session_title: 'router · coding',
  });
});

test('model.attempt shows up in the ticker as "router › model"', () => {
  const e = toHookEvent(v1('model.attempt', { model: 'claude/haiku' }));
  assert.equal(e.hook_event_name, 'PreToolUse');
  assert.equal(e.tool_name, 'mcp__router__claude/haiku');
});

test('tool.call keeps the tool name and input', () => {
  const e = toHookEvent(v1('tool.call', { name: 'read_file', input: { path: 'a.py' } }));
  assert.deepEqual([e.hook_event_name, e.tool_name, e.tool_input], ['PreToolUse', 'read_file', { path: 'a.py' }]);
});

test('needs.confirm is a permission prompt: she goes to find you', () => {
  const e = toHookEvent(v1('needs.confirm', { message: 'Modificare a.py?' }));
  assert.deepEqual([e.hook_event_name, e.notification_type, e.message], ['Notification', 'permission_prompt', 'Modificare a.py?']);
});

test('done and failed', () => {
  assert.equal(toHookEvent(v1('done', { text: 'fatto' })).last_assistant_message, 'fatto');
  assert.equal(toHookEvent(v1('done', { text: 'fatto' })).hook_event_name, 'Stop');
  const f = toHookEvent(v1('failed', { error: 'boom' }));
  assert.deepEqual([f.hook_event_name, f.error], ['StopFailure', 'boom']);
});

test('unknown or malformed events are refused', () => {
  assert.equal(toHookEvent(null), null);
  assert.equal(toHookEvent('x'), null);
  assert.equal(toHookEvent({ v: 2, type: 'done' }), null);
  assert.equal(toHookEvent(v1('quel.che.non.esiste')), null);
  assert.equal(toHookEvent({ type: 'done' }), null);
});

test('the bridge accepts both formats and refuses the rest', async () => {
  const got = [];
  const server = createBridge({ port: 0, onEvent: (e) => got.push(e) });
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const post = (body) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/event', method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end(JSON.stringify(body));
  });
  assert.equal(await post(v1('done', { text: 'ok' })), 200);
  assert.equal(await post({ hook_event_name: 'Stop', last_assistant_message: 'ok' }), 200);
  assert.equal(await post({ nonsense: true }), 400);
  server.close();
  assert.deepEqual(got.map((e) => e.hook_event_name), ['Stop', 'Stop']);
});
