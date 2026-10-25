'use strict';

// Talks to the personal AI router (Sistema_AI, `python server.py`): OpenAI-compatible,
// on 127.0.0.1. Plain Node, no Electron, so it can be tested on its own.
//
// The router in PROXY mode keeps no memory of its own (the client owns the history),
// so this keeps the conversation and sends all of it every time.

const MAX_HISTORY = 20; // messages kept (10 exchanges)
const TIMEOUT_MS = 120_000;

function createRouterClient({ getSettings, fetchImpl = globalThis.fetch }) {
  let history = [];
  let busy = false;

  function reset() {
    history = [];
  }

  // -> { ok: true, text } | { ok: false, kind, error, status? }
  //    kind: 'busy' | 'offline' | 'auth' | 'router' | 'empty'
  //    'router' means the router itself failed (every model down): it already told Capri.
  async function ask(text) {
    if (busy) return { ok: false, kind: 'busy', error: 'Still working on the previous question.' };
    const { url, model, token } = getSettings();
    busy = true;
    const messages = [...history, { role: 'user', content: text }].slice(-MAX_HISTORY);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ model, messages, stream: false }),
      });
      if (res.status === 401) return { ok: false, kind: 'auth', status: 401, error: 'Router token rejected (ROUTER_API_TOKEN).' };
      if (!res.ok) {
        const detail = await res.json().then((j) => j?.error?.message).catch(() => null);
        return { ok: false, kind: res.status >= 500 ? 'router' : 'auth', status: res.status, error: detail || `Router answered ${res.status}.` };
      }
      const data = await res.json();
      const answer = String(data?.choices?.[0]?.message?.content ?? '').trim();
      if (!answer) return { ok: false, kind: 'empty', error: 'The router answered with no text (tool call?).' };
      history = [...messages, { role: 'assistant', content: answer }].slice(-MAX_HISTORY);
      return { ok: true, text: answer };
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      return {
        ok: false,
        kind: 'offline',
        error: aborted ? 'The router took too long to answer.' : `Router unreachable at ${url}: start it with "python server.py".`,
      };
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }

  return { ask, reset, get history() { return history; } };
}

module.exports = { createRouterClient, MAX_HISTORY };
