"use strict";

// The installed medal atlases are uncompressed 32-bit BGRA DDS images.
// Header layout: CCP trinityal/tests/WithValidRenderContextFixture.cpp60-87.
// Their actual headers specify R=00ff0000,G=0000ff00,B=000000ff,A=ff000000.
const { deflateSync, crc32 } = require("node:zlib");

function chunk(type, data) {
  const tag = Buffer.from(type, "ascii"), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); tag.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8);
  return out;
}

/** A PNG of the DDS's top mip, or null for a different DDS format. */
function dds32Png(data) {
  if (!Buffer.isBuffer(data) || data.length < 128 || data.toString("ascii", 0, 4) !== "DDS " || data.readUInt32LE(4) !== 124 || data.readUInt32LE(76) !== 32) return null;
  const flags = data.readUInt32LE(8), width = data.readUInt32LE(16), height = data.readUInt32LE(12);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || data.readUInt32LE(84) !== 0 || data.readUInt32LE(88) !== 32) return null;
  if ((data.readUInt32LE(80) & 0x41) !== 0x41 || data.readUInt32LE(92) !== 0xff0000 || data.readUInt32LE(96) !== 0xff00 || data.readUInt32LE(100) !== 0xff || data.readUInt32LE(104) !== 0xff000000) return null;
  // DDSD_PITCH supplies a row stride; DDSD_LINEARSIZE instead supplies the
  // whole surface size (the installed atlases use that latter spelling).
  const stride = flags & 8 ? data.readUInt32LE(20) : width * 4;
  if (stride < width * 4 || data.length < 128 + stride * height || data.readUInt32LE(112) !== 0) return null;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = 128 + y * stride + x * 4, to = y * (width * 4 + 1) + 1 + x * 4;
      scanlines[to] = data[from + 2]; scanlines[to + 1] = data[from + 1];
      scanlines[to + 2] = data[from]; scanlines[to + 3] = data[from + 3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}

module.exports = { dds32Png };
