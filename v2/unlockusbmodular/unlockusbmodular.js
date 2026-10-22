'use strict';

import { runWithSpinner, showMessage } from '../common/ui.js';

const unlockButton = document.getElementById('unlock');

const KEYSIGHT_VENDOR_ID = 0x0957;   // Keysight and Agilent

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function unlock() {
  let device;
  try {
    // Only Keysight (Agilent) instruments are listed in the dialog of the browser.
    device = await navigator.usb.requestDevice({ 'filters': [{ 'vendorId': KEYSIGHT_VENDOR_ID }] });
  } catch (error) {
    if (error.name !== 'NotFoundError') {   // NotFoundError: the dialog was closed without choosing
      throw error;
    }
    return;
  }

  // The instrument leaves the USB bus while it restarts. Watch for that.
  let hasLeft;
  const left = new Promise((resolve) => { hasLeft = resolve; });
  const onDisconnect = (event) => {
    if (event.device === device) {
      hasLeft(true);
    }
  };
  navigator.usb.addEventListener('disconnect', onDisconnect);

  try {
    await device.open();
    await device.claimInterface(device.configuration.interfaces[0].interfaceNumber);

    const data = new Uint8Array([0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
    try {
      await device.controlTransferOut({
        'requestType': 'vendor',
        'recipient': 'device',
        'request': 0x0C,
        'value': 0,
        'index': 0x475
      }, data);
    } catch (error) {
      // A lost device during the transfer is expected when the instrument restarted. Any other
      // failure, or a device that is still there, is a real error.
      const restarted = error.name === 'NetworkError' && await Promise.race([left, sleep(2000).then(() => false)]);
      if (!restarted) {
        throw error;
      }
    }
  } finally {
    navigator.usb.removeEventListener('disconnect', onDisconnect);
    try {
      await device.close();
    } catch (error) {
      // The instrument restarts after a successful switch, so it may already be gone.
    }
  }

  showMessage('ok', 'The instrument is switching to USBTMC mode.',
    'It restarts and appears as a new USB device. Wait a few seconds, then use it from the other samples.');
}

unlockButton.onclick = () => runWithSpinner(unlockButton, unlock, () => true);
