"use client";

/**
 * Pipeline de publication on-chain en 4 étapes.
 *
 * PRINCIPE FONDAMENTAL : tout est on-chain, rien n'est stocké hors-chaîne.
 * Le programme source (HTML/JS/CSS) est encodé en base64 et stocké directement
 * dans l'état du contrat WorkRegistry via la fonction publish().
 * Il n'y a pas d'IPFS, pas de Pinata, pas de stockage externe.
 *
 * Le contrat WorkRegistry v2 stocke le contenu dans le champ `content`.
 * On y stocke un data URI :
 *   data:text/html;base64,<base64(htmlContent)>
 *
 * Seul le Rapporteur en exercice peut appeler publish() — le contrat
 * vérifie que msg.sender est le holder du rôle RAPPORTEUR dans AssociationCore.
 *
 * Ce pipeline est conçu pour être exécuté par un Normie-agent autonome.
 * En phase initiale (avant autonomie LLM), le Rapporteur humain utilise cette
 * interface. Le modèle de données ne changera pas lors de la bascule agent.
 */

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import {
  ASSOCIATION_CORE_ABI,
  WORK_REGISTRY_ABI,
  CONTRACT_ADDRESSES,
  ROLES,
} from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Constants ────────────────────────────────────────────────────────────────

const CORE_ADDR = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const WR_ADDR   = CONTRACT_ADDRESSES.WorkRegistry    as `0x${string}`;
const deployed  = !!CONTRACT_ADDRESSES.WorkRegistry;

// Limite de taille du programme source (Base est bon marché mais restons raisonnables)
const MAX_BYTES = 48_000; // ~48 KB

// ─── Default generative starter ───────────────────────────────────────────────

const STARTER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0A0A0A;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: 'Courier New', monospace;
    color: #F5F4EF;
  }
</style>
</head>
<body>
<canvas id="c" width="600" height="600"></canvas>
<script>
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  let t = 0;
  function draw() {
    ctx.fillStyle = 'rgba(10,10,10,0.04)';
    ctx.fillRect(0, 0, 600, 600);
    ctx.strokeStyle = \`hsl(\${(t * 0.4) % 360}, 55%, 62%)\`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 360; i++) {
      const r = 160 + Math.sin(i * 0.06 + t * 0.018) * 90;
      const x = 300 + r * Math.cos(i * Math.PI / 180);
      const y = 300 + r * Math.sin(i * Math.PI / 180);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    t++;
    requestAnimationFrame(draw);
  }
  draw();
</script>
</body>
</html>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function encodeOnchain(html: string): string {
  const b64 = btoa(unescape(encodeURIComponent(html)));
  return `data:text/html;base64,${b64}`;
}

function byteSize(s: string): number {
  return new Blob([s]).size;
}

// ─── Steps indicator ──────────────────────────────────────────────────────────

function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: "Identité" },
    { n: 2, label: "Programme" },
    { n: 3, label: "Preview" },
    { n: 4, label: "Publication" },
  ] as const;
  return (
    <div className="flex items-center gap-0 border border-[--border] overflow-hidden w-fit">
      {steps.map(({ n, label }, i) => (
        <div key={n} className="flex items-center">
          <div className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs ${
            n === current ? "bg-[--fg] text-[--bg]"
            : n < current ? "bg-[--bg-card] text-[--fg-muted]"
            : "text-[--fg-muted]"
          }`}>
            <span className={n < current ? "text-green-600" : ""}>
              {n < current ? "✓" : n}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </div>
          {i < steps.length - 1 && <div className="w-px h-9 bg-[--border]" />}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1 — Trio créatif ────────────────────────────────────────────────────

