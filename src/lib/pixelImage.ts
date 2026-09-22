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

/**
 * Losslessly encodes a 1-bit pixel buffer (same 0=black/255=white
 * convention as pixelsToBmpDataUri) as a compact SVG markup fragment — one
 * <rect> per maximal axis-aligned run of black pixels, with horizontal runs
 * merged vertically across rows that repeat the exact same [x, width]
 * unchanged. Produces the identical visual result as the BMP encoder at any
 * scale (shape-rendering="crispEdges" keeps the hard pixel-art edges, no
 * anti-aliasing/smoothing), but pays only for what's actually drawn instead
 * of for every pixel of blank canvas — a plain-filled shape on an otherwise
 * empty canvas collapses to a single <rect>, matching one SSTORE-cheap
 * string instead of ~6.4KB of raw 1bpp bitmap regardless of composition.
 *
 * Returns a raw markup fragment (a <g> of <rect>s), not a data URI or a
 * standalone <svg> — meant to be spliced directly inside a nested <svg
 * viewBox="0 0 width height"> by the caller (ANAMemorials.sol's
 * tokenURI()), not wrapped in an <image href="..."> the way the BMP data
 * URI is. Only ever called with pixels this codebase generated itself
 * (memorialArt.ts's rasterize() output) — never with untrusted input, same
 * trust boundary as the title/cartel text passed alongside it.
 */
export function pixelsToRunLengthSvg(pixels: Uint8Array, width: number, height: number): string {
  type OpenRect = { x: number; w: number; yStart: number };
  type Run = { x: number; w: number };

  let active: OpenRect[] = [];
  const rects: string[] = [];

  const closeRect = (r: OpenRect, yEnd: number) => {
    rects.push(`<rect x="${r.x}" y="${r.yStart}" width="${r.w}" height="${yEnd - r.yStart}"/>`);
  };

  for (let y = 0; y < height; y++) {
    const runs: Run[] = [];
    let x = 0;
    while (x < width) {
      if ((pixels[y * width + x] ?? 255) < 128) {
        const start = x;
        while (x < width && (pixels[y * width + x] ?? 255) < 128) x++;
        runs.push({ x: start, w: x - start });
      } else {
        x++;
      }
    }

    const usedRun = new Set<number>();
    const stillActive: OpenRect[] = [];
    for (const r of active) {
      const idx = runs.findIndex((run, i) => !usedRun.has(i) && run.x === r.x && run.w === r.w);
      if (idx >= 0) { usedRun.add(idx); stillActive.push(r); } // unchanged run — keep extending
      else          { closeRect(r, y); }                       // this run ended before this row
    }
    runs.forEach((run, i) => {
      if (!usedRun.has(i)) stillActive.push({ x: run.x, w: run.w, yStart: y });
    });
    active = stillActive;
  }
  for (const r of active) closeRect(r, height);

  return `<g fill="#000" shape-rendering="crispEdges">${rects.join("")}</g>`;
}

/**
 * Picks whichever of the two lossless encodings is smaller for this specific
 * composition, and returns it alongside which one was picked (ANAMemorials.sol's
 * tokenURI() tells them apart by whether the string starts with "data:" —
 * BMP data URI vs raw SVG <g> fragment — see that contract's _buildImageDataUri()).
 *
 * The RLE/SVG encoder wins for the common case this generator is tuned for
 * ("a few deliberate, well-placed forms" per memorialArt.ts's own prompt) —
 * often 2-4x smaller. But it has a real pathological case: dense, high-entropy
 * regions (heavy use of the "dots" primitive over a large area) can produce
 * far MORE bytes than the fixed-cost BMP, since noise doesn't collapse into
 * runs. Rather than restrict what the LLM is allowed to compose, this just
 * measures both and keeps the cheaper one — on-chain storage cost is then
 * bounded by "never worse than today's BMP", with no cap on composition
 * richness.
 */
export function encodeArtworkContent(pixels: Uint8Array, width: number, height: number): string {
  const svg = pixelsToRunLengthSvg(pixels, width, height);
  const bmp = pixelsToBmpDataUri(pixels, width, height);
  return svg.length < bmp.length ? svg : bmp;
}
