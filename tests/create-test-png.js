const fs = require('fs');
const path = require('path');

function createMinimalPNG() {
  const width = 10;
  const height = 10;

  function crc32(buf) {
    let c;
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBuffer, data]);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 1 * 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0);
    for (let x = 0; x < width; x++) {
      rawData.push(255, 0, 0);
    }
  }
  const rawBuf = Buffer.from(rawData);

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawBuf);

  const iend = Buffer.alloc(0);

  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend),
  ]);

  const outPath = path.join(__dirname, 'test-logo.png');
  fs.writeFileSync(outPath, png);
  console.log(outPath);
  console.log('Size: ' + png.length);
}

createMinimalPNG();