function Step1Identity({
  rapporteurTokenId,
  initAuthor,
  initCurator,
  onContinue,
}: {
  rapporteurTokenId: number;
  initAuthor:   number | null;
  initCurator:  number | null;
  onContinue: (author: number, curator: number) => void;
}) {
  const { data: memberIdsRaw } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds",
    query: { enabled: deployed },
  });
  const members = (memberIdsRaw as bigint[] | undefined)?.map(Number) ?? [];
  const candidates = members.filter(id => id !== rapporteurTokenId);

  const [author,  setAuthor]  = useState<number | null>(initAuthor);
  const [curator, setCurator] = useState<number | null>(initCurator);

  const MemberGrid = ({
    label, selected, onSelect,
  }: { label: string; selected: number | null; onSelect: (id: number) => void }) => (
    <div className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
        {label} {selected !== null ? `— #${selected}` : "— sélectionnez"}
      </p>
      <div className="flex flex-wrap gap-2">
        {candidates.map(id => (
          <button key={id} onClick={() => onSelect(id === selected ? -1 : id)}
            className={`relative w-14 h-14 border-2 overflow-hidden transition-all ${
              selected === id ? "border-[--fg] ring-2 ring-[--fg]/20" : "border-[--border] hover:border-[--fg]/50"
            }`}>
            <Image src={getNormieImageUrl(id)} alt={`#${id}`} fill
              className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold mb-2">Étape 1 — Trio créatif</h2>
        <p className="text-[--fg-muted] text-sm max-w-2xl">
          Définissez le trio Auteur / Curateur / Rapporteur. Le Rapporteur est le wallet
          connecté (il signe la transaction finale). L'identité esthétique de l'œuvre
          sera dérivée des traits de l'Auteur.
        </p>
      </div>

      {/* Rapporteur — fixe */}
      <div className="border border-[--border] bg-[--bg-card] p-4 flex items-center gap-4">
        <div className="relative w-14 h-14 shrink-0 overflow-hidden">
          <Image src={getNormieImageUrl(rapporteurTokenId)} alt={`#${rapporteurTokenId}`}
            fill className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
        </div>
        <div>
          <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-wider mb-0.5">Rapporteur</p>
          <p className="font-bold">#{rapporteurTokenId}</p>
          <p className="font-mono text-xs text-[--fg-muted]">Signataire — publiera l'œuvre on-chain</p>
        </div>
      </div>

      <MemberGrid label="Auteur" selected={author} onSelect={id => setAuthor(id === -1 ? null : id)} />
      <MemberGrid label="Curateur" selected={curator} onSelect={id => setCurator(id === -1 ? null : id)} />

      <button
        onClick={() => author !== null && curator !== null && onContinue(author, curator)}
        disabled={author === null || curator === null}
        className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-3 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Continuer → Programme source
      </button>
    </div>
  );
}

// ─── Step 2 — Programme source ────────────────────────────────────────────────

function Step2Program({
  initialCode, onContinue, onBack,
}: { initialCode: string; onContinue: (code: string) => void; onBack: () => void }) {
  const [code, setCode] = useState(initialCode || STARTER_HTML);
  const bytes  = byteSize(code);
  const tooBig = bytes > MAX_BYTES;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-2">Étape 2 — Programme source</h2>
        <p className="text-[--fg-muted] text-sm max-w-2xl">
          Le programme HTML/JS/CSS sera encodé en base64 et stocké <strong>directement dans le contrat</strong> sur Base.
          Pas d'IPFS, pas de serveur externe — le code est immuable et auto-exécutable depuis la chaîne.
          Taille max {(MAX_BYTES / 1024).toFixed(0)} KB ({"≈"}$
          {((bytes / 1024) * 0.001).toFixed(4)} de gas estimé sur Base).
        </p>
      </div>

      <div className="border border-[--border]">
        <div className="flex items-center justify-between px-3 py-2 bg-[--bg-card] border-b border-[--border]">
          <p className="font-mono text-xs text-[--fg-muted]">programme.html — stockage onchain</p>
          <button onClick={() => setCode(STARTER_HTML)} className="font-mono text-xs text-[--fg-muted] hover:text-[--fg]">
            ↺ template
          </button>
        </div>
        <textarea
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          className="w-full h-96 p-4 font-mono text-xs bg-[--bg] text-[--fg] resize-none focus:outline-none leading-relaxed"
        />
        <div className="flex items-center justify-between px-3 py-2 bg-[--bg-card] border-t border-[--border]">
          <p className={`font-mono text-xs ${tooBig ? "text-red-500" : "text-[--fg-muted]"}`}>
            {bytes.toLocaleString()} octets / {MAX_BYTES.toLocaleString()} max
            {tooBig && " — trop grand, réduisez le programme"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onBack} className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card]">← Retour</button>
        <button
          onClick={() => onContinue(code)}
          disabled={!code.trim() || tooBig}
          className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-2.5 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Continuer → Preview
        </button>
      </div>
    </div>
  );
}

// ─── Step 3 — Sandbox preview ─────────────────────────────────────────────────

