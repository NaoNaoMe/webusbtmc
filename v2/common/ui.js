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

/** Shows a message in the page. kind: 'err' | 'warn' | 'ok' */
export function showMessage(kind, title, body = '') {
  const box = document.createElement('div');
  box.className = 'msg ' + kind;
  box.setAttribute('role', 'alert');

  const icon = document.createElement('i');
  icon.className = 'bi ' + { err: 'bi-exclamation-octagon-fill', warn: 'bi-exclamation-triangle-fill', ok: 'bi-check-circle-fill' }[kind];
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

const usbtmcFilters = [
  { 'classCode': 0xFE, 'subclassCode': 0x03, 'protocolCode': 0x01 },
];

function hex4(value) {
  return Number(value).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Connects the Connect button of the page.
 *   isOpen():      true while an instrument is connected
 *   open(device):  connects to the chosen USB device (async)
 *   close():       disconnects (async)
 *   onChange(state): optional, called with 'off' | 'busy' | 'on' | 'err'
 */
export function setupConnectButton({ isOpen, open, close, onChange = () => { } }) {
  const button = $('connect-button');

  const change = (state, details) => {
    setConnectionState(state, details);
    onChange(state);
  };

  button.addEventListener('click', async () => {
    if (isOpen()) {
      try {
        await close();
      } catch (error) {
        showError(error);
      }
      clearMessages();
      change('off');
      return;
    }

    let device;
    try {
      device = await navigator.usb.requestDevice({ 'filters': usbtmcFilters });
    } catch (error) {
      if (error.name !== 'NotFoundError') {   // NotFoundError: the dialog was closed without choosing
        showError(error);
      }
      return;
    }

    clearMessages();
    change('busy');
    try {
      await open(device);
      change('on', {
        name: device.productName || 'USB instrument',
        detail: 'VID ' + hex4(device.vendorId) + ' · PID ' + hex4(device.productId),
      });
    } catch (error) {
      console.error(error);
      change('err', { error: 'The instrument was found but could not be opened.' });
      showError(error);
    }
  });

  change('off');
}

/** Shows a spinner on the button while `operation` runs. Errors are shown in the page. */
export async function runWithSpinner(button, operation, isOpen) {
  const html = button.innerHTML;
  clearMessages();
  button.disabled = true;
  button.innerHTML = spinner + html;
  try {
    await operation();
  } catch (error) {
    console.error(error);
    showError(error);
  } finally {
    button.innerHTML = html;
    button.disabled = !isOpen();
  }
}

/** Asks before the page is left while an instrument is connected (leaving closes the connection). */
export function confirmLeaveWhileConnected(isOpen) {
  window.addEventListener('beforeunload', (event) => {
    if (isOpen()) {
      event.preventDefault();
    }
  });
}
