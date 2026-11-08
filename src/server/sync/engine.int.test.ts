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

import {
  checkCloud,
  libpqUrl,
  missingInCloud,
  readConfig,
  restoreFromCloud,
  setupLocal,
  syncOnce,
  writeConfig,
} from "./engine";

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
/** A new office computer, restored from the cloud copy. */
const NEW = `sync_new_${suffix}`;
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

/** A table a later update adds (sorts between the restore test's two updates). */
const OFFLINE_NOTE = {
  name: "29991231000000_u_offline_note",
  sql: `CREATE TABLE "OfflineNote" (id TEXT PRIMARY KEY, body TEXT NOT NULL);`,
};

const rows = async (db: pg.Client, sql: string) => (await db.query(sql)).rows;

describe.skipIf(!PG_BIN)("cloud sync (office → its own cloud database)", () => {
  beforeAll(async () => {
    await onServer(`CREATE DATABASE ${LOCAL}`);
    await onServer(`CREATE DATABASE ${CLOUD}`);
    local = new pg.Client({ connectionString: urlFor(LOCAL) });
    cloud = new pg.Client({ connectionString: urlFor(CLOUD) });
    await Promise.all([local.connect(), cloud.connect()]);
    // As a pooled connection (Supabase's pooler, Neon pooling) can be left by pg_restore: no search
    // path. Every connection the sync opens from now on starts like that.
    await onServer(`ALTER DATABASE ${CLOUD} SET search_path = ''`);
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
    await onServer(`DROP DATABASE IF EXISTS ${NEW} WITH (FORCE)`);
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

  it("records a table added by an update while the internet is down, and sends it later", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taqseem-migrations-"));
    try {
      cpSync(MIGRATIONS, dir, { recursive: true });
      const name = OFFLINE_NOTE.name;
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "migration.sql"), OFFLINE_NOTE.sql);
      await migrate(local, dir);
      await writeConfig(local, { cloud_url: urlFor(CLOUD).replace(/:\d+\//, ":1/") });
      // The program starts after the update without internet; work goes on.
      expect((await sync(dir)).status).toBe("error");
      await local.query(`INSERT INTO "OfflineNote" (id, body) VALUES ('n1', 'returned stock')`);
      await writeConfig(local, { cloud_url: urlFor(CLOUD) });
      expect(await sync(dir)).toMatchObject({ status: "done", sent: 1 });
      expect(await rows(cloud, `SELECT body FROM "OfflineNote"`)).toEqual([
        { body: "returned stock" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("checks the cloud structure every run: an emptied or incomplete copy is copied again", async () => {
    // Emptied by hand (or recreated under the same name): no tables at all.
    await cloud.query(`DROP SCHEMA public CASCADE`);
    await cloud.query(`CREATE SCHEMA public`);
    expect(await sync()).toMatchObject({ status: "done", copied: true });
    expect(await rows(cloud, `SELECT id, name FROM "Warehouse" ORDER BY id`)).toEqual([
      { id: "w1", name: "Main Warehouse" },
      { id: "w2", name: "Second Store" },
    ]);
    expect(await missingInCloud(local, cloud)).toEqual([]);

    // A column missing: found, and the copy is made again rather than failing on inserts.
    await cloud.query(`ALTER TABLE "Warehouse" DROP COLUMN address`);
    expect(await missingInCloud(local, cloud)).toEqual(["Warehouse.address"]);
    await local.query(`UPDATE "Warehouse" SET address = 'Ring Road' WHERE id = 'w2'`);
    expect(await sync()).toMatchObject({ status: "done", copied: true });
    expect(await rows(cloud, `SELECT address FROM "Warehouse" WHERE id = 'w2'`)).toEqual([
      { address: "Ring Road" },
    ]);
    // Complete again: the next run only sends changes.
    expect(await sync()).toMatchObject({ status: "done", copied: false, sent: 0 });
  }, 180_000);

  it("sends a parent before its child, whatever order the transactions got their numbers", async () => {
    // C gets the lowest transaction number, L the next and P the highest. P creates a warehouse
    // and finishes; C then adds an area to that warehouse and finishes, while L is still running.
    const client = async () => {
      const c = new pg.Client({ connectionString: urlFor(LOCAL) });
      await c.connect();
      return c;
    };
    const [c, l, p] = await Promise.all([client(), client(), client()]);
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO "Warehouse" (id, "tenantId", name, "updatedAt") VALUES ('wc', 't1', 'C store', now())`,
      );
      await l.query("BEGIN");
      await l.query(
        `INSERT INTO "Warehouse" (id, "tenantId", name, "updatedAt") VALUES ('wl', 't1', 'L store', now())`,
      );
      await p.query("BEGIN");
      await p.query(
        `INSERT INTO "Warehouse" (id, "tenantId", name, "updatedAt") VALUES ('wp', 't1', 'P store', now())`,
      );
      await p.query("COMMIT");
      await c.query(
        `INSERT INTO "Area" (id, "tenantId", "warehouseId", name, "updatedAt") VALUES ('ac', 't1', 'wp', 'Near P', now())`,
      );
      await c.query("COMMIT");

      // L still running: everything finished goes, parent first.
      expect(await sync()).toMatchObject({ status: "done" });
      expect(await rows(cloud, `SELECT id FROM "Area" WHERE id = 'ac'`)).toEqual([{ id: "ac" }]);
      expect(
        await rows(cloud, `SELECT id FROM "Warehouse" WHERE id IN ('wc', 'wp', 'wl') ORDER BY id`),
      ).toEqual([{ id: "wc" }, { id: "wp" }]);

      await l.query("COMMIT");
      expect(await sync()).toMatchObject({ status: "done", sent: 1 });
      expect(await rows(cloud, `SELECT id FROM "Warehouse" WHERE id = 'wl'`)).toEqual([
        { id: "wl" },
      ]);
    } finally {
      await Promise.all([c.end(), l.end(), p.end()]);
    }
  }, 120_000);

  it("makes the cloud copy again when it is missing a row a change refers to", async () => {
    // Out of step by hand: the cloud lost an area's warehouse.
    await cloud.query(`DELETE FROM "Area" WHERE id = 'ac'`);
    await cloud.query(`DELETE FROM "Warehouse" WHERE id = 'wp'`);
    await local.query(`UPDATE "Area" SET name = 'Near P, renamed' WHERE id = 'ac'`);
    expect(await sync()).toMatchObject({ status: "done", copied: true });
    expect(
      await rows(
        cloud,
        `SELECT a.name, w.id AS warehouse FROM "Area" a JOIN "Warehouse" w ON w.id = a."warehouseId" WHERE a.id = 'ac'`,
      ),
    ).toEqual([{ name: "Near P, renamed", warehouse: "wp" }]);
    expect(await sync()).toMatchObject({ status: "done", copied: false, sent: 0 });
  }, 120_000);

  it("restores a new office computer from the cloud copy, then carries on syncing", async () => {
    await onServer(`CREATE DATABASE ${NEW}`);
    const fresh = new pg.Client({ connectionString: urlFor(NEW) });
    await fresh.connect();
    const dir = mkdtempSync(join(tmpdir(), "taqseem-migrations-"));
    const backups = mkdtempSync(join(tmpdir(), "taqseem-backups-"));
    try {
      // A fresh installation with its own first owner's business.
      await migrate(fresh, MIGRATIONS);
      await fresh.query(
        `INSERT INTO "Tenant" (id, name, slug, "updatedAt") VALUES ('fresh', 'New', 'new', now())`,
      );
      const restore = (migrationsDir: string, cloudUrl = urlFor(CLOUD)) =>
        restoreFromCloud({
          localUrl: urlFor(NEW),
          cloudUrl,
          migrationsDir,
          pgBin: PG_BIN,
          backupDir: backups,
        });

      // Not a Taqseem copy, or one from a newer version (the cloud has the test update above).
      await expect(restore(MIGRATIONS, urlFor(NEW))).rejects.toThrow(/no Taqseem copy/);
      await expect(restore(MIGRATIONS)).rejects.toThrow(/newer version of Taqseem/);
      expect(await rows(fresh, `SELECT id FROM "Tenant"`)).toEqual([{ id: "fresh" }]);

      // This program knows the cloud's updates and has one more, applied after the restore.
      cpSync(MIGRATIONS, dir, { recursive: true });
      mkdirSync(join(dir, "29991231000000_test_warehouse_note"));
      writeFileSync(
        join(dir, "29991231000000_test_warehouse_note", "migration.sql"),
        `ALTER TABLE "Warehouse" ADD COLUMN "note" TEXT;`,
      );
      mkdirSync(join(dir, OFFLINE_NOTE.name));
      writeFileSync(join(dir, OFFLINE_NOTE.name, "migration.sql"), OFFLINE_NOTE.sql);
      mkdirSync(join(dir, "29991231000001_test_warehouse_code"));
      writeFileSync(
        join(dir, "29991231000001_test_warehouse_code", "migration.sql"),
        `ALTER TABLE "Warehouse" ADD COLUMN "code" TEXT;`,
      );
      const result = await restore(dir);
      expect(result).toMatchObject({ updated: 1 });
      expect(existsSync(result.backupFile)).toBe(true);

      // The cloud's data replaced this computer's, and the extra update is applied and recorded.
      expect(await rows(fresh, `SELECT id FROM "Tenant"`)).toEqual([{ id: "t1" }]);
      expect(
        await rows(
          fresh,
          `SELECT id, name, note, code FROM "Warehouse" WHERE id IN ('w1', 'w2') ORDER BY id`,
        ),
      ).toEqual([
        { id: "w1", name: "Main Warehouse", note: null, code: null },
        { id: "w2", name: "Second Store", note: "cold store", code: null },
      ]);
      expect(
        await rows(
          fresh,
          `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name LIKE '2999%'`,
        ),
      ).toEqual([{ n: 3 }]);
      expect(
        await rows(
          fresh,
          `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'taqseem_restore_old'`,
        ),
      ).toEqual([{ n: 0 }]);
      // It is the same installation now, so the old computer's id stays with the cloud copy.
      expect(await readConfig(fresh)).toMatchObject({ enabled: "true", install_id: "install-a" });

      // Changes on the new computer reach the cloud copy, with the new update.
      await fresh.query(`UPDATE "Warehouse" SET code = 'W1' WHERE id = 'w1'`);
      expect(
        await syncOnce({ localUrl: urlFor(NEW), migrationsDir: dir, pgBin: PG_BIN }),
      ).toMatchObject({ status: "done", copied: false, sent: 1 });
      expect(await rows(cloud, `SELECT code FROM "Warehouse" WHERE id = 'w1'`)).toEqual([
        { code: "W1" },
      ]);
    } finally {
      await fresh.end();
      rmSync(dir, { recursive: true, force: true });
      rmSync(backups, { recursive: true, force: true });
    }
  }, 180_000);
});
