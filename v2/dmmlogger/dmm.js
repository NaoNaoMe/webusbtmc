// What the logger needs to know about a DMM: the measurements, how to set one up and how to read
// a value. Nothing here touches the page. An `instrument` is anything with
// write(text) and query(text) that return promises (the Webusbtmc class of the driver).
'use strict';

// The standard SCPI commands of the DMMs of Keysight (Agilent). `unit` goes to the CSV file
// (ASCII only), `symbol` is shown in the page.
export const MEASUREMENTS = {
  dcv: { label: 'DC voltage', command: 'CONF:VOLT:DC AUTO', unit: 'V', symbol: 'V' },
  acv: { label: 'AC voltage', command: 'CONF:VOLT:AC AUTO', unit: 'V', symbol: 'V' },
  dci: { label: 'DC current', command: 'CONF:CURR:DC AUTO', unit: 'A', symbol: 'A' },
  aci: { label: 'AC current', command: 'CONF:CURR:AC AUTO', unit: 'A', symbol: 'A' },
  res: { label: 'Resistance (2-wire)', command: 'CONF:RES AUTO', unit: 'Ohm', symbol: 'Ω' },
  freq: { label: 'Frequency', command: 'CONF:FREQ', unit: 'Hz', symbol: 'Hz' },
  cap: { label: 'Capacitance', command: 'CONF:CAP', unit: 'F', symbol: 'F' },
};

// A DMM answers 9.9E37 when the input is over the range.
const OVERLOAD_LIMIT = 9e37;

/**
 * The number in the answer of READ?. Returns null for an overload.
 * Throws when the answer is not a number.
 */
export function parseReading(answer) {
  const first = String(answer).split(',')[0].trim();
  const value = Number(first);
  if (first === '' || !Number.isFinite(value)) {
    throw new Error(`The instrument answered “${String(answer).trim()}”, not a number.`);
  }
  return Math.abs(value) >= OVERLOAD_LIMIT ? null : value;
}

/** The answer of *IDN? as { maker, model, serial, firmware }. */
export function parseIdn(answer) {
  const [maker = '', model = '', serial = '', firmware = ''] = String(answer).trim().split(',').map((part) => part.trim());
  return { maker, model, serial, firmware };
}

const PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

/** 0.0234 and 'V' give “23.4000 mV”: six digits with the prefix that fits. */
export function formatReading(value, symbol) {
  if (value === null || value === undefined) {
    return '—';
  }
  if (value === 0) {
    return `0.00000 ${symbol}`;
  }
  const [scale, prefix] = PREFIXES.find(([limit]) => Math.abs(value) >= limit) || PREFIXES[PREFIXES.length - 1];
  return `${(value / scale).toPrecision(6)} ${prefix}${symbol}`;
}

/** 75 seconds as “1:15”, 3725 seconds as “1:02:05” (the hours can be more than 24). */
export function formatDuration(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Reads the errors of the instrument until the queue is empty (at most `limit`). */
async function readErrors(instrument, limit = 5) {
  const errors = [];
  for (let i = 0; i < limit; i++) {
    const answer = (await instrument.query('SYST:ERR?')).trim();
    if (/^[+-]?0\b/.test(answer)) {
      break;
    }
    errors.push(answer);
  }
  return errors;
}

/**
 * Sets up a measurement. Returns { ok: true } or { ok: false, errors } when the instrument does not
 * accept it (for example a DMM without a capacitance measurement).
 */
export async function configure(instrument, measurementKey) {
  const measurement = MEASUREMENTS[measurementKey];
  if (!measurement) {
    throw new Error(`Unknown measurement: ${measurementKey}`);
  }
  await instrument.write('*CLS');
  await instrument.write(measurement.command);
  const errors = await readErrors(instrument);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** One reading: a number, or null for an overload. */
export async function readValue(instrument, timeout = 10000) {
  return parseReading(await instrument.query('READ?', 1024, timeout));
}
