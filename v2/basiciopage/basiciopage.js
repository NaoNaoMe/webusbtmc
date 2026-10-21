'use strict';

import Webusbtmc from '../webusbtmc/webusbtmc.js';
import { setConnectionState, showError, clearMessages, appendLog } from '../common/ui.js';

const worker = new Webusbtmc();

let deviceName;
let binaryFile;

const OutputTo = {
  Text: 'text',
  Image: 'image',
  Object: 'object',
};

const $ = (id) => document.getElementById(id);

const connectButton = $('connect-button');
const log = $('output-log');
const inputtext = $('input-text');
const writeButton = $('wr-button');
const readButton = $('rd-button');
const rstatusButton = $('rstatus-button');
const clearDeviceButton = $('clear-button');
const writeFileButton = $('wr-filebutton');
const clearTextButton = $('clear-text-button');

const spinnerWidget = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>';

function decimalToHex(d, padding = 2) {
  return Number(d).toString(16).padStart(padding, '0');
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

function print(result, kind = 'info') {
  if (!result) {
    return;
  }

  let text;
  if (typeof result === 'string' || result instanceof String) {
    text = result;
  }
  else {
    text = new TextDecoder().decode(result);
    const terminator = worker.terminatorRead;
    if (terminator && text.endsWith(terminator)) {
      text = text.slice(0, -terminator.length);
    }
  }

  appendLog(log, kind, text);
}

function showTab(id) {
  bootstrap.Tab.getOrCreateInstance($(id)).show();
}

function display(dir, result, name) {
  if (dir === OutputTo.Image) {

    const tmp = checkMIMEType(result);

    if (tmp.blobtype == 'unknown') {
      print('Unknown MIME type');
      return;
    }

    const blob = new Blob([result], { type: tmp.blobtype });
    const link = $('image-link');
    let blobURL = link.href;
    window.URL.revokeObjectURL(blobURL);
    blobURL = window.URL.createObjectURL(blob);
    link.href = blobURL;
    link.target = '_blank';
    link.download = name + '.' + tmp.extension;

    $('image-field').src = blobURL;

    $('image-empty').classList.add('d-none');
    $('image-area').classList.remove('d-none');

    print('Image data received');
    showTab('image-tab');
  }
  else if (dir === OutputTo.Object) {
    let blob = new Blob([result], { type: 'octet/stream' });
    const link = $('file-link');
    let blobURL = link.href;
    window.URL.revokeObjectURL(blobURL);
    blobURL = window.URL.createObjectURL(blob);
    link.href = blobURL;
    link.target = '_blank';
    link.download = name + '.bin';

    $('rcvd-length').textContent = result.byteLength + ' byte';

    $('object-empty').classList.add('d-none');
    $('object-area').classList.remove('d-none');

    print('Binary data received');
    showTab('object-tab');
  }
  else {
    print(result, 'rx');
  }
}

/** Shows a spinner on the button while the operation runs. Errors are shown in the page. */
async function run(button, operation) {
  const html = button.innerHTML;
  clearMessages();
  button.disabled = true;
  button.innerHTML = spinnerWidget + html;
  try {
    await operation();
  } catch (error) {
    console.error(error);
    showError(error);
  } finally {
    button.innerHTML = html;
    button.disabled = !worker.opened;
  }
}

connectButton.onclick = async () => {
  if (worker.opened) {
    try {
      await worker.close();
    } catch (error) {
      showError(error);
    }
    clearMessages();
    setConnectionState('off');
    return;
  }

  let device;
  try {
    const filters = [
      { 'classCode': 0xFE, 'subclassCode': 0x03, 'protocolCode': 0x01 },
    ];
    device = await navigator.usb.requestDevice({ 'filters': filters });
  } catch (error) {
    if (error.name !== 'NotFoundError') {   // NotFoundError: the dialog was closed without choosing
      showError(error);
    }
    return;
  }

  clearMessages();
  setConnectionState('busy');
  try {
    await worker.open(device);
    deviceName = worker.device.productName.replace(/\s/g, '');
    setConnectionState('on', {
      name: worker.device.productName,
      detail: 'VID ' + decimalToHex(device.vendorId, 4).toUpperCase() + ' · PID ' + decimalToHex(device.productId, 4).toUpperCase(),
    });
  } catch (error) {
    console.error(error);
    setConnectionState('err', { error: 'The instrument was found but could not be opened.' });
    showError(error);
  }
};

writeButton.onclick = () => run(writeButton, async () => {
  const text = inputtext.value;
  if ($('wr-type').value === 'binary' && binaryFile !== undefined && binaryFile !== null) {
    const buffer = new Uint8Array(binaryFile);

    if (text === '') {
      await worker.writeBytes(buffer);
      print('Data chunk was sent successfully');
    }
    else {
      await worker.writeBlockData(text, buffer);
      print('Binary data was sent successfully');
    }
  }
  else {
    if (text === '') {
      showError({ name: 'Empty', message: 'Enter a command first.' });
      return;
    }
    await worker.write(text);
    print(text, 'tx');
  }
});

readButton.onclick = () => run(readButton, async () => {
  let result;
  if ($('rd-type').value === 'binary') {
    result = await worker.readBlockData();
  }
  else {
    let length = parseInt($('rd-length').value);
    if (!(length > 0)) {
      length = 65535;
    }
    result = await worker.readBytes(length);
  }

  if (result.length == 0) {
    print('Received an empty response');
  }
  else {
    display($('rd-as').value, result, deviceName);
  }
});

rstatusButton.onclick = () => run(rstatusButton, async () => {
  const result = await worker.readStatusByteRegister();
  print('Status byte 0x' + decimalToHex(result).toUpperCase(), 'rx');
});

clearDeviceButton.onclick = () => run(clearDeviceButton, async () => {
  await worker.clear();
  print('Device cleared');
});

writeFileButton.onchange = (e) => {
  const file = e.target.files[0];
  if (file === undefined) {
    return;
  }
  const reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.onload = (readerEvent) => {
    binaryFile = readerEvent.target.result;
  };
};

clearTextButton.onclick = () => {
  log.innerHTML = '<div class="empty">Nothing yet. Connect, then write a command.</div>';
};

// The examples menu fills the command field.
for (const item of $('command-group').getElementsByClassName('dropdown-item')) {
  item.addEventListener('click', () => {
    inputtext.value = item.textContent;
    inputtext.focus();
  });
}

// Leaving the page closes the connection, so ask first while an instrument is connected.
window.addEventListener('beforeunload', (event) => {
  if (worker.opened) {
    event.preventDefault();
  }
});

setConnectionState('off');
