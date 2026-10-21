# webusbtmc v1

## A code example
You can read identifying information from an instrument using the following code:
~~~javascript
import Webusbtmc from './webusbtmc/webusbtmc.js';

async function funcAsync() {
  const tmc = new Webusbtmc();
  const filters = [
    { 'classCode': 0xFE, 'subclassCode': 0x03, 'protocolCode': 0x01 },
  ];
  const device = await navigator.usb.requestDevice({ 'filters': filters });
  await tmc.open(device);
  await tmc.write('*IDN?');
  await tmc.delay(0.1); // just in case
  const result = await tmc.read();
  console.log(result);
  await tmc.close();
}
~~~
