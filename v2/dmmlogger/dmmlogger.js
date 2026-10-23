'use strict';

import Webusbtmc from '../webusbtmc/webusbtmc.js';
import { setupConnectButton, setConnectionState, showMessage, clearMessages, setupHowTo } from '../common/ui.js';
import { MEASUREMENTS, parseIdn, formatReading, formatDuration, configure, readValue } from './dmm.js';
import { buildCsv, parseCsv, summarize, fileStamp } from './csv.js';
import { runLogger } from './logger.js';
import { createChart } from './chart.js';

// The DMM logger: this file connects the page to the modules.
//   dmm.js     measurements, the number in an answer         csv.js     the file
//   logger.js  the loop with a steady interval               chart.js   the chart

const $ = (id) => document.getElementById(id);

const INTERVALS = [[500, '0.5 s'], [1000, '1 s'], [2000, '2 s'], [5000, '5 s'], [10000, '10 s'], [30000, '30 s'], [60000, '1 min']];
const SLOT_COUNT = 2;

const slots = Array.from({ length: SLOT_COUNT }, (_, i) => ({
  number: i + 1,
  prefix: `dmm${i + 1}-`,
  tmc: new Webusbtmc(),
  device: null,
  idn: null,
  connected: false,
  measurement: 'dcv',
  stats: null,   // while logging: { count, min, max, sum }
}));

const chart = createChart($('chart'));
let data = { columns: [], rows: [] };   // what the chart shows, live or from a file
let saved = true;                       // false while there are readings that are not in a file
let running = false;
let controller = null;
let skipped = 0;
let clearArmed = false;

const startButton = $('start-button');
const intervalSelect = $('interval-select');
const saveButton = $('save-button');
const clearButton = $('clear-button');
const openInput = $('open-input');

// ---------------------------------------------------------------------------------------------
// the cards

function cardHtml(slot) {
  const p = slot.prefix;
  const options = Object.entries(MEASUREMENTS).map(([key, { label }]) => `<option value="${key}">${label}</option>`).join('');
  const tile = (id, label) => `<div class="tile"><small>${label}</small><span id="${p}${id}">—</span></div>`;
  return `<section class="card-lite dmm${slot.number === 2 ? ' second' : ''}" id="${p}card">
    <div class="head">
      <div class="info">
        <span class="dot" id="${p}conn-dot"></span>
        <div style="min-width: 0">
          <div class="name" id="${p}conn-name">Not connected</div>
          <div class="sub" id="${p}conn-sub"></div>
        </div>
      </div>
      <button class="btn btn-primary" type="button" id="${p}connect-button">Connect</button>
    </div>
    <div class="fields">
      <div>
        <label class="field-label" for="${p}name">Name</label>
        <input class="form-control" id="${p}name" value="DMM ${slot.number}" maxlength="30" autocomplete="off" spellcheck="false">
      </div>
      <div>
        <label class="field-label" for="${p}measurement">Measurement</label>
        <select class="form-select" id="${p}measurement" data-needs-connection disabled>${options}</select>
      </div>
    </div>
    <div class="reading dim" id="${p}reading" aria-live="off">—</div>
    <div class="kv">${tile('min', 'Smallest')}${tile('max', 'Largest')}${tile('mean', 'Mean')}</div>
  </section>`;
}

const slotName = (slot) => $(`${slot.prefix}name`).value.trim() || `DMM ${slot.number}`;
const symbolOf = (slot) => MEASUREMENTS[slot.measurement].symbol;

function showReading(slot, result) {
  const element = $(`${slot.prefix}reading`);
  if (!result || 'error' in result) {
    element.textContent = '—';
  } else {
    element.textContent = result.value === null ? 'OVLD' : formatReading(result.value, symbolOf(slot));
  }
  element.classList.toggle('dim', !result || 'error' in result);
}

function showStats(slot, summary, symbol = symbolOf(slot)) {
  const text = (value) => (value === null ? '—' : formatReading(value, symbol));
  $(`${slot.prefix}min`).textContent = text(summary.min);
  $(`${slot.prefix}max`).textContent = text(summary.max);
  $(`${slot.prefix}mean`).textContent = text(summary.mean);
}

const noStats = { min: null, max: null, mean: null };

// ---------------------------------------------------------------------------------------------
// the connection of each card

async function connect(slot, device) {
  await slot.tmc.open(device);
  try {
    slot.idn = parseIdn(await slot.tmc.query('*IDN?'));
    const twin = slots.find((other) => other !== slot && other.connected && other.idn.serial !== '' &&
      other.idn.serial === slot.idn.serial && other.idn.model === slot.idn.model);
    if (twin) {
      throw Object.assign(new Error(`It is connected as “${slotName(twin)}”. Choose the other DMM.`), {
        title: 'This DMM is already connected.',
        summary: 'It is connected in the other card.',
      });
    }
    await applyMeasurement(slot);
  } catch (error) {
    await slot.tmc.close().catch(() => { });
    throw error;
  }
  slot.device = device;
  slot.connected = true;
  showReading(slot, null);
}

