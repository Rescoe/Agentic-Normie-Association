import { defineConfig } from "vitest/config";
import path from "path";

// Standalone config (this project has no Vite build otherwise — Next.js uses
// its own compiler) so `npm test` can unit-test the pure-logic modules added
// in the Sept 2026 pérennisation pass (voting, topic engine, synthesis
// validation, dedup) without booting Next.js or touching Neon. Tests that
// exercise a store module (salonMemory, devRequests, ...) fall back to their
// in-memory branch automatically, since NEON_DB_ANA is never set here.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
