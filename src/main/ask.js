'use strict';

// "Ask the router": Ctrl+Alt+Space opens a small input box, the question goes to the personal
// AI router (Sistema_AI) and the answer comes back through Capri's panel.
//
// The router already tells Capri what it's doing (working, which model, done) over her bridge,
// so here we only: collect the text, keep the conversation, and make sure she shows the whole
// answer when it lands, and reacts if the router can't be reached at all.

const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { createRouterClient } = require('./router-client');

const WIDTH = 620;
const HEIGHT = 112;

function createAsk({ config, targetDisplay, sendEvent, sendCommand }) {
  let win = null;

  const settings = () => {
    const cfg = config.load();
    return {
      url: process.env.CAPRI_ROUTER_URL || cfg.routerUrl,
      model: cfg.askModel,
      token: process.env.ROUTER_API_TOKEN || cfg.routerToken,
    };
  };
  const client = createRouterClient({ getSettings: settings });

  function build() {
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#14101c',
      webPreferences: {
        preload: path.join(__dirname, '..', 'askPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadURL('capri://app/src/ask/ask.html');
    win.on('blur', () => hide());
    win.on('closed', () => { win = null; });
  }

  function place() {
    const { workArea } = targetDisplay();
    win.setPosition(
      Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      Math.round(workArea.y + workArea.height * 0.18),
    );
  }

  function hide() {
    if (win && win.isVisible()) win.hide();
  }

  function toggle() {
    if (!win) build();
    if (win.isVisible()) return hide();
    place();
    win.show();
    win.focus();
    win.webContents.send('ask:show');
  }

  const info = (message) => sendEvent({ hook_event_name: 'Notification', session_id: 'router', notification_type: 'info', message });
  const failure = (error) => sendEvent({ hook_event_name: 'StopFailure', session_id: 'router', error });

  async function submit(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    if (/^\/(reset|nuova)$/i.test(text)) {
      client.reset();
      info('Conversation cleared.');
      return;
    }
    sendCommand('ask', { on: true }); // her next answer is shown whole, wherever you are
    const result = await client.ask(text);
    if (result.ok) return; // the router already told her it was done (Stop event)
    sendCommand('ask', { on: false });
    // 'router' failures (every model down) already reached her as a StopFailure from the router
    if (result.kind !== 'router') failure(result.error);
  }

  function register() {
    ipcMain.on('ask:submit', (_e, text) => { hide(); submit(text); });
    ipcMain.on('ask:hide', hide);
  }

  return { toggle, register, reset: () => client.reset() };
}

module.exports = { createAsk };
