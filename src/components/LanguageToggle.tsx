"use client";

import { useState, useEffect, useRef } from "react";

const LANG_KEY = "ana-lang";

// Finds the Google Translate combo box and triggers a language change.
// Retries for up to ~5s in case the GT widget hasn't loaded yet.
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

export function LanguageToggle() {
  const [isEN, setIsEN]   = useState(false);
  const applied           = useRef(false);

  useEffect(() => {
    try {
      const pref = localStorage.getItem(LANG_KEY);
      if (pref === "en") {
        setIsEN(true);
        // Re-apply translation after GT widget loads (delayed)
        if (!applied.current) {
          applied.current = true;
          setTimeout(() => triggerGT("en"), 1200);
        }
      }
    } catch {}
  }, []);

  const switchToEN = () => {
    try { localStorage.setItem(LANG_KEY, "en"); } catch {}
    setIsEN(true);
    triggerGT("en");
  };

  const switchToFR = () => {
    try { localStorage.removeItem(LANG_KEY); } catch {}
    setIsEN(false);
    // Reset GT widget to original language
    triggerGT("");
    // GT sometimes needs a moment to reset properly
    setTimeout(() => {
      const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
      if (combo && combo.value !== "") {
        combo.value = "";
        combo.dispatchEvent(new Event("change"));
      }
    }, 300);
  };

  if (isEN) {
    return (
      <button
        onClick={switchToFR}
        title="Revenir à la version française"
        className="font-mono text-[11px] border border-[--border] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] px-2 py-1.5 transition-colors leading-none tracking-wide"
      >
        FR
      </button>
    );
  }

  return (
    <button
      onClick={switchToEN}
      title="Switch to English"
      className="font-mono text-[11px] border border-[--border] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] px-2 py-1.5 transition-colors leading-none tracking-wide"
    >
      EN
    </button>
  );
}
