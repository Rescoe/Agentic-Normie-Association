"use client";

import { useState, useEffect } from "react";

interface Props {
  src:  string;
  alt:  string;
  className?: string;
}

export function ZoomableImage({ src, alt, className = "" }: Props) {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className={`w-full h-auto object-contain cursor-zoom-in ${className}`}
      />

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[200] bg-black/92 flex items-center justify-center p-4 cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-full max-w-full object-contain select-none"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setOpen(false)}
            aria-label="Fermer"
            className="absolute top-4 right-4 text-white/60 hover:text-white font-mono text-xs border border-white/20 px-3 py-1.5 hover:border-white/60 transition-colors"
          >
            ESC ×
          </button>
        </div>
      )}
    </>
  );
}
