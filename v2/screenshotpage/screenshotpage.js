'use strict';

import Takescreenshot from './takescreenshot.js';
import { setupConnectButton, runWithSpinner, confirmLeaveWhileConnected, setupHowTo, showMessage } from '../common/ui.js';

const worker = new Takescreenshot();

const $ = (id) => document.getElementById(id);

const takeashotButton = $('takeashot-button');
const fetchDeviceInfoButton = $('fetchDeviceInfo-button');

const inputCommandText = $('command-input');
const delayTimeText = $('delay-input');
const inputBinaryBlockCheck = $('binaryBlock-check');
const yourDeviceTextarea = $('yourDevice-textarea');

function hex(value) {
  return Number(value).toString(16);
}

function checkMIMEType(data) {
  // https://stackoverflow.com/questions/18299806/how-to-check-file-mime-type-with-javascript-before-upload
  let arr = (new Uint8Array(data)).subarray(0, 4);
  let header = '';
  for (let i = 0; i < arr.length; i++) {
    header += arr[i].toString(16);
  }

  let blobtype = '';
  let ext = '';
  switch (header) {
    case '89504e47':
      blobtype = 'image/png';
      ext = 'png';
      break;
    case '47494638':
      blobtype = 'image/gif';
      ext = 'gif';
      break;
    case 'ffd8ffe0':
    case 'ffd8ffe1':
    case 'ffd8ffe2':
    case 'ffd8ffe3':
    case 'ffd8ffe8':
      blobtype = 'image/jpeg';
      ext = 'jpg';
      break;
    default:
      blobtype = 'unknown'; // Or you can use the blob.type as fallback
      break;
  }

  return { blobtype: blobtype, extension: ext };
}

function display(bytes, name) {
  if (!bytes || bytes.length === 0) {
    showMessage('warn', 'No image was received.',
      'Open the advanced settings and check the screenshot command and the wait time.');
    return;
  }

  const tmp = checkMIMEType(bytes);

  if (tmp.blobtype == 'unknown') {
    showMessage('warn', 'The instrument did not return an image.',
      'Open the advanced settings and check the screenshot command and the binary block setting.');
    return;
  }

  const blob = new Blob([bytes], { type: tmp.blobtype });

  const image = $('screenshot-image');
  window.URL.revokeObjectURL(image.src);
  image.src = window.URL.createObjectURL(blob);
  image.classList.remove('d-none');
  $('screen-empty').classList.add('d-none');

  const downloadLink = $('download-link');
  window.URL.revokeObjectURL(downloadLink.href);
  downloadLink.href = window.URL.createObjectURL(blob);
  downloadLink.target = '_blank';
  downloadLink.download = name + '.' + tmp.extension;
  downloadLink.classList.remove('disabled');
  downloadLink.removeAttribute('aria-disabled');
}

setupConnectButton({
  isOpen: () => worker.opened,
  open: async (device) => {
    await worker.open(device);
    inputCommandText.value = worker.command;
    delayTimeText.value = worker.delay;
    inputBinaryBlockCheck.checked = worker.isBinaryBlock;
    yourDeviceTextarea.value =
      'VID_' + hex(device.vendorId) + ' ' + 'PID_' + hex(device.productId) + '\n';
  },
  close: () => worker.close(),
});

takeashotButton.onclick = () => runWithSpinner(takeashotButton, async () => {
  // The settings are used only while the advanced settings are open.
  if ($('advanced').open) {
    worker.command = inputCommandText.value;
    worker.delay = delayTimeText.value;
    worker.isBinaryBlock = inputBinaryBlockCheck.checked;
  }

  const result = await worker.capture();
  display(result, worker.device.productName.replace(/\s/g, ''));
}, () => worker.opened);

fetchDeviceInfoButton.onclick = () => runWithSpinner(fetchDeviceInfoButton, async () => {
  const result = await worker.fetchDeviceInfo();
  yourDeviceTextarea.value =
    'VID_' + hex(worker.device.vendorId) + ' ' + 'PID_' + hex(worker.device.productId) + '\n' +
    '*IDN? => ' + result;
}, () => worker.opened);

confirmLeaveWhileConnected(() => worker.opened);
setupHowTo();
