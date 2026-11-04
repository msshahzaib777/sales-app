import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkCloud, libpqUrl, setupLocal, syncOnce, writeConfig } from "./engine";

// The real sync between two throwaway databases on the test server: a full copy with pg_dump /
// pg_restore, then changes. Needs pg_dump / pg_restore: PG_BIN, or the installer's copy.

// The installer's copy (pgsql\tools), or the packaging cache it comes from.
const PG_BIN =
  process.env.PG_BIN ??
  [
    join(process.cwd(), "dist", "package", "pgsql", "tools"),
    join(process.cwd(), "dist", "cache", "pgtools-17.10"),
  ].find((dir) => existsSync(join(dir, process.platform === "win32" ? "pg_dump.exe" : "pg_dump")));
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const admin = libpqUrl(process.env.TEST_DATABASE_URL ?? "");
const urlFor = (db: string) => admin.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

const suffix = randomUUID().slice(0, 8);
const LOCAL = `sync_local_${suffix}`;
const CLOUD = `sync_cloud_${suffix}`;
let local: pg.Client;
let cloud: pg.Client;

async function onServer(sql: string) {
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

/** All migrations, applied the way the installer does, with their bookkeeping rows. */
async function migrate(db: pg.Client, dir: string) {
  await db.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
    migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
  const done = new Set(
    (await db.query(`SELECT migration_name FROM "_prisma_migrations"`)).rows.map(
      (r) => r.migration_name,
    ),
  );
  for (const name of readdirSync(dir)
    .filter((n) => !n.includes("."))
    .sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    await db.query(sql);
    await db.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
       VALUES ($1, $2, now(), $3, 1)`,
      [randomUUID(), createHash("sha256").update(sql).digest("hex"), name],
    );
  }
}

const rows = async (db: pg.Client, sql: string) => (await db.query(sql)).rows;

describe.skipIf(!PG_BIN)("cloud sync (office → its own cloud database)", () => {
  beforeAll(async () => {
    await onServer(`CREATE DATABASE ${LOCAL}`);
    await onServer(`CREATE DATABASE ${CLOUD}`);
    local = new pg.Client({ connectionString: urlFor(LOCAL) });
    cloud = new pg.Client({ connectionString: urlFor(CLOUD) });
    await Promise.all([local.connect(), cloud.connect()]);
    await migrate(local, MIGRATIONS);
    await local.query(
      `INSERT INTO "Tenant" (id, name, slug, "updatedAt") VALUES ('t1', 'Demo', 'demo', now())`,
    );
    await local.query(
      `INSERT INTO "Warehouse" (id, "tenantId", name, "updatedAt") VALUES ('w1', 't1', 'Main', now())`,
    );
    await setupLocal(local);
    await writeConfig(local, {
      enabled: "true",
      cloud_url: urlFor(CLOUD),
      install_id: "install-a",
    });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([local?.end(), cloud?.end()]);
    await onServer(`DROP DATABASE IF EXISTS ${LOCAL} WITH (FORCE)`);
    await onServer(`DROP DATABASE IF EXISTS ${CLOUD} WITH (FORCE)`);
  });

  const sync = (migrationsDir = MIGRATIONS) =>
    syncOnce({ localUrl: urlFor(LOCAL), migrationsDir, pgBin: PG_BIN });

  it("copies everything first, then sends inserts, updates and deletes, once", async () => {
    const first = await sync();
    expect(first).toMatchObject({ status: "done", copied: true });
    expect(await rows(cloud, `SELECT id, name FROM "Warehouse"`)).toEqual([
      { id: "w1", name: "Main" },
    ]);
    // The cloud has the schema and its append-only rules, but none of the office's capture triggers.
    expect(
      await rows(
        cloud,
        `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'taqseem_sync_capture'`,
      ),
    ).toEqual([{ n: 0 }]);
    expect(await rows(cloud, `SELECT id FROM taqseem_sync_target.installation`)).toEqual([
      { id: "install-a" },
    ]);

    await local.query(
      `UPDATE "Warehouse" SET name = 'Main Warehouse', address = 'GT Road' WHERE id = 'w1'`,
    );
    await local.query(
      `INSERT INTO "Warehouse" (id, "tenantId", name, "updatedAt") VALUES ('w2', 't1', 'Second', now()), ('w3', 't1', 'Third', now())`,
    );
    await local.query(`DELETE FROM "Warehouse" WHERE id = 'w3'`);
    // A table keyed on two columns, changed twice.
    await local.query(
      `INSERT INTO "DocumentSequence" ("tenantId", key, "nextValue") VALUES ('t1', 'BILL', 5)`,
    );
    await local.query(`UPDATE "DocumentSequence" SET "nextValue" = 6 WHERE key = 'BILL'`);
    // An append-only table: inserts only.
    await local.query(
      `INSERT INTO "AuditLog" (id, "tenantId", action, "entityType", "entityId") VALUES ('a1', 't1', 'CREATE', 'Warehouse', 'w2')`,
    );

    const second = await sync();
    expect(second).toMatchObject({ status: "done", copied: false, sent: 7 });
    expect(await rows(cloud, `SELECT id, name, address FROM "Warehouse" ORDER BY id`)).toEqual([
      { id: "w1", name: "Main Warehouse", address: "GT Road" },
      { id: "w2", name: "Second", address: null },
    ]);
    expect(await rows(cloud, `SELECT key, "nextValue" FROM "DocumentSequence"`)).toEqual([
      { key: "BILL", nextValue: 6 },
    ]);
    expect(await rows(cloud, `SELECT id FROM "AuditLog"`)).toEqual([{ id: "a1" }]);
    // Nothing waits, and running again sends nothing.
    expect(await rows(local, `SELECT count(*)::int AS n FROM taqseem_sync.outbox`)).toEqual([
      { n: 0 },
    ]);
    expect(await sync()).toMatchObject({ status: "done", sent: 0 });
  }, 120_000);

  it("applies a database update to the cloud before the changes that need it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taqseem-migrations-"));
    try {
      cpSync(MIGRATIONS, dir, { recursive: true });
      const name = "29991231000000_test_warehouse_note";
      mkdirSync(join(dir, name));
      writeFileSync(
        join(dir, name, "migration.sql"),
        `ALTER TABLE "Warehouse" ADD COLUMN "note" TEXT;`,
      );
      await migrate(local, dir);
      await local.query(`UPDATE "Warehouse" SET note = 'cold store' WHERE id = 'w2'`);
      expect(await sync(dir)).toMatchObject({ status: "done", sent: 1 });
      expect(await rows(cloud, `SELECT note FROM "Warehouse" WHERE id = 'w2'`)).toEqual([
        { note: "cold store" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps installations apart: another installation refuses this cloud database", async () => {
    await expect(checkCloud(cloud, "install-b")).rejects.toThrow(/another Taqseem installation/);
    await expect(checkCloud(cloud, "install-a")).resolves.toMatchObject({ owner: "install-a" });
  });

  it("waits without internet and reports it, then catches up", async () => {
    await writeConfig(local, { cloud_url: urlFor(CLOUD).replace(/:\d+\//, ":1/") });
    await local.query(`UPDATE "Warehouse" SET name = 'Second Store' WHERE id = 'w2'`);
    const offline = await sync();
    expect(offline.status).toBe("error");
    expect(await rows(local, `SELECT count(*)::int AS n FROM taqseem_sync.outbox`)).toEqual([
      { n: 1 },
    ]);
    await writeConfig(local, { cloud_url: urlFor(CLOUD) });
    expect(await sync()).toMatchObject({ status: "done", sent: 1 });
    expect(await rows(cloud, `SELECT name FROM "Warehouse" WHERE id = 'w2'`)).toEqual([
      { name: "Second Store" },
    ]);
  }, 120_000);
});
