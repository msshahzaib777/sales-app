import { join } from "node:path";

import { syncOnce, type SyncResult } from "./engine";

// The background sync loop, inside the website's server process: a run every 30 seconds (sooner
// after a busy run), nothing at all while cloud sync is off. Started once from instrumentation.ts.
// The installer sets PG_BIN (its pgsql\bin) and TAQSEEM_MIGRATIONS_DIR; in development the
// migrations are prisma/migrations and pg_dump comes from PATH.

const EVERY_MS = 30_000;

type AgentState = { timer?: NodeJS.Timeout; running?: Promise<SyncResult>; started?: boolean };
const g = globalThis as typeof globalThis & { __taqseemSync?: AgentState };
const state: AgentState = (g.__taqseemSync ??= {});

function options() {
  const localUrl = process.env.DATABASE_URL;
  if (!localUrl) return null;
  return {
    localUrl,
    migrationsDir:
      process.env.TAQSEEM_MIGRATIONS_DIR ??
      join(/* turbopackIgnore: true */ process.cwd(), "prisma", "migrations"),
    pgBin: process.env.PG_BIN,
  };
}

/** One run now (or the one already running). */
export function syncNow(): Promise<SyncResult> {
  if (state.running) return state.running;
  const o = options();
  if (!o) return Promise.resolve({ status: "off" });
  state.running = syncOnce(o)
    .catch((error): SyncResult => ({ status: "error", message: String(error) }))
    .finally(() => {
      state.running = undefined;
    });
  return state.running;
}

function schedule(ms: number) {
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    const result = await syncNow();
    // More waiting after a full batch run: go again soon; otherwise the normal pause.
    schedule(result.status === "done" && result.sent >= 500 ? 2_000 : EVERY_MS);
  }, ms);
  state.timer.unref?.();
}

export function startSyncAgent() {
  if (state.started || !options()) return;
  state.started = true;
  schedule(5_000);
}
