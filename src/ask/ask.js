'use strict';

const input = document.getElementById('q');

function reset() {
  input.value = '';
  input.focus();
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.ask.hide();
  } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    window.ask.submit(text);
    input.value = '';
  }
});

window.ask.onShow(reset);
