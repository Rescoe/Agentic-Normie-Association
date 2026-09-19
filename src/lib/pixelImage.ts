/**
 * pixelImage.ts — zero-dependency raw-grayscale-bytes → BMP data URI encoder.
 *
 * Used to make a pixel piece renderable in an <img> tag (the work
 * certificate, buildWorkHtml) — including memorial certificates published
 * on-chain via WorkRegistry.publish()/ANAEditions.initialize(). The
 * canonical data forwarded to proof-of-draw stays the raw grayscale byte
 * array, not this BMP wrapper — BMP is just the simplest browser-renderable
 * format writable without an image codec dependency.
 */

// 1bpp, bottom-up, uncompressed BMP with a 2-color palette (black/white).
// Was 24bpp until 19/09/2026 — at the 264×176 memorial canvas that meant
// ~139KB raw / ~186KB base64 for an image that is inherently 1-bit (rasterize()
// in memorialArt.ts only ever writes 0 or 255). Embedded in a memorial's
// on-chain certificate (WorkRegistry.publish(), no explicit gas override —
// see workPublisher.ts), that pushed eth_estimateGas past what Base's public
// RPC will estimate, failing every single memorial publication with a raw
// "Transaction creation failed" and no revert reason. 1bpp brings the same
// image to ~6.4KB raw / ~8.5KB base64 — comfortably under the ~24KB budget
// documented in workPublisher.ts's initializeCollection() for its explicit
// 15M gas cap, and small enough for publishWork()'s default eth_estimateGas
// to succeed too.
export function pixelsToBmpDataUri(pixels: Uint8Array, width: number, height: number): string {
  const rowSize         = Math.ceil(width / 8 / 4) * 4; // 1bpp rows padded to 4 bytes
  const pixelArraySize  = rowSize * height;
  const paletteSize     = 8; // 2 entries × 4 bytes (B,G,R,reserved)
  const pixelDataOffset = 14 + 40 + paletteSize;
  const fileSize        = pixelDataOffset + pixelArraySize;

  const buf = Buffer.alloc(fileSize); // zero-filled — palette index 0 (black) needs no explicit write

  // BITMAPFILEHEADER (14 bytes)
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);               // reserved
  buf.writeUInt32LE(pixelDataOffset, 10);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive = bottom-up
  buf.writeUInt16LE(1, 26);     // planes
  buf.writeUInt16LE(1, 28);     // bits per pixel
  buf.writeUInt32LE(0, 30);     // BI_RGB, no compression
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);   // ~72 DPI
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(2, 46);     // colors used
  buf.writeUInt32LE(2, 50);     // colors important

  // Color palette (8 bytes at offset 54): index 0 = black (B=0,G=0,R=0 —
  // already zero from alloc), index 1 = white (B=G=R=0xFF at offset 58-60)
  buf[58] = 0xFF; buf[59] = 0xFF; buf[60] = 0xFF;

  for (let y = 0; y < height; y++) {
    const srcRow    = height - 1 - y; // bottom-up: this output row is image row (height-1-y)
    const rowOffset = pixelDataOffset + y * rowSize;
    for (let x = 0; x < width; x++) {
      const v = pixels[srcRow * width + x] ?? 255;
      if (v >= 128) { // white → set bit (palette index 1); black stays 0 (index 0)
        const byteIndex = rowOffset + (x >> 3);
        buf[byteIndex] |= 1 << (7 - (x % 8));
      }
    }
    // trailing padding bytes are already zero from Buffer.alloc
  }

  return `data:image/bmp;base64,${buf.toString("base64")}`;
}
