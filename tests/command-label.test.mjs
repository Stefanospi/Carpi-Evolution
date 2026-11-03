import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
const { commandLabel } = await import('../src/renderer/js/util.js');

test('shell commands read short', () => {
  assert.equal(commandLabel('npm test -- gigs'), 'npm test --');
  assert.equal(commandLabel('cd /repo && git push origin main'), 'git push origin');
  assert.equal(commandLabel('S="C:/Users/me/tmp/x" ; node "$S/tour.js" ok'), 'node tour.js ok');
  assert.equal(commandLabel('FOO=1 python -m pytest -q | tail -3'), 'python -m pytest');
  assert.equal(commandLabel(String.raw`C:\tools\ffmpeg.exe -i a.mp4`), 'ffmpeg.exe -i a.mp4');
  assert.equal(commandLabel(''), '');
});
