"use client";

/**
 * Visual-only preview of how a memorial's artwork would look on each
 * proof-of-draw screen type — NOT the real per-screen byte buffer (that's
 * proof-of-draw's own server-side job, lib/screenEncode.ts, a separate repo).
 * This is CSS: each frame is sized to the real screen's aspect ratio and
 * uses object-fit:contain, the same letterboxing behavior PoD's own resize
 * now does server-side (see proof-of-draw's resizeLetterboxGrayscale) — close
 * enough for "what shape/crop will this be," which is the point of a preview.
 *
 * Dimensions mirror proof-of-draw's lib/screenProfiles.ts exactly (kept in
 * sync by hand — this repo doesn't import that one, deliberately, to avoid a
 * hard cross-deployment dependency for what is fundamentally a marketing/
 * preview feature, not a functional one).
 */
const SCREEN_PROFILES = [
  { id: "eink27bw",  name: "E-Ink 2.7\" BW",  width: 264, height: 176, bg: "#ffffff", note: "Black & white" },
  { id: "eink29bwr", name: "E-Ink 2.9\" BWR", width: 296, height: 128, bg: "#ffffff", note: "Black, white & red" },
  { id: "oled096",   name: "OLED 0.96\"",     width: 128, height: 64,  bg: "#000000", note: "Black & white, tiny" },
  { id: "tft18",     name: "TFT 1.8\"",       width: 128, height: 160, bg: "#ffffff", note: "Full color (portrait)" },
] as const;

export function ScreenPreviewGrid({ artworkText, title }: { artworkText?: string; title: string }) {
  if (!artworkText) return null;

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">
        Preview on proof-of-draw screens
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SCREEN_PROFILES.map(s => (
          <div key={s.id} className="space-y-1.5">
            <div
              className="border border-[--border] flex items-center justify-center overflow-hidden mx-auto"
              style={{
                aspectRatio: `${s.width} / ${s.height}`,
                backgroundColor: s.bg,
                maxWidth: s.width > s.height ? "100%" : `${Math.round(100 * s.width / s.height)}%`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artworkText}
                alt={`${title} — preview on ${s.name}`}
                className="w-full h-full"
                style={{ objectFit: "contain", imageRendering: "pixelated" }}
              />
            </div>
            <p className="font-mono text-[9px] text-[--fg-muted] text-center leading-tight">
              {s.name}<br />{s.width}×{s.height} · {s.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
