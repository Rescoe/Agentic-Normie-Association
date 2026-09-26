/**
 * neonUsage.ts — real Neon compute usage via the Consumption API, when
 * configured; otherwise a labeled projection. Per the pérennité study
 * (section 11): "ne prétends pas mesurer exactement les CU-h Neon sans API
 * officielle" — this file is the one place that draws the line between a
 * real measurement and an estimate, and every caller must surface which one
 * it got.
 *
 * Endpoint verified live (26/09/2026) against Neon's own docs:
 *   GET https://console.neon.tech/api/v2/consumption_history/v2/projects
 *   ?org_id=...&project_ids=...&from=...&to=...&granularity=monthly&metrics=compute_unit_seconds
 *   Authorization: Bearer <NEON_API_KEY>
 * Neon's docs explicitly state this endpoint does NOT wake a project's
 * compute endpoint — safe to poll from an admin dashboard without itself
 * becoming a cost driver.
 */

const NEON_API_BASE = "https://console.neon.tech/api/v2";

export interface NeonUsageResult {
  source: "neon-api" | "projection";
  computeCuHours: number;
  windowStart: string;
  windowEnd: string;
  note?: string;
}

interface ConsumptionResponse {
  projects: Array<{
    project_id: string;
    periods: Array<{
      consumption: Array<{ metrics: Array<{ metric_name: string; value: number }> }>;
    }>;
  }>;
}

async function fetchRealNeonUsage(): Promise<NeonUsageResult | null> {
  const apiKey    = process.env.NEON_API_KEY;
  const orgId     = process.env.NEON_ORG_ID;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !orgId || !projectId) return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const nowIso = now.toISOString();

  const url = `${NEON_API_BASE}/consumption_history/v2/projects` +
    `?org_id=${encodeURIComponent(orgId)}&project_ids=${encodeURIComponent(projectId)}` +
    `&from=${encodeURIComponent(monthStart)}&to=${encodeURIComponent(nowIso)}` +
    `&granularity=monthly&metrics=compute_unit_seconds`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`[neonUsage] Neon consumption API ${res.status} — falling back to projection`);
      return null;
    }
    const data = await res.json() as ConsumptionResponse;
    const project = data.projects.find(p => p.project_id === projectId) ?? data.projects[0];
    if (!project) return null;

    let totalSeconds = 0;
    for (const period of project.periods) {
      for (const point of period.consumption) {
        for (const m of point.metrics) {
          if (m.metric_name === "compute_unit_seconds") totalSeconds += m.value;
        }
      }
    }
    return {
      source: "neon-api",
      computeCuHours: totalSeconds / 3600,
      windowStart: monthStart, windowEnd: nowIso,
    };
  } catch (e) {
    console.warn("[neonUsage] Neon consumption API call failed — falling back to projection:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Rough projection from the orchestrator's own schedule, used only when the
 * real Neon API isn't configured. Assumes each active window keeps compute
 * awake for ~5 minutes at the 0.25 CU floor — matches the pérennité study's
 * own "48 windows × 5 min ≈ 30 CU-h/month" arithmetic. Explicitly labeled as
 * an estimate everywhere it's surfaced — never presented as a measurement.
 */
function projectFromOrchestratorSchedule(): NeonUsageResult {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysElapsed = Math.max(1, (now.getTime() - monthStart.getTime()) / 86_400_000);
  const windowsPerDay = 48; // every 30 min
  const minutesActivePerWindow = 5;
  const cuFloor = 0.25;
  const cuHoursPerDay = (windowsPerDay * minutesActivePerWindow / 60) * cuFloor;
  return {
    source: "projection",
    computeCuHours: cuHoursPerDay * daysElapsed,
    windowStart: monthStart.toISOString(), windowEnd: now.toISOString(),
    note: "Estimation based on the orchestrator's own 30-min schedule (NEON_API_KEY/NEON_ORG_ID/NEON_PROJECT_ID not configured) — not a real measurement.",
  };
}

export async function getMonthlyComputeUsage(): Promise<NeonUsageResult> {
  const real = await fetchRealNeonUsage();
  return real ?? projectFromOrchestratorSchedule();
}

export type BudgetPolicy = "normal" | "diagnose" | "reduce" | "economy" | "critical";

/** Thresholds from the pérennité study, section 11/12. */
export function classifyBudget(cuHours: number): BudgetPolicy {
  if (cuHours <= 30) return "normal";
  if (cuHours <= 50) return "diagnose";
  if (cuHours <= 70) return "reduce";
  if (cuHours <= 85) return "economy";
  return "critical";
}
