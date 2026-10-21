// Run with: node --test v2/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Webusbtmc, { UsbtmcError, UsbtmcTimeoutError, UsbtmcProtocolError } from '../webusbtmc/webusbtmc.js';

const BULK_IN = 1;
const BULK_OUT = 2;
const INTERRUPT_IN = 3;

/** Minimal USBDevice stand-in. Responses to REQUEST_DEV_DEP_MSG_IN come from `onRequest`. */
class FakeDevice {
  constructor({ interfaceNumber = 0, packetSize = 64, interrupt = false, caps488 = 0x00, hasInterface = true } = {}) {
    this.opened = false;
    this.caps488 = caps488;
    this.packetSize = packetSize;
    const endpoints = [
      { endpointNumber: BULK_IN, direction: 'in', type: 'bulk', packetSize },
      { endpointNumber: BULK_OUT, direction: 'out', type: 'bulk', packetSize },
    ];
    if (interrupt) {
      endpoints.push({ endpointNumber: INTERRUPT_IN, direction: 'in', type: 'interrupt', packetSize: 8 });
    }
    this.configuration = {
      interfaces: [{
        interfaceNumber,
        alternates: [{
          alternateSetting: 0,
          interfaceClass: hasInterface ? 0xfe : 0xff,
          interfaceSubclass: 0x03,
          interfaceProtocol: 0x01,
          endpoints,
        }],
      }],
    };
    this.controlLog = [];
    this.outLog = [];        // { msgId, tag, tagInverse, transferSize, attributes, payload }
    this.requestSizes = [];  // sizes of REQUEST_DEV_DEP_MSG_IN
    this.halts = [];
    this.inQueue = [];
    this.interruptQueue = [];
    this.onRequest = null;   // (tag, size) => Uint8Array[] (packets)
    this.onControl = null;   // (setup, length) => number[] | undefined
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async selectConfiguration() { }
  async claimInterface() { }
  async selectAlternateInterface() { }
  async clearHalt(direction, endpointNumber) { this.halts.push([direction, endpointNumber]); }

  async controlTransferIn(setup, length) {
    this.controlLog.push(setup);
    let bytes = this.onControl ? this.onControl(setup, length) : undefined;
    if (bytes === undefined) {
      bytes = new Array(length).fill(0);
      bytes[0] = 0x01;
      if (setup.request === 0x07) {   // GET_CAPABILITIES
        bytes[3] = 0x01;              // bcdUSBTMC = 0x0100 (little endian)
        bytes[13] = 0x01;             // bcdUSB488 = 0x0100
        bytes[15] = this.caps488;
      }
    }
    return { status: 'ok', data: new DataView(new Uint8Array(bytes).buffer) };
  }

  async transferOut(endpointNumber, data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const message = {
      msgId: data[0],
      tag: data[1],
      tagInverse: data[2],
      transferSize: view.getUint32(4, true),
      attributes: data[8],
      payload: data.slice(12),
    };
    this.outLog.push(message);
    if (message.msgId === 0x02) {
      this.requestSizes.push(message.transferSize);
      if (this.onRequest) {
        this.inQueue.push(...this.onRequest(message.tag, message.transferSize));
      }
    }
    return { status: 'ok', bytesWritten: data.byteLength };
  }

  async transferIn(endpointNumber, length) {
    const queue = endpointNumber === INTERRUPT_IN ? this.interruptQueue : this.inQueue;
    if (queue.length === 0) {
      return new Promise(() => { });   // never completes -> timeout
    }
    const packet = queue.shift();
    return { status: 'ok', data: new DataView(packet.buffer, packet.byteOffset, packet.byteLength) };
  }

  /** Serves `bytes` like an instrument: each request returns up to the requested size. */
  stream(bytes) {
    let position = 0;
    this.onRequest = (tag, size) => {
      const chunk = bytes.slice(position, position + size);
      position += chunk.length;
      return packets(inMessage(tag, chunk, position >= bytes.length), this.packetSize);
    };
  }
}

function inMessage(tag, data, eom = true, { msgId = 0x02, transferSize = data.length } = {}) {
  const size = (12 + data.length + 3) & ~3;
  const message = new Uint8Array(size);
  const view = new DataView(message.buffer);
  message[0] = msgId;
  message[1] = tag;
  message[2] = ~tag & 0xFF;
  view.setUint32(4, transferSize, true);
  message[8] = eom ? 0x01 : 0x00;
  message.set(data, 12);
  return message;
}

function packets(bytes, packetSize) {
  const result = [];
  for (let i = 0; i < bytes.length; i += packetSize) {
    result.push(bytes.slice(i, i + packetSize));
  }
  return result;
}

const text = (string) => new TextEncoder().encode(string);
const decode = (bytes) => new TextDecoder().decode(bytes);

async function openTmc(options, setup) {
  const device = new FakeDevice(options);
  if (setup) setup(device);
  const tmc = new Webusbtmc();
  await tmc.open(device);
  return { tmc, device };
}

// ---------------------------------------------------------------------------
// open / close
// ---------------------------------------------------------------------------

test('open: uses the USBTMC interface number and decodes capabilities', async () => {
  const { tmc, device } = await openTmc({ interfaceNumber: 2 });
  const caps = device.controlLog.find((s) => s.request === 0x07);
  assert.equal(caps.index, 2);
  assert.equal(caps.recipient, 'interface');
  assert.equal(tmc.bcdUSBTMC, 0x0100);
  assert.equal(tmc.bcdUSB488, 0x0100);
  assert.equal(tmc.opened, true);
});

test('open: no USBTMC interface -> error and the device is closed again', async () => {
  const device = new FakeDevice({ hasInterface: false });
  const tmc = new Webusbtmc();
  await assert.rejects(tmc.open(device), UsbtmcError);
  assert.equal(device.opened, false);
  assert.equal(tmc.opened, false);
});

test('open: twice is rejected', async () => {
  const { tmc, device } = await openTmc();
  await assert.rejects(tmc.open(device), UsbtmcError);
});

test('open: REN_CONTROL / close: GO_TO_LOCAL when RL1 is supported', async () => {
  const { tmc, device } = await openTmc({ interfaceNumber: 1, caps488: 0x02 });
  const ren = device.controlLog.filter((s) => s.request === 160);
  assert.equal(ren.length, 1);
  assert.equal(ren[0].value, 1);
  assert.equal(ren[0].index, 1);

  await tmc.close();
  assert.ok(device.controlLog.some((s) => s.request === 161 && s.index === 1));
  const renAfterClose = device.controlLog.filter((s) => s.request === 160);
  assert.equal(renAfterClose.length, 2);
  assert.equal(renAfterClose[1].value, 0);
  assert.equal(device.opened, false);
  await tmc.close();   // idempotent
});

test('methods throw when the device is not open', async () => {
  const tmc = new Webusbtmc();
  await assert.rejects(tmc.readBytes(), UsbtmcError);
  await assert.rejects(tmc.writeBytes(text('x')), UsbtmcError);
  await assert.rejects(tmc.clear(), UsbtmcError);
});

test('Symbol.asyncDispose closes the device', async () => {
  const { tmc, device } = await openTmc();
  await tmc[Symbol.asyncDispose]();
  assert.equal(device.opened, false);
});

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

test('write: short command is one message with EOM and a terminator', async () => {
  const { tmc, device } = await openTmc();
  await tmc.write('*IDN?');
  assert.equal(device.outLog.length, 1);
  const message = device.outLog[0];
  assert.equal(message.msgId, 0x01);
  assert.equal(message.attributes & 0x01, 0x01);
  assert.equal(message.transferSize, 6);
  assert.equal(decode(message.payload.slice(0, 6)), '*IDN?\n');
  assert.equal(message.tagInverse, (~message.tag) & 0xFF);
});

test('write: long command is split, only the last message has EOM', async () => {
  const { tmc, device } = await openTmc();
  const command = 'X'.repeat(120);
  await tmc.write(command);
  assert.ok(device.outLog.length > 1);
  assert.deepEqual(device.outLog.map((m) => m.tag), device.outLog.map((_, i) => i + 1));
  device.outLog.forEach((m, i) => {
    assert.equal(m.attributes & 0x01, i === device.outLog.length - 1 ? 1 : 0);
  });
  const sent = device.outLog.map((m) => decode(m.payload.slice(0, m.transferSize))).join('');
  assert.equal(sent, command + '\n');
});

test('writeBlockData: builds "<cmd> #<n><len><data>\\n"', async () => {
  const { tmc, device } = await openTmc();
  await tmc.writeBlockData('DATA:UP', text('ABCD'));
  const sent = device.outLog.map((m) => decode(m.payload.slice(0, m.transferSize))).join('');
  assert.equal(sent, 'DATA:UP #14ABCD\n');
  await assert.rejects(tmc.writeBlockData('', text('x')), UsbtmcError);
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

test('read: single packet, only the trailing terminator is removed', async () => {
  const { tmc, device } = await openTmc();
  device.onRequest = (tag) => packets(inMessage(tag, text('a\nb\n')), 64);
  assert.equal(await tmc.read(), 'a\nb');
  assert.equal(device.requestSizes[0], 1024);
});

test('read: a response split over several packets is reassembled', async () => {
  const { tmc, device } = await openTmc();
  const payload = Uint8Array.from({ length: 150 }, (_, i) => i);
  device.onRequest = (tag) => packets(inMessage(tag, payload), 64);
  assert.deepEqual(await tmc.readBytes(1024), payload);
});

test('readBytes: continues with another request until EOM', async () => {
  const { tmc, device } = await openTmc();
  const replies = [
    (tag) => inMessage(tag, text('hello'), false),
    (tag) => inMessage(tag, text(' world'), true),
  ];
  device.onRequest = (tag) => packets(replies.shift()(tag), 64);
  assert.equal(decode(await tmc.readBytes(1024)), 'hello world');
  assert.deepEqual(device.requestSizes, [1024, 1019]);
});

test('readBytes: stops at `length` even without EOM', async () => {
  const { tmc, device } = await openTmc();
  device.onRequest = (tag, size) => packets(inMessage(tag, text('abcde').slice(0, size), false), 64);
  assert.equal(decode(await tmc.readBytes(5)), 'abcde');
  assert.deepEqual(device.requestSizes, [5]);
});

test('read: a leftover zero-length packet is skipped', async () => {
  const { tmc, device } = await openTmc();
  device.onRequest = (tag) => [new Uint8Array(0), ...packets(inMessage(tag, text('ok\n')), 64)];
  assert.equal(await tmc.read(), 'ok');
});

test('read: header validation', async () => {
  let { tmc, device } = await openTmc();
  device.onRequest = (tag) => packets(inMessage(tag + 1, text('x')), 64);
  await assert.rejects(tmc.read(), UsbtmcProtocolError);

  ({ tmc, device } = await openTmc());
  device.onRequest = (tag) => packets(inMessage(tag, text('x'), true, { msgId: 0x01 }), 64);
  await assert.rejects(tmc.read(), UsbtmcProtocolError);

  ({ tmc, device } = await openTmc());
  device.onRequest = (tag) => packets(inMessage(tag, text('x'), true, { transferSize: 5000 }), 64);
  await assert.rejects(tmc.read(16), UsbtmcProtocolError);

  ({ tmc, device } = await openTmc());
  device.onRequest = (tag) => [new Uint8Array(4)];
  await assert.rejects(tmc.read(), UsbtmcProtocolError);
});

test('read: query = write + read', async () => {
  const { tmc, device } = await openTmc();
  device.onRequest = (tag) => packets(inMessage(tag, text('KEYSIGHT\n')), 64);
  assert.equal(await tmc.query('*IDN?'), 'KEYSIGHT');
});

// ---------------------------------------------------------------------------
// timeout / abort
// ---------------------------------------------------------------------------

test('timeout: UsbtmcTimeoutError after INITIATE_ABORT_BULK_IN', async () => {
  const { tmc, device } = await openTmc({ interfaceNumber: 1 });
  await assert.rejects(tmc.read(1024, 20), UsbtmcTimeoutError);

  const initiate = device.controlLog.find((s) => s.request === 0x03);
  assert.equal(initiate.recipient, 'endpoint');
  assert.equal(initiate.index, 0x80 | BULK_IN);
  assert.equal(initiate.value, 1);   // bTag of the request that was aborted
  assert.ok(device.controlLog.some((s) => s.request === 0x04));
});

test('timeout: abort failure is attached as the cause', async () => {
  const { tmc, device } = await openTmc({}, (d) => {
    d.onControl = (setup) => (setup.request === 0x03 ? [0x81, 0x00] : undefined);
  });
  await assert.rejects(tmc.read(1024, 20), (error) => {
    assert.ok(error instanceof UsbtmcTimeoutError);
    assert.ok(error.cause instanceof UsbtmcProtocolError);
    return true;
  });
});

test('timeout: abort keeps polling while PENDING', async () => {
  let checks = 0;
  const { tmc, device } = await openTmc({}, (d) => {
    d.onControl = (setup) => {
      if (setup.request === 0x04) {
        checks++;
        return [checks < 3 ? 0x02 : 0x01, 0, 0, 0, 0, 0, 0, 0];
      }
      return undefined;
    };
  });
  await assert.rejects(tmc.read(1024, 20), UsbtmcTimeoutError);
  assert.equal(checks, 3);
});

// ---------------------------------------------------------------------------
// block data
// ---------------------------------------------------------------------------

test('readBlockData: returns the data and consumes the trailing terminator', async () => {
  const { tmc, device } = await openTmc();
  device.stream(text('#15hello\n'));
  assert.equal(decode(await tmc.readBlockData()), 'hello');
  assert.deepEqual(device.requestSizes, [1, 1, 1, 5, 64]);
});

test('readBlockData: skips bytes in front of "#"', async () => {
  const { tmc, device } = await openTmc();
  device.stream(text(' #15hello\n'));
  assert.equal(decode(await tmc.readBlockData()), 'hello');
});

test('readBlockData: no trailing request when the content message has EOM', async () => {
  const { tmc, device } = await openTmc();
  device.stream(text('#15hello'));
  assert.equal(decode(await tmc.readBlockData()), 'hello');
  assert.deepEqual(device.requestSizes, [1, 1, 1, 5]);
});

test('readBlockData: empty block and large block', async () => {
  let { tmc, device } = await openTmc();
  device.stream(text('#10\n'));
  assert.equal((await tmc.readBlockData()).length, 0);

  ({ tmc, device } = await openTmc());
  const payload = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  device.stream(new Uint8Array([...text('#41000'), ...payload, 0x0A]));
  assert.deepEqual(await tmc.readBlockData(), payload);
});

test('readBlockData: invalid headers throw', async () => {
  for (const response of ['#0abc\n', '#xabc\n', '#2zz\n', 'nothing\n']) {
    const { tmc, device } = await openTmc();
    device.stream(text(response));
    await assert.rejects(tmc.readBlockData(), UsbtmcError, response);
  }
});

// ---------------------------------------------------------------------------
// status byte / clear
// ---------------------------------------------------------------------------

test('readStatusByteRegister: uses the interface number and increments the tag', async () => {
  const { tmc, device } = await openTmc({ interfaceNumber: 3 }, (d) => {
    d.onControl = (setup) => (setup.request === 128 ? [0x01, setup.value, 0x40] : undefined);
  });
  assert.equal(await tmc.readStatusByteRegister(), 0x40);
  assert.equal(await tmc.readStatusByteRegister(), 0x40);
  const requests = device.controlLog.filter((s) => s.request === 128);
  assert.deepEqual(requests.map((s) => s.value), [2, 3]);
  assert.ok(requests.every((s) => s.index === 3));
});

test('readStatusByteRegister: bTag mismatch throws', async () => {
  const { tmc } = await openTmc({}, (d) => {
    d.onControl = (setup) => (setup.request === 128 ? [0x01, 99, 0x40] : undefined);
  });
  await assert.rejects(tmc.readStatusByteRegister(), UsbtmcProtocolError);
});

test('readStatusByteRegister: value comes from the Interrupt-IN endpoint when present', async () => {
  const { tmc, device } = await openTmc({ interrupt: true }, (d) => {
    d.onControl = (setup) => (setup.request === 128 ? [0x01, setup.value, 0x00] : undefined);
    d.interruptQueue.push(new Uint8Array([0x80 | 2, 0x51]));
  });
  assert.equal(await tmc.readStatusByteRegister(), 0x51);

  device.interruptQueue.push(new Uint8Array([0x80 | 99, 0x51]));
  await assert.rejects(tmc.readStatusByteRegister(), UsbtmcProtocolError);
});

test('clear: keeps polling while PENDING, then clears the Bulk-OUT halt', async () => {
  let checks = 0;
  const { tmc, device } = await openTmc({ interfaceNumber: 1 }, (d) => {
    d.onControl = (setup) => {
      if (setup.request === 0x06) {
        checks++;
        return [checks < 3 ? 0x02 : 0x01, 0x00];
      }
      return undefined;
    };
  });
  await tmc.clear();
  assert.equal(checks, 3);
  assert.deepEqual(device.halts, [['out', BULK_OUT]]);
  assert.ok(device.controlLog.filter((s) => s.request === 0x05 || s.request === 0x06).every((s) => s.index === 1));
});

test('clear: rejected INITIATE_CLEAR throws', async () => {
  const { tmc } = await openTmc({}, (d) => {
    d.onControl = (setup) => (setup.request === 0x05 ? [0x80] : undefined);
  });
  await assert.rejects(tmc.clear(), UsbtmcProtocolError);
});
