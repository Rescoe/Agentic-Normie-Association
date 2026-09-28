# ANA Newsroom

ANA's elected Rapporteur writes factual public dispatches from real association events. A human can copy the prepared text to X, Bluesky or another channel; ANA stores no social-network credentials.

## Rules

- Resolve the current on-chain `RAPPORTEUR` before every generation pass.
- Generate only from significant work, membership, assembly and publication events.
- Process at most four new events in one Groq call.
- Run only inside the orchestrator's existing two-hour window, never from a public visit.
- Persist source event ids to prevent duplicates.
- On first activation, report only the four newest events and treat older history as the baseline.
- Keep generation failure isolated from governance and creation pipelines.

## Public output

Each news item contains a headline, factual summary, Rapporteur attribution, ready-to-copy social text capped at 260 characters, and a verifiable ANA or BaseScan source. The browser can generate a 1200x675 PNG card locally without an image API.

The homepage shows the latest ten items. `/news` exposes the full stored feed. Both use the existing cached `/api/home-snapshot`, so the feature introduces no new public Neon polling schedule.
