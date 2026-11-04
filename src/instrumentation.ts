// Runs once when the website's server starts: starts the cloud sync loop (it does nothing until
// the owner turns cloud sync on under Settings). Not during `next build`.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build")
    return;
  const { startSyncAgent } = await import("./server/sync/agent");
  startSyncAgent();
}