async function applyMeasurement(slot) {
  const result = await configure(slot.tmc, slot.measurement);
  if (!result.ok) {
    showMessage('warn', `${slotName(slot)} does not accept “${MEASUREMENTS[slot.measurement].label}”.`,
      `The DMM answered ${result.errors.join(' ')} Choose another measurement.`);
  }
}

for (const slot of slots) {
  $('cards').insertAdjacentHTML('beforeend', cardHtml(slot));
}
for (const slot of slots) {
  setupConnectButton({
    prefix: slot.prefix,
    isOpen: () => slot.connected,
    open: (device) => connect(slot, device),
    close: async () => {
      slot.connected = false;
      await slot.tmc.close();
    },
    onChange: updateControls,
    describe: (device) => ({
      name: slot.idn.model || device.productName || 'DMM',
      detail: slot.idn.serial ? `S/N ${slot.idn.serial}` : 'No serial number',
    }),
  });

  $(`${slot.prefix}measurement`).addEventListener('change', async (event) => {
    slot.measurement = event.target.value;
    showReading(slot, null);
    clearMessages();
    try {
      await applyMeasurement(slot);
    } catch (error) {
      showMessage('err', `${slotName(slot)} could not be set.`, error.message);
    }
  });
}

// Unplugging a DMM: the other one goes on, and what was read stays.
navigator.usb.addEventListener('disconnect', (event) => {
  const slot = slots.find((candidate) => candidate.connected && candidate.device === event.device);
  if (!slot) {
    return;
  }
  slot.connected = false;
  slot.tmc.close().catch(() => { });
  setConnectionState('off', {}, slot.prefix);
  showMessage('warn', `${slotName(slot)} was disconnected.`,
    running ? 'The readings of the other DMM go on. Its column stays empty from now on.' : '');
  showReading(slot, null);
  updateControls();
});

// ---------------------------------------------------------------------------------------------
// logging

function setStatus(text) {
  $('status').textContent = text;
}

function statusText() {
  const count = data.rows.length;
  const last = count > 0 ? formatDuration(data.rows[count - 1].elapsed) : '0:00';
  if (running) {
    return `Logging · ${count} readings · ${last}`;
  }
  return count > 0 ? `Stopped · ${count} readings · ${last}` : (slots.some((slot) => slot.connected) ? 'Ready.' : 'Connect a DMM to start.');
}

function showSkipped() {
  const note = $('skip-note');
  note.classList.toggle('d-none', skipped === 0);
  note.textContent = skipped === 0 ? '' :
    `${skipped} reading${skipped === 1 ? ' was' : 's were'} skipped because the DMM needed more time than the interval. Use a longer interval.`;
}

function addRow(row, active) {
  const values = row.results.map((result) => ('value' in result ? result.value : null));
  data.rows.push({ elapsed: row.elapsed, timestamp: row.timestamp, values });
  saved = false;
  clearArmed = false;

  active.forEach((slot, i) => {
    showReading(slot, row.results[i]);
    const value = values[i];
    if (value !== null) {
      const stats = slot.stats;
      stats.count++;
      stats.sum += value;
      stats.min = Math.min(stats.min, value);
      stats.max = Math.max(stats.max, value);
      showStats(slot, { min: stats.min, max: stats.max, mean: stats.sum / stats.count });
    }
  });
  chart.addRow({ elapsed: row.elapsed, values });
  setStatus(statusText());
  updateControls();
}

async function start() {
  const active = slots.filter((slot) => slot.connected);
  if (active.length === 0) {
    return;
  }
  if (data.rows.length > 0 && !saved) {
    showMessage('warn', 'The last readings are not saved.', 'Press Save CSV to keep them, or Clear to throw them away. Then start again.');
    return;
  }

  clearMessages();
  data = { columns: active.map((slot) => ({ name: slotName(slot), unit: MEASUREMENTS[slot.measurement].unit })), rows: [] };
  saved = true;
  skipped = 0;
  showSkipped();
  chart.setRows(data.columns, []);
  $('source-note').textContent = 'Logging. The readings are in this page only: save them as CSV before you leave.';
  for (const slot of slots) {
    slot.stats = { count: 0, min: Infinity, max: -Infinity, sum: 0 };
    showReading(slot, null);
    showStats(slot, noStats);
  }

  const readers = active.map((slot) => ({
    read: () => (slot.connected ? readValue(slot.tmc) : Promise.reject(new Error('Not connected'))),
  }));
  running = true;
  controller = new AbortController();
  setStatus(statusText());
  updateControls();

  try {
    await runLogger({
      readers,
      intervalMs: Number(intervalSelect.value),
      signal: controller.signal,
      onRow: (row) => addRow(row, active),
      onSkip: (count) => {
        skipped += count;
        showSkipped();
      },
    });
  } catch (error) {
    console.error(error);
    showMessage('err', 'Logging stopped.', error.message);
  } finally {
    running = false;
    controller = null;
    $('source-note').textContent = data.rows.length > 0 ? 'Stopped. Save the readings as CSV to keep them.' : 'The readings appear here.';
    setStatus(statusText());
    updateControls();
  }
}

