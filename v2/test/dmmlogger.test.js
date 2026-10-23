// Tests of the DMM logger: the readings, the CSV file and the loop. Run with: node --test (in the v2 folder)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASUREMENTS, parseReading, parseIdn, formatReading, formatDuration, configure, readValue } from '../dmmlogger/dmm.js';
import { buildCsv, parseCsv, summarize, isoLocal, fileStamp } from '../dmmlogger/csv.js';
import { runLogger } from '../dmmlogger/logger.js';

// ---------------------------------------------------------------------------------------------
// dmm.js

test('parseReading: numbers, the first of several, overload, no number', () => {
  assert.equal(parseReading('+1.23456E-03\n'), 0.00123456);
  assert.equal(parseReading('-5.0E+00'), -5);
  assert.equal(parseReading('1.5,2.5'), 1.5);
  assert.equal(parseReading('+9.90000000E+37\n'), null);
  assert.equal(parseReading('-9.90000000E+37'), null);
  assert.throws(() => parseReading('abc'), /not a number/);
  assert.throws(() => parseReading(''), /not a number/);
  assert.throws(() => parseReading('NaN'), /not a number/);
});

test('parseIdn', () => {
  assert.deepEqual(parseIdn('AGILENT TECHNOLOGIES,U2741A,MY56190019,1.14-1.08-1.06\n'),
    { maker: 'AGILENT TECHNOLOGIES', model: 'U2741A', serial: 'MY56190019', firmware: '1.14-1.08-1.06' });
  assert.deepEqual(parseIdn('only one'), { maker: 'only one', model: '', serial: '', firmware: '' });
});

test('formatReading: six digits with the prefix that fits', () => {
  assert.equal(formatReading(5.00012, 'V'), '5.00012 V');
  assert.equal(formatReading(0.0234, 'V'), '23.4000 mV');
  assert.equal(formatReading(-0.5, 'V'), '-500.000 mV');
  assert.equal(formatReading(1500, 'Ω'), '1.50000 kΩ');
  assert.equal(formatReading(2.5e-6, 'A'), '2.50000 µA');
  assert.equal(formatReading(0, 'V'), '0.00000 V');
  assert.equal(formatReading(null, 'V'), '—');
});

test('formatDuration: minutes and seconds, then hours', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(75.9), '1:15');
  assert.equal(formatDuration(3599), '59:59');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(72 * 3600), '72:00:00');
  assert.equal(formatDuration(-3), '0:00');
});

test('every measurement has a command, a label and units', () => {
  for (const [key, measurement] of Object.entries(MEASUREMENTS)) {
    assert.match(measurement.command, /^CONF:/, key);
    assert.ok(measurement.label && measurement.unit && measurement.symbol, key);
    assert.match(measurement.unit, /^[\x20-\x7e]+$/, `${key}: the unit of the file is ASCII`);
  }
});

class FakeInstrument {
  constructor({ rejects = [] } = {}) {
    this.sent = [];
    this.errors = [];
    this.rejects = rejects;   // the commands that make an error
    this.answer = '+1.0E+00\n';
  }
  async write(text) {
    this.sent.push(text);
    if (text === '*CLS') {
      this.errors = [];
    } else if (this.rejects.includes(text)) {
      this.errors.push('-113,"Undefined header"');
    }
  }
  async query(text, length, timeout) {
    this.sent.push(text);
    this.lastTimeout = timeout;
    if (text === 'SYST:ERR?') {
      return (this.errors.shift() ?? '+0,"No error"') + '\n';
    }
    return this.answer;
  }
}

test('configure: clears the errors, sends the command and checks the error queue', async () => {
  const instrument = new FakeInstrument();
  assert.deepEqual(await configure(instrument, 'dcv'), { ok: true });
  assert.deepEqual(instrument.sent, ['*CLS', 'CONF:VOLT:DC AUTO', 'SYST:ERR?']);
});

