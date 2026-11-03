'use strict';

// What she needs to answer "where is X on my screen?", without Electron so it can be tested on its own:
// reading what uia.ps1 prints, deciding whether a screenshot is worth sending, and turning the answer
// (a control of the list, or a point of the screenshot) into a rectangle on the real screen.

const INTERACTIVE = new Set([
  'Button', 'SplitButton', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'Hyperlink', 'MenuItem',
  'TabItem', 'ListItem', 'TreeItem', 'Slider', 'Spinner', 'DataItem',
]);
// fewer usable controls than this and the app isn't telling us much (Chromium, games, canvases): a screenshot helps
const MIN_CONTROLS = 6;
const POINT_BOX = 56; // physical px: the box she points at when the answer is a single point of the screenshot

// uia.ps1 prints one json line.
// -> { ok: true, window: { title, process, rect: [x, y, w, h] }, elements: [...], truncated } | { ok: false, error }
function parseUia(output) {
  const line = String(output || '').replace(/^﻿/, '').trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) return { ok: false, error: 'I could not read that window.' };
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return { ok: false, error: 'I could not read that window.' };
  }
  if (!data || data.ok !== true || !Array.isArray(data.rect)) return { ok: false, error: 'I could not read that window.' };
  const elements = (Array.isArray(data.elements) ? data.elements : []).filter((e) => e && Number.isFinite(e.i));
  return {
    ok: true,
    window: { title: String(data.title || ''), process: String(data.process || ''), rect: data.rect.map(Number) },
    elements,
    truncated: Boolean(data.truncated),
  };
}

// desktop.ps1 prints one json line: the visible windows, front first.
// -> { ok: true, windows: [{ process, title, fg, min }] } | { ok: false, error }
function parseWindows(output) {
  const line = String(output || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).pop();
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return { ok: false, error: 'I could not see what is open.' };
  }
  if (!data || data.ok !== true || !Array.isArray(data.windows)) return { ok: false, error: 'I could not see what is open.' };
  const windows = data.windows
    .filter((w) => w && (w.process || w.title))
    .map((w) => ({ process: String(w.process || ''), title: String(w.title || ''), fg: Boolean(w.fg), min: Boolean(w.min) }));
  return { ok: true, windows };
}

// mode: 'auto' (only when the app shows few controls) | 'always' | 'never'
function needsImage(snapshot, mode = 'auto') {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return snapshot.elements.filter((e) => INTERACTIVE.has(e.t)).length < MIN_CONTROLS;
}

// The control to point at, or a point of the screenshot, as { x, y, w, h } on the real screen (physical px).
//   target: { source: 'uia', rect: [x, y, w, h] } | { source: 'image', x, y } | null
//   snapshot: { window: { rect }, image?: { size: [w, h] } }
function targetToScreenRect(target, snapshot) {
  if (!target) return null;
  if (target.source === 'uia' && Array.isArray(target.rect) && target.rect.length === 4) {
    const [x, y, w, h] = target.rect.map(Number);
    return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
  }
  if (target.source === 'image' && snapshot.image?.size && snapshot.window?.rect) {
    const [iw, ih] = snapshot.image.size;
    const [wx, wy, ww, wh] = snapshot.window.rect;
    if (!(iw > 0 && ih > 0 && ww > 0 && wh > 0) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    // the screenshot is the window scaled to fit: its pixels map linearly onto the window's rectangle
    const cx = wx + (target.x / iw) * ww;
    const cy = wy + (target.y / ih) * wh;
    return { x: Math.round(cx - POINT_BOX / 2), y: Math.round(cy - POINT_BOX / 2), w: POINT_BOX, h: POINT_BOX };
  }
  return null;
}

// What goes to the router: names and positions of the controls, the window's title and process, maybe the picture.
function toRequest(question, snapshot) {
  return {
    question,
    window: { title: snapshot.window.title, process: snapshot.window.process },
    elements: snapshot.elements,
    ...(snapshot.windows?.length ? { windows: snapshot.windows } : {}),
    ...(snapshot.image ? { image: snapshot.image.dataUrl, image_size: snapshot.image.size } : {}),
  };
}

module.exports = { parseUia, parseWindows, needsImage, targetToScreenRect, toRequest, INTERACTIVE, MIN_CONTROLS, POINT_BOX };
