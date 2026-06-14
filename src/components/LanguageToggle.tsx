"use client";

import { useState, useEffect, useRef } from "react";

// ─── Default language is EN (translated). User can switch to FR (original). ───
// Storage key: absent or "en" → auto-translate to EN.
//              "fr"           → stay in French (original).

const LANG_KEY = "ana-lang";

function triggerGT(lang: string, attempts = 20) {
  const sel = document.querySelector<HTMLSelectElement>(".goog-te-combo");
  if (sel) {
    sel.value = lang;
    sel.dispatchEvent(new Event("change"));
    return;
  }
  if (attempts > 0) {
    setTimeout(() => triggerGT(lang, attempts - 1), 250);
  }
}

interface Props {
  /** Tighter padding for the mobile header slot */
  compact?: boolean;
}

export function LanguageToggle({ compact = false }: Props) {
  // true  = page is in French (user chose original)
  // false = page is translated to English (default)
  const [isFR, setIsFR]   = useState(false);
  const applied           = useRef(false);

  useEffect(() => {
    try {
      const pref = localStorage.getItem(LANG_KEY);
      if (!applied.current) {
        applied.current = true;
        if (pref === "fr") {
          // User explicitly chose French — actively reset GT to original
          setIsFR(true);
          setTimeout(() => triggerGT(""), 1200);
        } else {
          // Default (no pref or "en") → auto-translate to English
          setIsFR(false);
          setTimeout(() => triggerGT("en"), 1200);
        }
      }
    } catch {}
  }, []);

  const switchToFR = () => {
    try { localStorage.setItem(LANG_KEY, "fr"); } catch {}
    setIsFR(true);
    // Reset Google Translate to original language
    triggerGT("");
    setTimeout(() => {
      const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
      if (combo && combo.value !== "") {
        combo.value = "";
        combo.dispatchEvent(new Event("change"));
      }
    }, 300);
  };

  const switchToEN = () => {
    try { localStorage.removeItem(LANG_KEY); } catch {}
    setIsFR(false);
    triggerGT("en");
  };

  const cls = [
    "font-mono border transition-colors leading-none tracking-wide",
    compact
      ? "text-[10px] px-1.5 py-1 border-[--border] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg]"
      : "text-[11px] px-2 py-1.5 border-[--border] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg]",
  ].join(" ");

  if (isFR) {
    // Currently in French → offer to switch to English
    return (
      <button onClick={switchToEN} title="Switch to English" className={cls}>
        EN
      </button>
    );
  }

  // Currently in English (translated) → offer to revert to French
  return (
    <button onClick={switchToFR} title="Voir en français" className={cls}>
      FR
    </button>
  );
}
