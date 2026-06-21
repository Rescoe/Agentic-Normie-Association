"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface ApiTryItProps {
  path:         string;
  paramName?:   string;
  paramDefault?: string;
  paramDesc?:   string;
}

export function ApiTryIt({ path, paramName, paramDefault = "", paramDesc }: ApiTryItProps) {
  const t = useTranslations("docsApiTryIt");
  const [paramValue, setParamValue] = useState(paramDefault);
  const [result,     setResult]     = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [status,     setStatus]     = useState<number | null>(null);

  // Builds the resolved API path (relative) — works on preview AND prod
  function buildRelativePath(): string {
    if (!paramName) return path;
    return path
      .replace("[id]",      paramValue || paramDefault)
      .replace("[address]", paramValue || paramDefault)
      .replace(/<[^>]+>/g,  paramValue || paramDefault);
  }

  const relativePath = buildRelativePath();
  // Absolute URL for the "Ouvrir" button — always uses current origin
  const absoluteUrl  = typeof window !== "undefined"
    ? `${window.location.origin}${relativePath}`
    : relativePath;

  const tryIt = async () => {
    setLoading(true);
    setResult(null);
    setStatus(null);
    try {
      const res  = await fetch(relativePath);
      setStatus(res.status);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/html")) {
        const text = await res.text();
        setResult(`[HTML — ${text.length} chars]\n${text.slice(0, 300)}…`);
      } else {
        const json = await res.json();
        setResult(JSON.stringify(json, null, 2));
      }
    } catch (e) {
      setResult(`${t("error")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 mt-3 border-t border-[--border] pt-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">{t("tryIt")}</p>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        {paramName && (
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-mono text-[10px] text-[--fg-muted] shrink-0">{paramName} =</span>
            <input
              type="text"
              value={paramValue}
              onChange={e => { setParamValue(e.target.value); setResult(null); }}
              placeholder={paramDefault || paramDesc}
              className="font-mono text-xs border border-[--border] bg-[--bg] text-[--fg] px-2 py-1 focus:outline-none focus:border-[--fg] w-32"
            />
          </div>
        )}

        <code className="font-mono text-[10px] text-[--fg-muted] flex-1 truncate hidden sm:block">
          {relativePath}
        </code>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={tryIt}
            disabled={loading}
            className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-3 py-1 hover:opacity-80 disabled:opacity-40 transition-opacity whitespace-nowrap"
          >
            {loading ? "…" : `▶ ${t("test")}`}
          </button>
          <a
            href={absoluteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs border border-[--border] text-[--fg-muted] hover:text-[--fg] px-3 py-1 transition-colors whitespace-nowrap"
          >
            ↗ {t("open")}
          </a>
        </div>
      </div>

      {result !== null && (
        <div className="relative">
          {status !== null && (
            <span className={`absolute top-2 right-2 font-mono text-[10px] border px-1.5 py-0.5 ${
              status >= 200 && status < 300
                ? "text-green-500 border-green-500/30 bg-green-950/20"
                : "text-red-400 border-red-400/30 bg-red-950/20"
            }`}>
              {status}
            </span>
          )}
          <pre className="bg-[--bg-card] border border-[--border] p-3 pr-16 font-mono text-[10px] text-[--fg-muted] leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap break-all">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
