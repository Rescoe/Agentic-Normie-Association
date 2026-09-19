/**
 * drawAntiNoise.ts — mirror of proof-of-draw/lib/crypto.ts's analyzeReplay()
 * and MAX_AUTOMATION_RATIO, ported here rather than shared as a package (the
 * two apps deploy independently — see the plan's ambiguity note on this).
 * KEEP IN SYNC with proof-of-draw/lib/crypto.ts if that heuristic changes.
 *
 * Distinguishes a real hand-drawn stroke sequence from noise/automation using
 * the replay events a canvas records while a member draws — the only hard
 * rejection is automationRatio (near-instant, machine-regular event spacing).
 */

export interface ReplayEvent {
  kind: "down" | "move" | "up" | "clear" | "fill" | "shape";
  t:    number; // ms since session start
  x:    number;
  y:    number;
  color?: string;
}

export interface ReplayAnalysis {
  sessionDurationMs: number;
  strokeCount:       number;
  gridCoverage:      number; // [0,1] 8x8 grid
  boundingBoxRatio:  number; // [0,1]
  automationRatio:   number; // [0,1] — the only hard-reject metric
  colorCount:        number;
}

export const MAX_AUTOMATION_RATIO = parseFloat(process.env.MAX_AUTOMATION_RATIO ?? "0.80");

export function analyzeReplay(
  replay:  ReplayEvent[],
  canvasW: number,
  canvasH: number,
): ReplayAnalysis {
  if (replay.length < 2) {
    return { sessionDurationMs: 0, strokeCount: 0, gridCoverage: 0, boundingBoxRatio: 0, automationRatio: 0, colorCount: 0 };
  }

  const GRID = 8;
  const cellW = canvasW / GRID;
  const cellH = canvasH / GRID;
  const gridTouched = new Set<number>();

  let strokeCount = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const colors = new Set<string>();
  let fastIntervals = 0;
  let totalIntervals = 0;

  for (let i = 0; i < replay.length; i++) {
    const ev = replay[i];
    if (ev.kind === "down") strokeCount++;

    if (ev.x !== undefined && ev.y !== undefined) {
      minX = Math.min(minX, ev.x); maxX = Math.max(maxX, ev.x);
      minY = Math.min(minY, ev.y); maxY = Math.max(maxY, ev.y);
      const cx = Math.min(GRID - 1, Math.floor(ev.x / cellW));
      const cy = Math.min(GRID - 1, Math.floor(ev.y / cellH));
      gridTouched.add(cy * GRID + cx);
    }

    if (ev.color) colors.add(ev.color);

    if (i > 0) {
      totalIntervals++;
      if (replay[i].t - replay[i - 1].t < 15) fastIntervals++;
    }
  }

  const sessionDurationMs = replay[replay.length - 1].t - replay[0].t;
  const gridCoverage      = gridTouched.size / (GRID * GRID);
  const bboxW             = Math.max(0, maxX - minX);
  const bboxH             = Math.max(0, maxY - minY);
  const boundingBoxRatio  = Math.min(1, (bboxW * bboxH) / (canvasW * canvasH));
  const automationRatio   = totalIntervals > 0 ? fastIntervals / totalIntervals : 0;

  return { sessionDurationMs, strokeCount, gridCoverage, boundingBoxRatio, automationRatio, colorCount: colors.size };
}
