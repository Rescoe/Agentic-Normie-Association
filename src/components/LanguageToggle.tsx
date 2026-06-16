"use client";

import { useState, useEffect } from "react";

// Strategy: the page is served in French (lang="fr").
// Modern browsers (Chrome, Edge, Safari) auto-offer their native translation bar.
// This button is a manual fallback for users whose browser didn't auto-translate,
// or who want to force EN via Google Translate.

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
  compact?: boolean;
}

export function LanguageToggle({ compact = false }: Props) {
  // null = unresolved (avoid hydration mismatch), true = user chose EN via GT
  const [isEN, setIsEN] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const pref = localStorage.getItem(LANG_KEY);
      if (pref === "en") {
        // User previously chose to manually translate — re-apply GT
        setIsEN(true);
        triggerGT("en");
      } else {
        // Default: stay in French, let the browser's native translation handle it
        setIsEN(false);
      }
    } catch {
      setIsEN(false);
    }
  }, []);

  const switchToEN = () => {
    try { localStorage.setItem(LANG_KEY, "en"); } catch {}
    setIsEN(true);
    triggerGT("en");
  };

  const switchToFR = () => {
    try { localStorage.removeItem(LANG_KEY); } catch {}
    setIsEN(false);
    triggerGT("");
    setTimeout(() => {
      const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
      if (combo && combo.value !== "") {
        combo.value = "";
        combo.dispatchEvent(new Event("change"));
      }
    }, 300);
  };

  const cls = [
    "font-mono border transition-colors leading-none tracking-wide",
    compact
      ? "text-[10px] px-1.5 py-1 border-[--border] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg]"
      : "text-[11px] px-2 py-1.5 border-[--border] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg]",
  ].join(" ");

  // Avoid rendering wrong state during SSR/hydration
  if (isEN === null) return null;

  if (isEN) {
    return (
      <button onClick={switchToFR} title="Voir en français" className={cls}>
        FR
      </button>
    );
  }

  return (
    <button onClick={switchToEN} title="Switch to English" className={cls}>
      EN
    </button>
  );
}
