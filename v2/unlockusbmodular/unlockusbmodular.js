'use strict';

import { runWithSpinner, showMessage } from '../common/ui.js';

const unlockButton = document.getElementById('unlock');

async function unlock() {
  const filters = [
    { 'classCode': 0x00, 'subclassCode': 0x00, 'protocolCode': 0x00 },
  ];

  let device;
  try {
    device = await navigator.usb.requestDevice({ 'filters': filters });
  } catch (error) {
    if (error.name !== 'NotFoundError') {   // NotFoundError: the dialog was closed without choosing
      throw error;
    }
    return;
  }

  try {
    await device.open();

    if (device.vendorId != 0x0957) {
      throw new Error('This is not a Keysight (Agilent) instrument.');
    }
    await device.claimInterface(device.configuration.interfaces[0].interfaceNumber);

    const data = new Uint8Array([0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
    await device.controlTransferOut({
      'requestType': 'vendor',
      'recipient': 'device',
      'request': 0x0C,
      'value': 0,
      'index': 0x475
    }, data);
  } finally {
    try {
      await device.close();
    } catch (error) {
      // The instrument restarts after a successful unlock, so it may already be gone.
    }
  }

  showMessage('ok', 'Unlocked.', 'The instrument restarts as a USBTMC device. Use it from the other samples.');
}

unlockButton.onclick = () => runWithSpinner(unlockButton, unlock, () => true);
