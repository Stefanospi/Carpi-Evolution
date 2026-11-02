'use strict';

// Talks to the personal AI router (Sistema_AI, `python server.py`): OpenAI-compatible,
// on 127.0.0.1. Plain Node, no Electron, so it can be tested on its own.
//
// The conversation lives in the router (a server-side session): each request carries only the new
// message and the session id, and the answer comes back as a stream so she can show it as it's written.

const TIMEOUT_MS = 120_000;
const SESSION = 'capri';

function createRouterClient({ getSettings, fetchImpl = globalThis.fetch }) {
  let busy = false;

  const endpoint = ({ url }, path) => `${url.replace(/\/+$/, '')}${path}`;
  const headersFor = ({ token }) => ({
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  // Forget the conversation on the router. -> true when it did.
  async function reset() {
    const s = getSettings();
    try {
      const res = await fetchImpl(endpoint(s, `/v1/sessions/${SESSION}/reset`), {
        method: 'POST',
        headers: headersFor(s),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Server-sent events: yields each "data:" payload as it arrives.
  async function* events(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let cut;
      while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (data) yield data;
      }
      if (done) break;
    }
  }

  // -> { ok: true, text } | { ok: false, kind, error, status? }
  //    kind: 'busy' | 'offline' | 'auth' | 'router' | 'empty'
  //    'router' means the router itself failed (quota, budget, every model down): it already told Capri.
  // onDelta(fullTextSoFar) is called as the answer arrives.
  async function ask(text, { onDelta } = {}) {
    if (busy) return { ok: false, kind: 'busy', error: 'Still working on the previous question.' };
    const settings = getSettings();
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(endpoint(settings, '/v1/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: headersFor(settings),
        body: JSON.stringify({
          model: settings.model,
          session: SESSION,
          stream: true,
          messages: [{ role: 'user', content: text }],
        }),
      });
      if (res.status === 401) return { ok: false, kind: 'auth', status: 401, error: 'Router token rejected (ROUTER_API_TOKEN).' };
      if (!res.ok) {
        const detail = await res.json().then((j) => j?.error?.message).catch(() => null);
        return { ok: false, kind: res.status >= 500 ? 'router' : 'auth', status: res.status, error: detail || `Router answered ${res.status}.` };
      }
      let answer = '';
      for await (const data of events(res.body)) {
        if (data === '[DONE]') break;
        let chunk;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) return { ok: false, kind: 'router', status: 502, error: chunk.error.message || 'The router failed.' };
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) {
          answer += piece;
          onDelta?.(answer);
        }
      }
      answer = answer.trim();
      if (!answer) return { ok: false, kind: 'empty', error: 'The router answered with no text.' };
      return { ok: true, text: answer };
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      return {
        ok: false,
        kind: 'offline',
        error: aborted ? 'The router took too long to answer.' : `Router unreachable at ${settings.url}: start it with "python server.py".`,
      };
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }

  return { ask, reset };
}

module.exports = { createRouterClient, SESSION };
