/**
 * pixelImage.ts — zero-dependency raw-grayscale-bytes → BMP data URI encoder.
 *
 * Used only to make a human-drawn pixel piece renderable in an <img> tag (the
 * work certificate, buildWorkHtml). The canonical data forwarded to
 * proof-of-draw stays the raw grayscale byte array, not this BMP wrapper —
 * BMP is just the simplest browser-renderable format writable without an
 * image codec dependency.
 */

// 24bpp, bottom-up, uncompressed BMP — the most universally supported variant,
// avoiding any 1bpp/8bpp-palette edge cases in browser decoders.
export function pixelsToBmpDataUri(pixels: Uint8Array, width: number, height: number): string {
  const rowSize        = Math.ceil((width * 3) / 4) * 4; // rows padded to 4 bytes
  const pixelArraySize = rowSize * height;
  const fileSize        = 54 + pixelArraySize;

  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER (14 bytes)
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);   // reserved
  buf.writeUInt32LE(54, 10); // pixel data offset

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive = bottom-up
  buf.writeUInt16LE(1, 26);     // planes
  buf.writeUInt16LE(24, 28);    // bits per pixel
  buf.writeUInt32LE(0, 30);     // BI_RGB, no compression
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);   // ~72 DPI
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const srcRow    = height - 1 - y; // bottom-up: this output row is image row (height-1-y)
    const rowOffset = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const v = pixels[srcRow * width + x] ?? 255;
      const o = rowOffset + x * 3;
      buf[o] = v; buf[o + 1] = v; buf[o + 2] = v; // grayscale: B=G=R
    }
    // trailing padding bytes are already zero from Buffer.alloc
  }

  return `data:image/bmp;base64,${buf.toString("base64")}`;
}