startButton.addEventListener('click', () => {
  if (running) {
    controller.abort();
    startButton.disabled = true;
    startButton.textContent = 'Stopping…';
  } else {
    start();
  }
});

// ---------------------------------------------------------------------------------------------
// the file

function saveCsv() {
  const text = buildCsv(data.columns, data.rows);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const first = data.rows[0] && data.rows[0].timestamp;
  link.download = `dmmlog_${fileStamp(first ?? Date.now())}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  saved = true;
  updateControls();
}

async function openCsv(file) {
  let loaded;
  try {
    loaded = parseCsv(await file.text());
  } catch (error) {
    showMessage('err', 'This file cannot be shown.', error.message);
    return;
  }

  clearMessages();
  const columns = loaded.columns.slice(0, SLOT_COUNT);
  if (loaded.columns.length > SLOT_COUNT) {
    showMessage('warn', `Only the first ${SLOT_COUNT} DMM columns are shown.`, `The file has ${loaded.columns.length}.`);
  }
  data = { columns, rows: loaded.rows.map((row) => ({ ...row, values: row.values.slice(0, SLOT_COUNT) })) };
  saved = true;
  skipped = 0;
  showSkipped();
  chart.setRows(columns, data.rows);

  slots.forEach((slot, i) => {
    showReading(slot, null);
    const column = columns[i];
    const symbol = column ? ({ Ohm: 'Ω' }[column.unit] || column.unit) : '';
    showStats(slot, column ? summarize(data.rows.map((row) => row.values[i])) : noStats, symbol);
  });
  const last = data.rows.length > 0 ? formatDuration(data.rows[data.rows.length - 1].elapsed) : '0:00';
  $('source-note').textContent = `Showing “${file.name}”: ${data.rows.length} readings, ${last}.`;
  setStatus(statusText());
  updateControls();
}

openInput.addEventListener('change', async () => {
  const [file] = openInput.files;
  openInput.value = '';   // the same file can be chosen again
  if (file) {
    await openCsv(file);
  }
});
saveButton.addEventListener('click', saveCsv);

clearButton.addEventListener('click', () => {
  if (!saved && !clearArmed) {
    clearArmed = true;
    showMessage('warn', 'These readings are not saved.', 'Press Clear again to throw them away, or press Save CSV first.');
    return;
  }
  clearArmed = false;
  clearMessages();
  data = { columns: [], rows: [] };
  saved = true;
  skipped = 0;
  showSkipped();
  chart.setRows([], []);
  for (const slot of slots) {
    showReading(slot, null);
    showStats(slot, noStats);
  }
  $('source-note').textContent = 'The readings appear here. Open a CSV file of the logger to look at it without a DMM.';
  setStatus(statusText());
  updateControls();
});

// ---------------------------------------------------------------------------------------------

function updateControls() {
  const anyConnected = slots.some((slot) => slot.connected);
  startButton.disabled = !running && !anyConnected;
  startButton.className = `btn ${running ? 'btn-danger' : 'btn-primary'}`;
  startButton.innerHTML = running ? '<i class="bi bi-stop-fill me-1"></i>Stop' : '<i class="bi bi-play-fill me-1"></i>Start';
  intervalSelect.disabled = running;
  saveButton.disabled = data.rows.length === 0;
  clearButton.disabled = running || (data.rows.length === 0 && data.columns.length === 0);
  $('open-label').classList.toggle('disabled', running);
  openInput.disabled = running;
  for (const slot of slots) {
    $(`${slot.prefix}name`).disabled = running;
    $(`${slot.prefix}measurement`).disabled = running || !slot.connected;
  }
  if (!running) {
    setStatus(statusText());
  }
}

for (const [milliseconds, label] of INTERVALS) {
  intervalSelect.add(new Option(label, String(milliseconds), false, milliseconds === 1000));
}

// Leaving the page loses the readings and closes the connections, so ask first.
window.addEventListener('beforeunload', (event) => {
  if (running || (data.rows.length > 0 && !saved) || slots.some((slot) => slot.connected)) {
    event.preventDefault();
  }
});

setupHowTo();
updateControls();
