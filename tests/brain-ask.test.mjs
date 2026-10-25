import test from 'node:test';
import assert from 'node:assert/strict';
// the renderer modules expect a browser: a minimal stand-in for what they read at load time
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
const { Brain } = await import('../src/renderer/js/brain.js');

function setup() {
  const said = [];
  const capri = {
    windows: { fg: 7, wins: [] },
    mode: 'idle',
    wake() {}, attend() {}, setMode() {}, goToWork() {}, pulse() {}, spark() {}, hurt() {},
    towardCenter: () => 1,
    spot: () => ({}),
    teleport: async () => {},
    celebrate: ({ onSpeak }) => onSpeak(),
    earnUplink() {},
  };
  const panel = {
    current: null,
    say: (m) => said.push(m),
    hide() {}, clearKind() {}, setTicker() {}, updateLog() {},
  };
  const voice = { play() {} };
  const brain = new Brain({ capri, panel, voice, host: {}, lang: 'en' });
  return { brain, said, capri };
}

const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 'router', prompt: 'ciao' };
const stop = { hook_event_name: 'Stop', session_id: 'router', last_assistant_message: '**Ciao**\n- uno\n- due' };

test('a question typed to her: the answer is shown whole even on Claude\'s own window', async () => {
  const { brain, said } = setup();
  brain.askPending = true;
  brain.handle(prompt);
  await brain.handle(stop);
  const done = said.find((m) => m.kind === 'done');
  assert.ok(done.reply.includes('Ciao') && done.reply.includes('• uno'));
  assert.equal(done.hold, null);
  assert.equal(brain.askPending, false);
  assert.ok(['Here you go:', 'Got it. Here:', 'Done. Take a look:'].includes(done.line));
});

test('without a pending question and still on the same window: the usual short quote', async () => {
  const { brain, said } = setup();
  brain.handle(prompt);
  await brain.handle(stop);
  const done = said.find((m) => m.kind === 'done');
  assert.equal(done.reply, undefined);
  assert.ok(done.quote);
});

test('a router failure clears the pending flag', () => {
  const { brain } = setup();
  brain.askPending = true;
  brain.handle(prompt);
  brain.handle({ hook_event_name: 'StopFailure', session_id: 'router', error: 'boom' });
  assert.equal(brain.askPending, false);
});
