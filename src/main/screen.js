'use strict';

// Looks at the window you were in when you asked (Windows only): its controls through UI Automation
// (names and positions, never field contents) and, only if the app shows few of them or you asked
// for it, a screenshot of that single window. Nothing is read until you ask.

const path = require('node:path');
const { execFile } = require('node:child_process');
const { desktopCapturer, screen } = require('electron');
const { parseUia, needsImage } = require('./screen-core');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'uia.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const MAX_ELEMENTS = 200;
const BUDGET_MS = 3500;
const MAX_EDGE = 1568; // longest side of the screenshot sent: what the model reads well, and fewer tokens

function createScreen({ getOverlayBounds }) {
  function uia(hwnd) {
    return new Promise((resolve) => {
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
        String(hwnd), String(MAX_ELEMENTS), String(BUDGET_MS),
      ], { windowsHide: true, timeout: BUDGET_MS + 8000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err && !stdout) {
          console.error('[capri] uia:', String(stderr || err.message).trim());
          return resolve({ ok: false, error: 'I could not look at that window.' });
        }
        resolve(parseUia(stdout));
      });
    });
  }

  // A picture of that one window (Capri herself is never in it), scaled down; null when it can't be taken.
  async function captureWindow(hwnd, rect) {
    const [, , w, h] = rect;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const size = { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
    try {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
      const source = sources.find((s) => s.id.split(':')[1] === String(hwnd));
      if (!source || source.thumbnail.isEmpty()) return null;
      const real = source.thumbnail.getSize();
      return { dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`, size: [real.width, real.height] };
    } catch (err) {
      console.error('[capri] screenshot:', err.message);
      return null;
    }
  }

  // -> { ok: true, window, elements, image | null } | { ok: false, error }
  async function snapshot(hwnd, imageMode = 'auto') {
    if (process.platform !== 'win32') return { ok: false, error: 'Looking at windows works on Windows only for now.' };
    const seen = await uia(hwnd);
    if (!seen.ok) return seen;
    const image = needsImage(seen, imageMode) ? await captureWindow(hwnd, seen.window.rect) : null;
    return { ...seen, image };
  }

  // physical screen pixels -> the overlay's coordinates (where she points)
  function toOverlayRect(rect) {
    const bounds = getOverlayBounds();
    const dip = screen.screenToDipRect(null, { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
    return { x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height };
  }

  return { snapshot, toOverlayRect };
}

module.exports = { createScreen };