test('configure: an instrument that does not accept the measurement', async () => {
  const instrument = new FakeInstrument({ rejects: ['CONF:CAP'] });
  const result = await configure(instrument, 'cap');
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['-113,"Undefined header"']);
  await assert.rejects(() => configure(instrument, 'nothing'), /Unknown measurement/);
});

test('readValue asks READ? with the timeout and parses the answer', async () => {
  const instrument = new FakeInstrument();
  instrument.answer = '+2.5E-03\n';
  assert.equal(await readValue(instrument, 7000), 0.0025);
  assert.equal(instrument.lastTimeout, 7000);
  instrument.answer = '+9.9E+37\n';
  assert.equal(await readValue(instrument), null);
});

// ---------------------------------------------------------------------------------------------
// csv.js

test('isoLocal can be read back', () => {
  for (const milliseconds of [0, 1761207330123, 1750000000999, Date.UTC(2026, 11, 31, 23, 59, 59, 5)]) {
    const text = isoLocal(milliseconds);
    assert.match(text, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    assert.equal(Date.parse(text), milliseconds);
  }
});

test('fileStamp is the local time without separators', () => {
  const stamp = fileStamp(1761207330123);
  assert.match(stamp, /^\d{8}-\d{6}$/);
  const date = new Date(1761207330123);
  assert.equal(stamp.slice(0, 4), String(date.getFullYear()));
  assert.equal(stamp.slice(9, 11), String(date.getHours()).padStart(2, '0'));
});

const columns = [{ name: 'Supply', unit: 'V' }, { name: 'Load', unit: 'A' }];
const rows = [
  { elapsed: 0, timestamp: 1761207330123, values: [5.00012, 0.20031] },
  { elapsed: 1, timestamp: 1761207331124, values: [5.0001, null] },
  { elapsed: 2.5, timestamp: 1761207332630, values: [null, 0.2] },
];

test('buildCsv: the header and the lines', () => {
  const lines = buildCsv(columns, rows).split('\n');
  assert.equal(lines[0], 'Time (s),Date and time,Supply (V),Load (A)');
  assert.equal(lines[1], `0.000,${isoLocal(1761207330123)},5.00012,0.20031`);
  assert.equal(lines[2], `1.000,${isoLocal(1761207331124)},5.0001,`);
  assert.equal(lines[3], `2.500,${isoLocal(1761207332630)},,0.2`);
  assert.equal(lines[4], '');
});

test('what is saved is read again, with empty cells as null', () => {
  const loaded = parseCsv(buildCsv(columns, rows));
  assert.deepEqual(loaded.columns, columns);
  assert.equal(loaded.rows.length, 3);
  assert.deepEqual(loaded.rows.map((row) => row.values), rows.map((row) => row.values));
  assert.deepEqual(loaded.rows.map((row) => row.elapsed), [0, 1, 2.5]);
  assert.deepEqual(loaded.rows.map((row) => row.timestamp), rows.map((row) => row.timestamp));
});

test('names with commas, quotes and non-ASCII letters survive', () => {
  const odd = [{ name: 'Supply, "main"', unit: 'V' }, { name: '電源 (B)', unit: 'Ohm' }];
  const loaded = parseCsv(buildCsv(odd, [{ elapsed: 0, timestamp: 0, values: [1, 2] }]));
  assert.deepEqual(loaded.columns, odd);
});

test('parseCsv: a byte order mark, Windows line breaks, no clock column, bad lines', () => {
  const text = '﻿Time (s),Supply (V)\r\n0,1.5\r\n\r\nnot a number,2\r\n1,2.5\r\n2,abc\r\n';
  const loaded = parseCsv(text);
  assert.deepEqual(loaded.columns, [{ name: 'Supply', unit: 'V' }]);
  assert.deepEqual(loaded.rows.map((row) => row.elapsed), [0, 1, 2]);
  assert.deepEqual(loaded.rows.map((row) => row.values[0]), [1.5, 2.5, null]);
  assert.equal(loaded.rows[0].timestamp, null);
});

test('parseCsv: a column without a unit, columns in another order', () => {
  const loaded = parseCsv('Voltage,Date and time,Time (s)\n1.5,,3\n');
  assert.deepEqual(loaded.columns, [{ name: 'Voltage', unit: '' }]);
  assert.equal(loaded.rows[0].elapsed, 3);
  assert.deepEqual(loaded.rows[0].values, [1.5]);
});

test('parseCsv: files that are not from the logger', () => {
  assert.throws(() => parseCsv(''), /empty/);
  assert.throws(() => parseCsv('a,b\n1,2\n'), /“Time \(s\)” column/);
  assert.throws(() => parseCsv('Time (s),Date and time\n0,2026-01-01\n'), /no column with readings/);
});

test('summarize: count, smallest, largest and mean, without the empty ones', () => {
  assert.deepEqual(summarize([1, null, 3, 2]), { count: 3, min: 1, max: 3, mean: 2 });
  assert.deepEqual(summarize([null, null]), { count: 0, min: null, max: null, mean: null });
  assert.deepEqual(summarize([]), { count: 0, min: null, max: null, mean: null });
  // a log of three days at 0.5 seconds has half a million readings
  assert.equal(summarize(Array.from({ length: 600000 }, (_, i) => i)).max, 599999);
});

// ---------------------------------------------------------------------------------------------
// logger.js, with a clock that only moves when everything waits

class VirtualClock {
  constructor() {
    this.time = 0;
    this.timers = [];
  }
  now = () => this.time;
  sleep = (ms, signal) => new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve();
      return;
    }
    const timer = { at: this.time + ms, resolve };
    this.timers.push(timer);
    signal && signal.addEventListener('abort', () => {
      this.timers = this.timers.filter((t) => t !== timer);
      resolve();
    }, { once: true });
  });
  async runUntil(isDone) {
    for (;;) {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setImmediate(resolve));   // let the promises run
      }
      if (isDone() || this.timers.length === 0) {
        return;
      }
      this.timers.sort((a, b) => a.at - b.at);
      const timer = this.timers.shift();
      this.time = Math.max(this.time, timer.at);
      timer.resolve();
    }
  }
}

