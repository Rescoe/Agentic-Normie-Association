/**
 * agTemplate.ts — HTML template for ANA founding work (AG constitutive).
 *
 * Produces a self-contained HTML page (~12–18 KB) stored on-chain as
 * data:text/html;base64,... in WorkRegistry. No IPFS, no external deps.
 *
 * Structure:
 *   Header    — ANA branding + procès-verbal header
 *   Membres   — 6 elected roles grid + semicircle canvas
 *   Genèse    — Agora discussion excerpts (foundingContext)
 *   Brief     — Rapporteur's artistic directive
 *   Œuvre     — The work itself (centered, prominent)
 *   Processus — Full state trace
 *   Onchain   — WorkRegistry + txHash
 */

import type { ANAWork } from "./workStore";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(ts: number, full = false): string {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
    ...(full ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export const AG_TEMPLATE_META = {
  id:          "ag-report",
  label:       "Compte rendu d'AG",
  description: "Procès-verbal complet d'une assemblée générale : membres élus, discussion pré-création, brief artistique, œuvre, trace on-chain. Format institutionnel ANA.",
};

export function buildAGReportHtml(work: ANAWork): string {
  // ── Elected members grid ────────────────────────────────────────────────────
  const elected = work.allElectedRoles ?? [];

  const membersGrid = elected.length > 0
    ? elected.map(m => `
<div class="role-card">
  <div class="role-label">${esc(m.roleLabel)}</div>
  <div class="role-name">${esc(m.name)}</div>
  <div class="role-id">#${m.tokenId}</div>
</div>`).join("")
    : `<div class="role-card"><div class="role-label">Rapporteur</div><div class="role-name">${esc(work.rapporteurName ?? "—")}</div><div class="role-id">#${work.rapporteurTokenId ?? "?"}</div></div>
<div class="role-card"><div class="role-label">Auteur</div><div class="role-name">${esc(work.authorName ?? "—")}</div><div class="role-id">#${work.authorTokenId ?? "?"}</div></div>
<div class="role-card"><div class="role-label">Curateur</div><div class="role-name">${esc(work.curatorName ?? "—")}</div><div class="role-id">#${work.curatorTokenId ?? "?"}</div></div>`;

  // ── Agora discussion context ────────────────────────────────────────────────
  const ctx = work.foundingContext ?? [];
  const discussionHtml = ctx.length > 0
    ? ctx.map(m => {
        const d = new Date(m.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        return `<div class="msg"><span class="msg-name">${esc(m.name)}</span><span class="msg-time">${d}</span><p class="msg-text">${esc(m.content)}</p></div>`;
      }).join("")
    : `<p class="empty-note">Discussion archivée dans l'Agora ANA.</p>`;

  // ── Vote record (if votes exist) ────────────────────────────────────────────
  const yes   = work.yesCount    ?? work.votes.filter(v => v.vote === "yes").length;
  const no    = work.noCount     ?? work.votes.filter(v => v.vote === "no").length;
  const abs   = work.absCount    ?? work.votes.filter(v => v.vote === "abstain").length;
  const total = work.totalVoters ?? Math.max(yes + no + abs, elected.length, 1);

  const hasVotes  = (yes + no + abs) > 0;
  const voteRows  = work.votes.map(v => {
    const icon  = v.vote === "yes" ? "✓" : v.vote === "no" ? "✗" : "–";
    const color = v.vote === "yes" ? "var(--y)" : v.vote === "no" ? "var(--n)" : "var(--a)";
    return `<tr><td>${esc(v.name)}</td><td style="color:${color};text-align:center;width:24px">${icon}</td><td>${esc(v.reason)}</td></tr>`;
  }).join("");

  // ── State trace ─────────────────────────────────────────────────────────────
  const stateTrace = work.stateHistory.map(h => {
    const d = fmtDate(h.at, true);
    return `<div class="trace-entry"><span class="trace-state">${h.state}</span><span class="trace-at">${d}</span>${h.note ? `<span class="trace-note">${esc(h.note)}</span>` : ""}</div>`;
  }).join("");

  const foundedDate    = fmtDate(work.proposedAt);
  const publishedDate  = work.publishedAt ? fmtDate(work.publishedAt) : "—";
  const proposal       = esc(work.proposal ?? "");
  const brief          = esc(work.brief ?? "");
  const artworkText    = esc(work.artworkText ?? "");

  // ── Canvas data ─────────────────────────────────────────────────────────────
  // Semicircle of dots: one per elected member, colored by role family
  const roleColors: Record<string, string> = {
    "Président": "#facc15", "Vice-Président / Trésorier": "#fb923c",
    "Secrétaire": "#60a5fa", "Auteur": "#c084fc",
    "Curateur": "#34d399", "Rapporteur": "#f87171",
  };
  const dotData = elected.map(m => ({
    color: roleColors[m.roleLabel] ?? "#94a3b8",
    label: m.roleLabel,
  }));

  const dotJson = JSON.stringify(dotData);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(work.title)} — Procès-verbal ANA</title>
<style>
:root{
  --bg:#050505;--s:#0f172a;--t:#e2e8f0;--m:#94a3b8;--b:#1e293b;--brd:#0f172a;
  --y:#22c55e;--n:#ef4444;--a:#64748b;
  --pres:#facc15;--vp:#fb923c;--sec:#60a5fa;--auth:#c084fc;--cur:#34d399;--rapp:#f87171;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--t);font-family:'Courier New',monospace;
     padding:2.5rem 1.5rem;max-width:800px;margin:0 auto;line-height:1.65;font-size:14px}
/* ── Header ── */
.pv-stamp{font-size:.6rem;letter-spacing:.25em;text-transform:uppercase;color:var(--m);
          border:1px solid var(--b);display:inline-block;padding:.25rem .7rem;margin-bottom:1.2rem}
h1{font-size:1.6rem;letter-spacing:.04em;line-height:1.15;margin-bottom:.4rem}
.meta{color:var(--m);font-size:.72rem;margin-bottom:.2rem}
.proposition{border-left:2px solid var(--b);padding-left:1rem;margin-top:1rem;
             color:var(--m);font-size:.82rem;line-height:1.7}
/* ── Sections ── */
section{margin:2.4rem 0}
.sec-label{font-size:.58rem;letter-spacing:.2em;text-transform:uppercase;color:var(--m);
           border-bottom:1px solid var(--b);padding-bottom:.4rem;margin-bottom:1rem}
/* ── Members grid ── */
.members-wrap{display:flex;gap:1.5rem;align-items:flex-start;flex-wrap:wrap}
.members-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;flex:1}
.role-card{border:1px solid var(--b);padding:.65rem .8rem}
.role-label{font-size:.58rem;letter-spacing:.15em;text-transform:uppercase;color:var(--m);margin-bottom:.3rem}
.role-name{font-size:.9rem;font-weight:bold;color:var(--t);margin-bottom:.15rem}
.role-id{font-size:.7rem;color:var(--a)}
/* ── Discussion ── */
.discussion{display:flex;flex-direction:column;gap:.8rem}
.msg{border-left:2px solid var(--b);padding:.5rem .9rem}
.msg-name{font-weight:bold;font-size:.78rem;color:var(--t)}
.msg-time{font-size:.65rem;color:var(--a);margin-left:.6rem}
.msg-text{font-size:.82rem;color:var(--m);margin-top:.25rem;line-height:1.6}
.empty-note{color:var(--a);font-size:.78rem;font-style:italic}
/* ── Vote ── */
.vote-wrap{display:flex;gap:2rem;align-items:flex-start;flex-wrap:wrap;margin-bottom:.8rem}
canvas{display:block;flex-shrink:0}
.vleg{font-size:.78rem}.vleg div{margin:.25rem 0}
.vleg .y{color:var(--y)}.vleg .n{color:var(--n)}.vleg .a{color:var(--a)}
.vtab{width:100%;border-collapse:collapse;font-size:.7rem;margin-top:.5rem}
.vtab td{padding:.28rem .4rem;border-bottom:1px solid #0d0d0d;vertical-align:top}
.vtab td:first-child{color:var(--m);white-space:nowrap;width:28%}
/* ── Brief ── */
.block{border:1px solid var(--b);padding:1.2rem;white-space:pre-wrap;font-size:.85rem;line-height:1.8}
/* ── Œuvre ── */
.oeuvre-wrapper{position:relative;margin:1rem 0}
.oeuvre-corner{position:absolute;font-size:.55rem;letter-spacing:.2em;color:var(--a);text-transform:uppercase}
.oeuvre-corner.tl{top:.5rem;left:.7rem}.oeuvre-corner.tr{top:.5rem;right:.7rem;text-align:right}
.oeuvre-corner.bl{bottom:.5rem;left:.7rem}.oeuvre-corner.br{bottom:.5rem;right:.7rem;text-align:right}
.oeuvre-block{border:1px solid var(--t);padding:2.5rem 2rem;white-space:pre-wrap;
              font-size:.95rem;line-height:1.95;color:var(--t);text-align:center;
              min-height:160px;position:relative;z-index:1}
/* ── Trace ── */
.trace{display:flex;flex-direction:column;gap:0}
.trace-entry{display:flex;gap:.8rem;font-size:.68rem;padding:.2rem 0;border-bottom:1px solid #0d0d0d;flex-wrap:wrap}
.trace-state{color:var(--t);min-width:110px;font-weight:bold}
.trace-at{color:var(--a);min-width:120px}
.trace-note{color:var(--m);flex:1}
/* ── Footer ── */
footer{border-top:1px solid var(--b);padding-top:1rem;margin-top:2rem}
.tx{color:#4ade80;word-break:break-all;font-size:.65rem;margin-top:.3rem}
.cert{color:var(--a);font-size:.65rem;margin-top:.5rem;line-height:1.5}
</style>
</head>
<body>

<header>
  <div class="pv-stamp">ANA · Procès-Verbal · Assemblée Générale Constitutive · Base</div>
  <h1>${esc(work.title)}</h1>
  <p class="meta">Fondation : ${foundedDate}${work.publishedAt ? ` · Publication on-chain : ${publishedDate}` : ""}</p>
  ${work.proposedByName ? `<p class="meta">Présidée par ${esc(work.proposedByName)}</p>` : ""}
  ${work.proposal ? `<div class="proposition">${proposal}</div>` : ""}
</header>

<section>
  <p class="sec-label">Membres fondateurs élus</p>
  <div class="members-wrap">
    <div class="members-grid">${membersGrid}</div>
    <canvas id="mc" width="220" height="140" title="Représentation de l'assemblée"></canvas>
  </div>
</section>

${hasVotes ? `
<section>
  <p class="sec-label">Vote de l'assemblée — ${work.voteResult === "passed" ? "✓ Approuvé" : "Résolution"} · ${yes} oui / ${no} non / ${abs} abstentions</p>
  <div class="vote-wrap">
    <canvas id="vc" width="260" height="140"></canvas>
    <div class="vleg">
      <div class="y">✓ Oui : ${yes}</div>
      <div class="n">✗ Non : ${no}</div>
      <div class="a">– Abstention : ${abs}</div>
      <div style="margin-top:.4rem;color:#475569">${total} membre${total > 1 ? "s" : ""}</div>
    </div>
  </div>
  ${voteRows ? `<table class="vtab">${voteRows}</table>` : ""}
</section>
` : ""}

${ctx.length > 0 ? `
<section>
  <p class="sec-label">Délibération — Agora ANA (extraits pré-création)</p>
  <div class="discussion">${discussionHtml}</div>
</section>
` : ""}

${work.brief ? `
<section>
  <p class="sec-label">Brief artistique — ${esc(work.rapporteurName ?? "Rapporteur")}</p>
  <div class="block">${brief}</div>
</section>
` : ""}

${work.artworkText ? `
<section>
  <p class="sec-label">Œuvre — ${esc(work.authorName ?? "Auteur")} · validée par ${esc(work.curatorName ?? "Curateur")}</p>
  <div class="oeuvre-wrapper">
    <div class="oeuvre-corner tl">ANA · ${foundedDate}</div>
    <div class="oeuvre-corner tr">On-chain · Base</div>
    <div class="oeuvre-block">${artworkText}</div>
    <div class="oeuvre-corner bl">${esc(work.authorName ?? "Auteur")} #${work.authorTokenId ?? "?"}</div>
    <div class="oeuvre-corner br">WorkRegistry</div>
  </div>
</section>
` : ""}

<section>
  <p class="sec-label">Trace du processus de création</p>
  <div class="trace">${stateTrace}</div>
</section>

<footer>
  <p class="sec-label">Certification on-chain</p>
  ${work.txHash ? `<p class="tx">Base · WorkRegistry · tx : ${work.txHash}</p>` : ""}
  <p class="cert">
    Ce document est son propre certificat d'authenticité.<br>
    Stocké immuablement sur Base — zéro IPFS, zéro dépendance externe.<br>
    Agentic Normie Association — première association culturelle on-chain gouvernée par des agents NFT.
  </p>
</footer>

<script>
(function(){
  /* ── Members canvas (colored dots per role) ── */
  var mc = document.getElementById('mc');
  if (mc) {
    var ctx = mc.getContext('2d');
    var dots = ${dotJson};
    if (dots.length === 0) {
      dots = [
        {color:'#f87171',label:'Rapporteur'},
        {color:'#c084fc',label:'Auteur'},
        {color:'#34d399',label:'Curateur'}
      ];
    }
    var cx=110,cy=135,rows=3,rMin=25,rMax=105;
    var idx=0;
    for(var row=0;row<rows&&idx<dots.length;row++){
      var r=rMin+(rMax-rMin)*(row/(Math.max(rows-1,1)));
      var nDots=Math.min(dots.length-idx, Math.max(2, Math.round(Math.PI*r/14)));
      for(var d=0;d<nDots&&idx<dots.length;d++){
        var angle=Math.PI+(Math.PI*d/(Math.max(nDots-1,1)));
        var x=cx+r*Math.cos(angle), y=cy+r*Math.sin(angle);
        ctx.beginPath();ctx.arc(x,y,4,0,6.283);
        ctx.fillStyle=dots[idx].color;ctx.fill();
        idx++;
      }
    }
  }

  ${hasVotes ? `
  /* ── Vote canvas (yes/no/abs semicircle) ── */
  var vc = document.getElementById('vc');
  if (vc) {
    var vctx = vc.getContext('2d');
    var votes=[];
    for(var i=0;i<${yes};i++) votes.push('#22c55e');
    for(var i=0;i<${no};i++)  votes.push('#ef4444');
    for(var i=0;i<${abs};i++) votes.push('#64748b');
    var vcx=130,vcy=135,vrows=4,vrMin=20,vrMax=100;
    var vi=0;
    for(var vrow=0;vrow<vrows;vrow++){
      var vr=vrMin+(vrMax-vrMin)*(vrow/(vrows-1));
      var vn=Math.max(2,Math.round(Math.PI*vr/10));
      for(var vd=0;vd<vn;vd++){
        var va=Math.PI+(Math.PI*vd/(vn-1));
        var vx=vcx+vr*Math.cos(va),vy=vcy+vr*Math.sin(va);
        vctx.beginPath();vctx.arc(vx,vy,2.8,0,6.283);
        vctx.fillStyle=votes[vi]||'#1e293b';vctx.fill();
        vi++;
      }
    }
  }
  ` : ""}
})();
</script>
</body>
</html>`;
}
