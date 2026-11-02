'use strict';

// "Agent Events v1": what the personal router (Sistema_AI/capri_bridge.py) sends to /event.
// She reacts to them through the same pipeline as Claude Code's hooks, so this turns each one
// into the hook-shaped event the overlay already understands. Hook events pass through as they are.
//
//   request.start  { prompt, title }    a request begins: she goes to work
//   model.attempt  { model }            trying a model: ticker "router › model"
//   tool.call      { name, input }      a tool the agent ran
//   needs.confirm  { message }          it needs you (e.g. before editing a file): she comes to find you
//   done           { text }             the answer is complete
//   failed         { error }            the request failed

function toHookEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (typeof evt.hook_event_name === 'string') return evt;
  if (evt.v !== 1 || typeof evt.type !== 'string') return null;

  const base = { session_id: evt.session_id || 'default' };
  if (evt.cwd) base.cwd = evt.cwd;

  switch (evt.type) {
    case 'request.start':
      return { ...base, hook_event_name: 'UserPromptSubmit', prompt: evt.prompt, session_title: evt.title };
    case 'model.attempt':
      return { ...base, hook_event_name: 'PreToolUse', tool_name: `mcp__router__${evt.model}`, tool_input: {} };
    case 'tool.call':
      return { ...base, hook_event_name: 'PreToolUse', tool_name: evt.name, tool_input: evt.input || {} };
    case 'needs.confirm':
      return { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: evt.message };
    case 'done':
      return { ...base, hook_event_name: 'Stop', last_assistant_message: evt.text };
    case 'failed':
      return { ...base, hook_event_name: 'StopFailure', error: evt.error };
    default:
      return null;
  }
}

module.exports = { toHookEvent };