/** Runs the logger until `count` rows are there. */
async function logRows({ readers, intervalMs, count, clock = new VirtualClock() }) {
  const controller = new AbortController();
  const rows = [];
  const skips = [];
  let summary = null;
  const done = runLogger({
    readers, intervalMs, signal: controller.signal, now: clock.now, wallClock: () => 1000000, sleep: clock.sleep,
    onRow: (row) => { rows.push(row); if (rows.length >= count) controller.abort(); },
    onSkip: (n) => skips.push(n),
  }).then((result) => { summary = result; });
  await clock.runUntil(() => summary !== null);
  await done;
  return { rows, skips, summary, clock };
}

const reader = (clock, duration, value) => ({ read: async () => { await clock.sleep(duration); return typeof value === 'function' ? value() : value; } });

test('logger: one row per interval with the readings of all instruments', async () => {
  const clock = new VirtualClock();
  let n = 0;
  const { rows, skips, summary } = await logRows({
    clock, intervalMs: 1000, count: 5,
    readers: [reader(clock, 100, () => n++), reader(clock, 250, 7)],
  });
  assert.deepEqual(rows.map((row) => row.elapsed), [0, 1, 2, 3, 4]);
  assert.deepEqual(rows.map((row) => row.results[0].value), [0, 1, 2, 3, 4]);
  assert.ok(rows.every((row) => row.results[1].value === 7));
  assert.deepEqual(rows.map((row) => row.timestamp), [1000000, 1001000, 1002000, 1003000, 1004000]);
  assert.deepEqual(rows.map((row) => row.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(skips, []);
  assert.deepEqual(summary, { cycles: 5, skipped: 0 });
});

test('logger: the interval does not grow with the time of a reading', async () => {
  const clock = new VirtualClock();
  const { rows } = await logRows({ clock, intervalMs: 500, count: 6, readers: [reader(clock, 400, 1)] });
  assert.deepEqual(rows.map((row) => row.elapsed), [0, 0.5, 1, 1.5, 2, 2.5]);
});

test('logger: a reading that takes exactly the interval skips nothing', async () => {
  const clock = new VirtualClock();
  const { rows, skips } = await logRows({ clock, intervalMs: 1000, count: 4, readers: [reader(clock, 1000, 1)] });
  assert.deepEqual(rows.map((row) => row.elapsed), [0, 1, 2, 3]);
  assert.deepEqual(skips, []);
});

test('logger: an instrument that fails does not stop the others', async () => {
  const clock = new VirtualClock();
  const broken = { read: async () => { await clock.sleep(10); throw new Error('no answer'); } };
  const { rows } = await logRows({ clock, intervalMs: 1000, count: 3, readers: [reader(clock, 10, 2.5), broken] });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(row.results[0], { value: 2.5 });
    assert.equal(row.results[1].error.message, 'no answer');
    assert.ok(!('value' in row.results[1]));
  }
});

test('logger: an overload is a value of null, not an error', async () => {
  const clock = new VirtualClock();
  const { rows } = await logRows({ clock, intervalMs: 1000, count: 1, readers: [reader(clock, 10, null)] });
  assert.deepEqual(rows[0].results[0], { value: null });
});

test('logger: instruments that are too slow skip readings and are never asked twice at once', async () => {
  const clock = new VirtualClock();
  let busy = 0;
  let overlapped = false;
  const slow = {
    read: async () => {
      busy++;
      overlapped = overlapped || busy > 1;
      await clock.sleep(1500);
      busy--;
      return 1;
    },
  };
  const { rows, skips } = await logRows({ clock, intervalMs: 1000, count: 3, readers: [slow] });
  assert.deepEqual(rows.map((row) => row.elapsed), [0, 2, 4]);
  assert.deepEqual(skips.slice(0, 2), [1, 1]);
  assert.equal(overlapped, false);
});

test('logger: one slow reading at the start (auto range) only skips what it took', async () => {
  const clock = new VirtualClock();
  let calls = 0;
  const { rows, skips } = await logRows({ clock, intervalMs: 1000, count: 3, readers: [{ read: async () => { await clock.sleep(calls++ === 0 ? 2000 : 100); return 1; } }] });
  assert.deepEqual(rows.map((row) => row.elapsed), [0, 2, 3]);
  assert.deepEqual(skips, [1]);
});

test('logger: stopping while it waits ends at once', async () => {
  const clock = new VirtualClock();
  const { rows, summary } = await logRows({ clock, intervalMs: 600000, count: 1, readers: [reader(clock, 10, 1)] });
  assert.equal(rows.length, 1);
  assert.equal(summary.cycles, 1);
  assert.ok(clock.time < 1000, `the clock moved to ${clock.time}`);
});

test('logger: an aborted signal before the start reads nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const rows = [];
  const summary = await runLogger({ readers: [{ read: async () => 1 }], intervalMs: 1000, signal: controller.signal, onRow: (row) => rows.push(row) });
  assert.deepEqual(summary, { cycles: 0, skipped: 0 });
  assert.equal(rows.length, 0);
});

test('logger: with the real clock', async () => {
  const controller = new AbortController();
  const rows = [];
  await runLogger({
    readers: [{ read: async () => 1 }], intervalMs: 20, signal: controller.signal,
    onRow: (row) => { rows.push(row); if (rows.length === 4) controller.abort(); },
  });
  assert.equal(rows.length, 4);
  assert.ok(rows[3].elapsed >= 0.05 && rows[3].elapsed < 0.5, `elapsed ${rows[3].elapsed}`);
});
