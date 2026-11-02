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
  const updated = [];
  const panel = {
    current: null,
    updated,
    say: (m) => said.push(m),
    // like the real one: only the message on screen can be updated
    updateReply: (text) => (panel.current?.stream ? (updated.push(text), true) : false),
    hide() {}, clearKind() {}, setTicker() {}, updateLog() {},
  };
  const voice = { play() {} };
  const brain = new Brain({ capri, panel, voice, host: {}, lang: 'en' });
  return { brain, said, capri, panel };
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

test('the answer is written into her panel as it arrives, then replaced by the whole one', async () => {
  const { brain, said, panel } = setup();
  brain.setAsk(true);
  brain.handle(prompt);
  brain.askDelta('**Ci**');
  assert.equal(said.at(-1).stream, true);
  assert.equal(said.at(-1).reply, 'Ci');
  panel.current = said.at(-1);
  brain.askDelta('**Ciao** mondo');
  assert.equal(panel.updated.at(-1), 'Ciao mondo'); // updated in place, not announced again
  assert.equal(said.filter((m) => m.stream).length, 1);
  await brain.handle(stop);
  assert.equal(said.at(-1).kind, 'done');
});

test('once you close the streaming panel it stays closed', () => {
  const { brain, said, panel } = setup();
  brain.setAsk(true);
  brain.askDelta('uno');
  panel.current = null; // closed by a click
  brain.askDelta('uno due');
  brain.askDelta('uno due tre');
  assert.equal(said.filter((m) => m.stream).length, 1);
  assert.equal(panel.updated.length, 0);
});

test('deltas are ignored when no question of hers is pending', () => {
  const { brain, said } = setup();
  brain.askDelta('niente');
  assert.equal(said.length, 0);
});

test('a router failure clears the pending flag', () => {
  const { brain } = setup();
  brain.askPending = true;
  brain.handle(prompt);
  brain.handle({ hook_event_name: 'StopFailure', session_id: 'router', error: 'boom' });
  assert.equal(brain.askPending, false);
});
