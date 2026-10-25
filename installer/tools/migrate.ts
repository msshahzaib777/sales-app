// Applies the database migrations for the installed app (installer/install.ps1), without the Prisma
// CLI. Same files (prisma/migrations/*/migration.sql) and the same bookkeeping table as
// `prisma migrate deploy`, so either tool can be used on the same database later.
//
//   node migrate.mjs <migrations folder>            apply what is not applied yet
//   node migrate.mjs <migrations folder> --status   print how many are not applied yet
// The connection comes from DATABASE_URL.

import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

const [folder, flag] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node migrate.mjs <migrations folder> [--status]");
  process.exit(2);
}

/** Migration folders in order (their names start with a timestamp). */
function migrations(dir: string) {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const done = await db.query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
    );
    const failed = done.rows.filter((r) => !r.finished_at).map((r) => r.migration_name);
    if (failed.length) {
      throw new Error(
        `An earlier database update did not finish (${failed.join(", ")}). Restore the backup from before it, then try again.`,
      );
    }
    const applied = new Set(done.rows.map((r) => r.migration_name));
    const pending = migrations(folder).filter((m) => !applied.has(m.name));
    if (flag === "--status") {
      console.log(pending.length);
      return;
    }
    for (const m of pending) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())`,
        [id, m.checksum, m.name],
      );
      // As Prisma does: the file runs as written (a migration may need to run outside one big
      // transaction, e.g. ALTER TYPE … ADD VALUE).
      await db.query(m.sql);
      await db.query(
        `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`,
        [id],
      );
      console.log(`Applied ${m.name}`);
    }
    console.log(
      pending.length ? `${pending.length} database update(s) applied.` : "Database is up to date.",
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
