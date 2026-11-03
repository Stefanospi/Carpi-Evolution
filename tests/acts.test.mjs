import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
const { ACTS, Player } = await import('../src/renderer/js/acting.js');
const capri = readFileSync(new URL('../src/renderer/js/capri.js', import.meta.url), 'utf8');

test('Edgerunners acts are well formed and every cue has a handler', () => {
  for (const name of ['sandevistan', 'sprint', 'psycho']) {
    const act = ACTS[name];
    assert.ok(act, name);
    const player = new Player(name, { dir: 1, at: 0 });
    assert.ok(player.total > 0);
    assert.equal(player.sample(player.total * (1000 / act.fps) + 1), null, `${name} ends`);
    for (const [hold, , cue] of act.keys) {
      assert.ok(hold >= 1);
      if (cue) assert.ok(capri.includes(`case '${cue}'`), `${name}: no handler for ${cue}`);
    }
  }
});
