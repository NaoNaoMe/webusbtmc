// Small helpers shared by the samples: the connection bar, messages and the log.
// The page needs the elements #conn-dot, #conn-name, #conn-sub, #connect-button and #alerts.
'use strict';

const $ = (id) => document.getElementById(id);

const spinner = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>';

/**
 * Shows the state of the connection.
 * state: 'off' | 'busy' | 'on' | 'err'
 * Buttons marked with data-needs-connection are enabled only while connected.
 */
export function setConnectionState(state, { name = '', detail = '', error = '' } = {}) {
  const button = $('connect-button');
  const dot = $('conn-dot');
  dot.className = 'dot' + ({ on: ' ok', err: ' err', busy: ' busy' }[state] || '');

  const text = {
    off: ['Not connected', 'Connect an instrument with a USB cable.'],
    busy: ['Connecting…', 'Choose your instrument in the dialog of the browser.'],
    on: [name, detail],
    err: ['Could not connect', error],
  }[state];
  $('conn-name').textContent = text[0];
  $('conn-sub').textContent = text[1];

  button.disabled = state === 'busy';
  button.classList.toggle('btn-primary', state !== 'on');
  button.classList.toggle('btn-outline-secondary', state === 'on');
  button.innerHTML = {
    off: 'Connect',
    busy: spinner + 'Connecting',
    on: 'Disconnect',
    err: 'Try again',
  }[state];

  document.querySelectorAll('[data-needs-connection]').forEach((element) => {
    element.disabled = state !== 'on';
  });
}

/** Shows a message in the page. kind: 'err' | 'warn' */
export function showMessage(kind, title, body = '') {
  const box = document.createElement('div');
  box.className = 'msg ' + kind;
  box.setAttribute('role', 'alert');

  const icon = document.createElement('i');
  icon.className = 'bi ' + (kind === 'err' ? 'bi-exclamation-octagon-fill' : 'bi-exclamation-triangle-fill');
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('div');
  text.className = 'text';
  const heading = document.createElement('b');
  heading.textContent = title;
  text.append(heading);
  if (body) {
    text.append(body);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'x';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => box.remove());

  box.append(icon, text, close);
  $('alerts').replaceChildren(box);
}

export function clearMessages() {
  $('alerts').replaceChildren();
}

/** Turns an error of the driver or of WebUSB into a message a user can act on. */
export function showError(error) {
  const message = error && error.message ? error.message : String(error);

  switch (error && error.name) {
    case 'UsbtmcTimeoutError':
      showMessage('warn', 'No answer from the instrument.',
        'Write a command that ends with “?” first, then press Read. The connection can still be used.');
      break;
    case 'UsbtmcProtocolError':
      showMessage('err', 'The instrument answered in an unexpected way.', message);
      break;
    case 'NetworkError':
    case 'SecurityError':
      showMessage('err', 'The instrument could not be used.',
        'It may be used by another program. Close NI-VISA, Keysight IO Libraries or similar tools. On Windows the WinUSB driver is required.');
      break;
    default:
      showMessage('err', 'Something went wrong.', message);
  }
}

/** Adds a line to the log. kind: 'tx' (sent), 'rx' (received) or 'info'. */
export function appendLog(log, kind, text) {
  if (log.querySelector('.empty')) {
    log.replaceChildren();   // also drops the white space around the placeholder
  }

  const line = document.createElement('div');
  line.className = 'ln';
  const mark = document.createElement('span');
  mark.className = kind;
  mark.textContent = { tx: '→', rx: '←', info: '•' }[kind];
  const body = document.createElement('span');
  body.className = kind;
  body.textContent = text;
  line.append(mark, body);

  log.append(line);
  log.scrollTop = log.scrollHeight;
}