function Step3Preview({
  code, onContinue, onBack,
}: { code: string; onContinue: () => void; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-2">Étape 3 — Validation</h2>
        <p className="text-[--fg-muted] text-sm max-w-2xl">
          Preview isolée du programme avant publication. Le code s'exécute exactement
          comme il sera rendu on-chain (sandbox <code className="bg-[--bg-card] px-1 text-xs">allow-scripts</code>
          , pas de réseau, pas d'accès DOM parent).
        </p>
      </div>

      <div className="border border-[--border]">
        <div className="flex items-center gap-2 px-3 py-2 bg-[--bg-card] border-b border-[--border]">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <p className="font-mono text-xs text-[--fg-muted]">Sandbox onchain — scripts ✓, réseau ✗, DOM parent ✗</p>
        </div>
        <iframe srcDoc={code} className="w-full h-[480px] border-0 bg-black"
          sandbox="allow-scripts" title="Preview sandbox" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onBack} className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card]">← Modifier</button>
        <button onClick={onContinue} className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-2.5 hover:opacity-80">
          Validé → Publication on-chain
        </button>
      </div>
    </div>
  );
}

// ─── Step 4 — Publication on-chain ───────────────────────────────────────────

function Step4Publish({
  code, authorTokenId, curatorTokenId, rapporteurTokenId, onBack,
}: {
  code: string; authorTokenId: number; curatorTokenId: number;
  rapporteurTokenId: number; onBack: () => void;
}) {
  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null);
  const [txState, setTxState] = useState<"idle" | "pending" | "confirming" | "done" | "error">("idle");
  const [txError, setTxError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  useEffect(() => {
    if (txConfirmed && txState === "confirming") setTxState("done");
  }, [txConfirmed, txState]);

  const dataUri  = encodeOnchain(code);
  const bytes    = byteSize(code);

  const publish = useCallback(async () => {
    setTxState("pending");
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address:      WR_ADDR,
        abi:          WORK_REGISTRY_ABI,
        functionName: "publish",
        args: [dataUri, BigInt(authorTokenId), BigInt(curatorTokenId), BigInt(rapporteurTokenId)],
      });
      setTxHash(hash);
      setTxState("confirming");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tx failed";
      setTxError(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 160));
      setTxState("error");
    }
  }, [dataUri, authorTokenId, curatorTokenId, rapporteurTokenId, writeContractAsync]);

  if (txState === "done") {
    return (
      <div className="border border-green-300 bg-green-50/30 px-8 py-12 text-center space-y-5">
        <p className="text-3xl">✓</p>
        <h2 className="text-2xl font-bold text-green-800">Œuvre publiée on-chain</h2>
        <p className="font-mono text-xs text-green-700 max-w-sm mx-auto leading-relaxed">
          Le programme est stocké de façon permanente dans le contrat WorkRegistry sur Base.
          Aucun serveur externe n'est impliqué.
        </p>
        {txHash && (
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            className="inline-block font-mono text-xs text-green-700 underline">
            Transaction Basescan ↗
          </a>
        )}
        <div className="pt-2">
          <a href="/works" className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80">
            Voir la galerie →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold mb-2">Étape 4 — Publication on-chain</h2>
        <p className="text-[--fg-muted] text-sm max-w-2xl">
          Le programme sera encodé en base64 et stocké directement dans le contrat WorkRegistry.
          Aucun upload, aucun service externe. Une seule transaction, permanent.
        </p>
      </div>

      {/* Résumé */}
      <div className="border border-[--border] p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Auteur",     tid: authorTokenId },
            { label: "Curateur",   tid: curatorTokenId },
            { label: "Rapporteur", tid: rapporteurTokenId },
          ].map(({ label, tid }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="relative w-10 h-10 shrink-0 overflow-hidden">
                <Image src={getNormieImageUrl(tid)} alt={`#${tid}`} fill
                  className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
              </div>
              <div>
                <p className="font-mono text-xs text-[--fg-muted]">{label}</p>
                <p className="font-mono text-xs font-bold">#{tid}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[--border] pt-3 space-y-1 font-mono text-xs text-[--fg-muted]">
          <div className="flex justify-between">
            <span>Contenu</span>
            <span>{bytes.toLocaleString()} octets → base64 → onchain</span>
          </div>
          <div className="flex justify-between">
            <span>Contrat</span>
            <span className="break-all">{WR_ADDR.slice(0,10)}…{WR_ADDR.slice(-6)}</span>
          </div>
          <div className="flex justify-between">
            <span>Réseau</span>
            <span>Base mainnet</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={publish}
          disabled={txState === "pending" || txState === "confirming"}
          className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-3 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {txState === "pending"    ? "Signez dans votre wallet…" :
           txState === "confirming" ? "Confirmation en cours…" :
           "Publier on-chain →"}
        </button>
        {txError && <p className="font-mono text-xs text-red-600">{txError}</p>}
        {txHash && txState === "confirming" && (
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-[--fg-muted] hover:underline">
            {txHash.slice(0, 16)}… ↗
          </a>
        )}
      </div>

      <button onClick={onBack} className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card]">
        ← Retour
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PublishClient() {
  const { address, isConnected } = useAccount();
  const [step,    setStep]    = useState<1 | 2 | 3 | 4>(1);
  const [code,    setCode]    = useState(STARTER_HTML);
  const [author,  setAuthor]  = useState<number | null>(null);
  const [curator, setCurator] = useState<number | null>(null);

  // Load pre-generated HTML from assembly creative section (sessionStorage)
  useEffect(() => {
    const stored = sessionStorage.getItem("ana_generated_html");
    if (stored) {
      setCode(stored);
      sessionStorage.removeItem("ana_generated_html");
    }
  }, []);

  const { data: rapporteurRaw } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "getRoleHolder",
    args: [ROLES.RAPPORTEUR],
    query: { enabled: deployed },
  });
  const rapporteur = rapporteurRaw as unknown as
    { tokenId: bigint; holderAddress: `0x${string}`; assignedAt: bigint } | undefined;

  const ZERO = "0x0000000000000000000000000000000000000000";
  const rapporteurAddress  = rapporteur?.holderAddress;
  const rapporteurTokenId  = rapporteur ? Number(rapporteur.tokenId) : null;
  const rolesResolved      = !!(rapporteurAddress && rapporteurAddress !== ZERO);
  const isRapporteur       = !!(isConnected && address && rapporteurAddress &&
    address.toLowerCase() === rapporteurAddress.toLowerCase());

  if (!deployed) return (
    <div className="py-24 text-center"><p className="font-mono text-xs text-[--fg-muted]">WorkRegistry non configuré.</p></div>
  );

  if (!isConnected) return (
    <div className="flex flex-col items-center justify-center py-24 gap-8 text-center">
      <h2 className="text-2xl font-bold">Connectez le wallet Rapporteur</h2>
      <p className="text-[--fg-muted] max-w-sm text-sm">
        Seul le Rapporteur élu peut publier. Le contrat vérifie <code>msg.sender</code> on-chain.
      </p>
      <ConnectButton />
    </div>
  );

  if (!rolesResolved) return (
    <div className="py-24 text-center max-w-lg mx-auto">
      <div className="border border-[--border] bg-[--bg-card] p-8 space-y-4">
        <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">En attente</p>
        <h2 className="text-2xl font-bold">Rôles non encore attribués</h2>
        <p className="text-[--fg-muted] text-sm leading-relaxed">
          L'assemblée constituante doit être clôturée avant que le Rapporteur puisse publier.
        </p>
        <a href="/assembly" className="inline-block font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80">
          Aller à l'assemblée →
        </a>
      </div>
    </div>
  );

  if (!isRapporteur) return (
    <div className="py-24 text-center max-w-lg mx-auto">
      <div className="border border-orange-300 bg-orange-50/30 p-8 space-y-4">
        <p className="font-mono text-xs text-orange-600 uppercase tracking-widest">Accès restreint</p>
        <h2 className="text-2xl font-bold">Wallet non-Rapporteur</h2>
        <p className="text-[--fg-muted] text-sm">
          {address?.slice(0,6)}…{address?.slice(-4)} n'est pas le Rapporteur en exercice.
        </p>
        <div className="border border-[--border] bg-[--bg] p-4 text-left space-y-1">
          <p className="font-mono text-xs text-[--fg-muted]">Rapporteur actuel</p>
          <p className="font-mono text-xs font-bold">#{rapporteurTokenId}</p>
          <p className="font-mono text-xs text-[--fg-muted] break-all">{rapporteurAddress}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-4xl">
      <Steps current={step} />
      {step === 1 && (
        <Step1Identity rapporteurTokenId={rapporteurTokenId!}
          initAuthor={author} initCurator={curator}
          onContinue={(a, c) => { setAuthor(a); setCurator(c); setStep(2); }} />
      )}
      {step === 2 && (
        <Step2Program initialCode={code}
          onContinue={c => { setCode(c); setStep(3); }}
          onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <Step3Preview code={code}
          onContinue={() => setStep(4)}
          onBack={() => setStep(2)} />
      )}
      {step === 4 && author !== null && curator !== null && rapporteurTokenId !== null && (
        <Step4Publish code={code}
          authorTokenId={author} curatorTokenId={curator}
          rapporteurTokenId={rapporteurTokenId}
          onBack={() => setStep(3)} />
      )}
    </div>
  );
}
