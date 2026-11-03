'use strict';

// Talks to the personal AI router (Sistema_AI, `python server.py`): OpenAI-compatible,
// on 127.0.0.1. Plain Node, no Electron, so it can be tested on its own.
//
// The conversation lives in the router (a server-side session): each request carries only the new
// message and the session id, and the answer comes back as a stream so she can show it as it's written.

const TIMEOUT_MS = 120_000;
const SESSION = 'capri';

function unreachable({ url }, err) {
  return err?.name === 'AbortError' || err?.name === 'TimeoutError'
    ? 'The router took too long to answer.'
    : `Router unreachable at ${url}: start it with "python server.py".`;
}

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
      return { ok: false, kind: 'offline', error: unreachable(settings, err) };
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }

  // Convert a file locally (Python libraries on the router, no model). The result lands next to the original.
  // -> { ok: true, output } | { ok: false, kind: 'invalid' | 'auth' | 'router' | 'offline', error }
  //    'invalid' is a mistake of yours (unknown format, file not found...): the message says what to do.
  async function convert(path, to) {
    const s = getSettings();
    try {
      const res = await fetchImpl(endpoint(s, '/v1/convert'), {
        method: 'POST',
        headers: headersFor(s),
        body: JSON.stringify({ path, to }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) return { ok: false, kind: 'auth', error: 'Router token rejected (ROUTER_API_TOKEN).' };
      if (!res.ok) {
        const message = data?.error?.message || (Array.isArray(data?.detail) ? 'Invalid request.' : data?.detail);
        return { ok: false, kind: res.status < 500 ? 'invalid' : 'router', error: message || `Router answered ${res.status}.` };
      }
      return { ok: true, output: data.output };
    } catch (err) {
      return { ok: false, kind: 'offline', error: unreachable(s, err) };
    }
  }

  // Ask about a window: its controls (and maybe a screenshot) go to Claude, which picks one to point at.
  // -> { ok: true, text, target } | { ok: false, kind: 'auth' | 'router' | 'invalid' | 'offline', error }
  async function screenAsk(payload) {
    const s = getSettings();
    try {
      const res = await fetchImpl(endpoint(s, '/v1/screen/ask'), {
        method: 'POST',
        headers: headersFor(s),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) return { ok: false, kind: 'auth', error: 'Router token rejected (ROUTER_API_TOKEN).' };
      if (!res.ok) {
        const message = data?.error?.message || (Array.isArray(data?.detail) ? 'Invalid request.' : data?.detail);
        return { ok: false, kind: res.status >= 500 ? 'router' : 'invalid', status: res.status, error: message || `Router answered ${res.status}.` };
      }
      return { ok: true, text: String(data?.text || ''), target: data?.target || null };
    } catch (err) {
      return { ok: false, kind: 'offline', error: unreachable(s, err) };
    }
  }

  // -> the formats you can convert from and to ({ docx: ['pdf', ...] }), or null when the router is down
  async function formats() {
    const s = getSettings();
    try {
      const res = await fetchImpl(endpoint(s, '/v1/convert/formats'), { headers: headersFor(s), signal: AbortSignal.timeout(10_000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  return { ask, reset, convert, formats, screenAsk };
}

module.exports = { createRouterClient, SESSION };
