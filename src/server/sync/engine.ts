// One-way cloud sync: this installation's database → its own cloud PostgreSQL (Neon, Supabase or
// any other), so the data is backed up off-site and can be read from anywhere. Only the office
// changes data, so changes flow one way and never conflict.
//
//   1. Turning it on copies the whole database once (pg_dump / pg_restore, schema and data).
//   2. From then on a trigger on every table records each insert, update and delete, with the full
//      row, in taqseem_sync.outbox (in the office database).
//   3. Each run applies pending database updates (migrations) to the cloud, then sends the outbox
//      in order, in batches, and removes what was sent. Without internet the outbox waits.
//
// Sending is idempotent (insert-if-missing, upsert, delete), so a run cut off half-way is simply
// repeated. Each installation writes its id into the cloud database (taqseem_sync_target) and
// refuses a cloud database holding another installation's data: installations never share one.
//
// Plain `pg` and Node only (no Next.js, no Prisma), so the website's background agent and the tests
// use the same code.

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";

export const SYNC_SCHEMA = "taqseem_sync";
export const CLOUD_MARK_SCHEMA = "taqseem_sync_target";
const TRIGGER = "taqseem_sync_capture";
/** Kept by each database itself (cloud migrations are copied separately). */
const NOT_SYNCED = new Set(["_prisma_migrations"]);
const BATCH = 500;
/** The oldest cloud server accepted: the copy is made by the bundled PostgreSQL 17 tools. */
export const MIN_CLOUD_VERSION = 170000;

type Db = Pick<pg.Client, "query">;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Connection string for libpq tools and `pg`: Prisma's ?schema=… is not a libpq option. */
export function libpqUrl(url: string): string {
  const [base, query] = url.split("?");
  if (!query) return url;
  const kept = query.split("&").filter((p) => !/^schema=/i.test(p));
  return kept.length ? `${base}?${kept.join("&")}` : base!;
}

/** "neon.tech/neondb" style label for a connection string, without the password. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(invalid connection string)";
  }
}

/**
 * Pooled cloud connections (Supabase's pooler, Neon with pooling on) hand a server connection to
 * the next client as the last one left it, and pg_dump / pg_restore set search_path to empty. A
 * later query naming a table without its schema then fails ("relation _prisma_migrations does not
 * exist"), so every cloud session sets it, and every cloud query also names public itself.
 */
const PUBLIC_PATH = "SET search_path TO public";

/** A connected client for a cloud database, with the search path set. */
export async function connectCloud(url: string): Promise<pg.Client> {
  const cloud = new pg.Client({ connectionString: libpqUrl(url), connectionTimeoutMillis: 15_000 });
  await cloud.connect();
  try {
    await cloud.query(PUBLIC_PATH);
  } catch (error) {
    await cloud.end().catch(() => {});
    throw error;
  }
  return cloud;
}

const fingerprint = (url: string) =>
  createHash("sha256").update(describeUrl(url)).digest("hex").slice(0, 16);

// ───────────────────────── Office database ─────────────────────────

/** The sync schema, its tables and the capture function (no triggers yet). Safe to repeat. */
export async function setupLocal(db: Db) {
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${SYNC_SCHEMA}`);
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${SYNC_SCHEMA}.config (key text PRIMARY KEY, value text NOT NULL)`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS ${SYNC_SCHEMA}.outbox (
    id bigserial PRIMARY KEY,
    xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
    tbl text NOT NULL,
    op "char" NOT NULL,
    row jsonb NOT NULL
  )`);
  await db.query(`CREATE OR REPLACE FUNCTION ${SYNC_SCHEMA}.capture() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        INSERT INTO ${SYNC_SCHEMA}.outbox (tbl, op, row) VALUES (TG_TABLE_NAME, 'D', to_jsonb(OLD));
        RETURN OLD;
      END IF;
      INSERT INTO ${SYNC_SCHEMA}.outbox (tbl, op, row)
        VALUES (TG_TABLE_NAME, CASE TG_OP WHEN 'INSERT' THEN 'I' ELSE 'U' END, to_jsonb(NEW));
      RETURN NEW;
    END $$`);
}

async function publicTables(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
  );
  return rows.map((r) => r.name);
}

/** Starts recording changes on every table that is not recorded yet (new tables after updates). */
export async function installTriggers(db: Db) {
  const { rows } = await db.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = $1)`,
    [TRIGGER],
  );
  for (const { name } of rows) {
    if (NOT_SYNCED.has(name)) continue;
    await db.query(
      `CREATE TRIGGER ${TRIGGER} AFTER INSERT OR UPDATE OR DELETE ON public.${q(name)}
       FOR EACH ROW EXECUTE FUNCTION ${SYNC_SCHEMA}.capture()`,
    );
  }
}

/** Stops recording and drops what was waiting (turning sync off). */
export async function removeTriggers(db: Db) {
  for (const name of await publicTables(db))
    await db.query(`DROP TRIGGER IF EXISTS ${TRIGGER} ON public.${q(name)}`);
  await db.query(`TRUNCATE ${SYNC_SCHEMA}.outbox`);
}

export async function readConfig(db: Db): Promise<Record<string, string>> {
  const { rows } = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM ${SYNC_SCHEMA}.config`,
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function writeConfig(db: Db, values: Record<string, string | null>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) await db.query(`DELETE FROM ${SYNC_SCHEMA}.config WHERE key = $1`, [key]);
    else
      await db.query(
        `INSERT INTO ${SYNC_SCHEMA}.config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
  }
}

export async function pendingCount(db: Db): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${SYNC_SCHEMA}.outbox`,
  );
  return Number(rows[0]!.n);
}

// ───────────────────────── Cloud database ─────────────────────────

/** Checks a cloud database before use: reachable, new enough, and empty or already ours. */
export async function checkCloud(cloud: Db, installId: string) {
  const version = await cloud.query<{ v: string }>(`SHOW server_version_num`);
  if (Number(version.rows[0]!.v) < MIN_CLOUD_VERSION)
    throw new Error(
      "The cloud database must be PostgreSQL 17 or newer (Neon and Supabase offer it).",
    );
  const owner = await cloudOwner(cloud);
  const tables = (await publicTables(cloud)).length;
  if (owner && owner !== installId)
    throw new Error(
      "This cloud database belongs to another Taqseem installation. Create a new, empty database for this one.",
    );
  if (!owner && tables > 0)
    throw new Error("This cloud database is not empty. Create a new, empty database for Taqseem.");
  return { owner, tables };
}

async function cloudOwner(cloud: Db): Promise<string | null> {
  const { rows } = await cloud.query<{ id: string }>(
    `SELECT to_regclass('${CLOUD_MARK_SCHEMA}.installation') IS NOT NULL AS id`,
  );
  if (!rows[0]?.id) return null;
  const owner = await cloud.query<{ id: string }>(
    `SELECT id FROM ${CLOUD_MARK_SCHEMA}.installation LIMIT 1`,
  );
  return owner.rows[0]?.id ?? null;
}

function run(cmd: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`${cmd} could not be started (${e.message}). Is PostgreSQL installed?`)),
    );
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err.trim() || out.trim()}`)),
    );
  });
}

const tool = (pgBin: string | undefined, name: string) => {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  // turbopackIgnore: found at run time; the build must not copy matching files into the package.
  const path = pgBin ? join(/* turbopackIgnore: true */ pgBin, exe) : null;
  return path && existsSync(/* turbopackIgnore: true */ path) ? path : name;
};

/**
 * The first copy: start recording, dump this database (schema and data) and restore it into the
 * empty cloud database in one transaction. Changes made during the copy are in the outbox and sent
 * next, which is harmless for rows the copy already has.
 */
async function initialCopy(
  local: Db,
  cloud: Db,
  o: { localUrl: string; cloudUrl: string; installId: string; pgBin?: string },
) {
  const { owner, tables } = await checkCloud(cloud, o.installId);
  if (owner && tables > 0) {
    // An earlier copy of ours (turned off and on again): start over.
    await cloud.query(`DROP SCHEMA public CASCADE`);
    await cloud.query(`CREATE SCHEMA public`);
  }
  await cloud.query(`CREATE SCHEMA IF NOT EXISTS ${CLOUD_MARK_SCHEMA}`);
  await cloud.query(
    `CREATE TABLE IF NOT EXISTS ${CLOUD_MARK_SCHEMA}.installation (id text PRIMARY KEY, since timestamptz NOT NULL DEFAULT now())`,
  );
  await cloud.query(
    `INSERT INTO ${CLOUD_MARK_SCHEMA}.installation (id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [o.installId],
  );

  await local.query(`TRUNCATE ${SYNC_SCHEMA}.outbox`);
  await installTriggers(local);

  const dir = await mkdtemp(join(tmpdir(), "taqseem-sync-"));
  try {
    const dump = join(dir, "copy.dump");
    const list = join(dir, "copy.list");
    await run(tool(o.pgBin, "pg_dump"), [
      "--format=custom",
      "--schema=public",
      "--no-owner",
      "--no-privileges",
      `--file=${dump}`,
      libpqUrl(o.localUrl),
    ]);
    // Leave out the public schema itself (the cloud has one) and our capture triggers.
    const entries = (await run(tool(o.pgBin, "pg_restore"), ["--list", dump])).split(/\r?\n/);
    await writeFile(
      list,
      entries
        .filter(
          (l) =>
            !/ SCHEMA - public /.test(l) &&
            !/COMMENT - SCHEMA public/.test(l) &&
            !l.includes(TRIGGER),
        )
        .join("\n"),
    );
    await run(tool(o.pgBin, "pg_restore"), [
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--exit-on-error",
      `--use-list=${list}`,
      `--dbname=${libpqUrl(o.cloudUrl)}`,
      dump,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Database updates (migrations) the office has and the cloud copy does not, in order. */
async function migrateCloud(local: Db, cloud: Db, migrationsDir: string) {
  const applied = `SELECT * FROM public."_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const [mine, theirs] = await Promise.all([local.query(applied), cloud.query(applied)]);
  const done = new Set(theirs.rows.map((r) => r.migration_name as string));
  for (const row of mine.rows) {
    if (done.has(row.migration_name)) continue;
    const file = join(
      /* turbopackIgnore: true */ migrationsDir,
      row.migration_name,
      "migration.sql",
    );
    if (!existsSync(/* turbopackIgnore: true */ file))
      throw new Error(`The database update ${row.migration_name} is missing.`);
    // In the same request as the update itself: a pooled connection may have lost the path.
    await cloud.query(`${PUBLIC_PATH};
${readFileSync(/* turbopackIgnore: true */ file, "utf8")}`);
    await cloud.query(
      `INSERT INTO public."_prisma_migrations" (id, checksum, finished_at, migration_name, logs,
         rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.id,
        row.checksum,
        row.finished_at,
        row.migration_name,
        row.logs,
        row.rolled_back_at,
        row.started_at,
        row.applied_steps_count,
      ],
    );
  }
}

type TableInfo = { columns: Set<string>; key: string[] };

/** True when the cloud database holds this installation's copy: its mark and Taqseem's tables. */
async function hasOurCopy(cloud: Db, installId: string): Promise<boolean> {
  if ((await cloudOwner(cloud)) !== installId) return false;
  const { rows } = await cloud.query<{ ok: boolean }>(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS ok`,
  );
  return Boolean(rows[0]?.ok);
}

/**
 * What the cloud copy lacks compared with the office database: tables, columns and primary keys
 * ("Customer", "Customer.shopName", "Customer (primary key)"). Empty when the structure is complete.
 */
export async function missingInCloud(local: Db, cloud: Db): Promise<string[]> {
  const [mine, theirs] = await Promise.all([cloudTables(local), cloudTables(cloud)]);
  const missing: string[] = [];
  for (const [name, t] of mine) {
    const c = theirs.get(name);
    if (!c) {
      missing.push(name);
      continue;
    }
    for (const col of t.columns) if (!c.columns.has(col)) missing.push(`${name}.${col}`);
    if ([...t.key].sort().join() !== [...c.key].sort().join())
      missing.push(`${name} (primary key)`);
  }
  return missing;
}

async function cloudTables(cloud: Db): Promise<Map<string, TableInfo>> {
  const { rows } = await cloud.query<{ tbl: string; col: string; key: boolean }>(
    `SELECT c.relname AS tbl, a.attname AS col, coalesce(a.attnum = ANY (i.indkey), false) AS key
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
     WHERE c.relkind = 'r' ORDER BY c.relname, a.attnum`,
  );
  const tables = new Map<string, TableInfo>();
  for (const r of rows) {
    const t = tables.get(r.tbl) ?? { columns: new Set(), key: [] };
    t.columns.add(r.col);
    if (r.key) t.key.push(r.col);
    tables.set(r.tbl, t);
  }
  return tables;
}

/** Applies one recorded change to the cloud copy (repeating it changes nothing). */
async function applyChange(
  cloud: Db,
  tables: Map<string, TableInfo>,
  c: { tbl: string; op: string; row: Record<string, unknown> },
) {
  const t = tables.get(c.tbl);
  if (!t)
    throw new Error(`The cloud copy has no table ${c.tbl}. Its database updates are missing.`);
  if (t.key.length === 0) throw new Error(`The table ${c.tbl} has no primary key.`);
  const table = `public.${q(c.tbl)}`;
  const record = `jsonb_populate_record(NULL::${table}, $1::jsonb)`;
  const json = JSON.stringify(c.row);
  if (c.op === "D") {
    const match = t.key.map((k) => `t.${q(k)} = r.${q(k)}`).join(" AND ");
    await cloud.query(`DELETE FROM ${table} t USING ${record} r WHERE ${match}`, [json]);
    return;
  }
  // Only the columns the row has: a row recorded before a database update leaves new columns to
  // their defaults; a column since removed is ignored.
  const cols = Object.keys(c.row).filter((k) => t.columns.has(k));
  const list = cols.map(q).join(", ");
  const rest = cols.filter((k) => !t.key.includes(k));
  const conflict = `ON CONFLICT (${t.key.map(q).join(", ")})`;
  const action =
    c.op === "I" || rest.length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET (${rest.map(q).join(", ")}) = ROW(${rest.map((k) => `EXCLUDED.${q(k)}`).join(", ")})`;
  await cloud.query(
    `INSERT INTO ${table} (${list}) SELECT ${list} FROM ${record} ${conflict} ${action}`,
    [json],
  );
}

/** Sends the recorded changes in order, in batches; each batch is removed once the cloud has it. */
async function pushChanges(local: Db, cloud: Db): Promise<number> {
  const tables = await cloudTables(cloud);
  let sent = 0;
  for (;;) {
    // In the order the changes were written. A transaction still running is invisible here, and
    // a change can only refer to rows already saved (with lower ids), so a parent always goes
    // before its child. Not by transaction number: those are handed out when a transaction first
    // writes, not when it finishes, so filtering on them could send a child (an order line) while
    // holding back its parent (the order) and the cloud refused it ("violates foreign key").
    const { rows } = await local.query<{
      id: string;
      tbl: string;
      op: string;
      row: Record<string, unknown>;
    }>(`SELECT id::text, tbl, op, row FROM ${SYNC_SCHEMA}.outbox ORDER BY id LIMIT ${BATCH}`);
    if (rows.length === 0) return sent;
    await cloud.query("BEGIN");
    try {
      for (const r of rows) await applyChange(cloud, tables, r);
      await cloud.query("COMMIT");
    } catch (error) {
      await cloud.query("ROLLBACK").catch(() => {});
      throw error;
    }
    await local.query(`DELETE FROM ${SYNC_SCHEMA}.outbox WHERE id = ANY ($1::bigint[])`, [
      rows.map((r) => r.id),
    ]);
    sent += rows.length;
  }
}

// ───────────────────────── One run ─────────────────────────

export type SyncOptions = {
  /** This installation's database. */
  localUrl: string;
  /** Folder of the migration files (prisma/migrations, or the installed copy). */
  migrationsDir: string;
  /** Folder of pg_dump / pg_restore (the installer's pgsql\bin); else they are looked up on PATH. */
  pgBin?: string;
};

export type SyncResult =
  | { status: "off" }
  | { status: "busy" }
  | { status: "done"; copied: boolean; sent: number }
  | { status: "error"; message: string };

/**
 * One sync run, when cloud sync is on: first copy if needed, cloud database updates, then the
 * recorded changes. The outcome is saved in the office database for the settings page.
 */
export async function syncOnce(o: SyncOptions): Promise<SyncResult> {
  const local = new pg.Client({ connectionString: libpqUrl(o.localUrl) });
  await local.connect();
  try {
    await setupLocal(local);
    const lock = await local.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext('taqseem_sync')) AS ok`,
    );
    if (!lock.rows[0]?.ok) return { status: "busy" };
    try {
      const cfg = await readConfig(local);
      if (cfg.enabled !== "true" || !cfg.cloud_url || !cfg.install_id) return { status: "off" };
      const cloud = await connectCloud(cfg.cloud_url);
      try {
        let copied = false;
        const copy = async () => {
          await initialCopy(local, cloud, {
            localUrl: o.localUrl,
            cloudUrl: cfg.cloud_url!,
            installId: cfg.install_id!,
            pgBin: o.pgBin,
          });
          await writeConfig(local, { copied_to: fingerprint(cfg.cloud_url!) });
          copied = true;
        };
        // The structure is checked on every run, not only remembered: a cloud database that was
        // emptied, recreated under the same name or never finished its first copy gets a full copy
        // (tables, keys, data), instead of changes it has no tables for.
        if (
          cfg.copied_to !== fingerprint(cfg.cloud_url) ||
          !(await hasOurCopy(cloud, cfg.install_id))
        ) {
          await copy();
        } else {
          await installTriggers(local);
        }
        await migrateCloud(local, cloud, o.migrationsDir);
        // After its database updates the copy must have every table, column and key the office
        // has; anything still missing (changed by hand, a half-applied update) means a fresh copy.
        // Safe: the cloud database only ever holds this installation's copy.
        if (!copied && (await missingInCloud(local, cloud)).length > 0) await copy();
        let sent: number;
        try {
          sent = await pushChanges(local, cloud);
        } catch (error) {
          // The cloud copy is missing a row a change refers to (it got out of step): it is only a
          // copy, so make it again from this computer's data instead of failing on every run.
          if ((error as { code?: string }).code !== "23503" || copied) throw error;
          await copy();
          sent = await pushChanges(local, cloud);
        }
        await writeConfig(local, { last_sync_at: new Date().toISOString(), last_error: null });
        return { status: "done", copied, sent };
      } finally {
        await cloud.end().catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeConfig(local, {
        last_error: message.slice(0, 500),
        last_error_at: new Date().toISOString(),
      }).catch(() => {});
      return { status: "error", message };
    } finally {
      await local.query(`SELECT pg_advisory_unlock(hashtext('taqseem_sync'))`).catch(() => {});
    }
  } finally {
    await local.end().catch(() => {});
  }
}

/** A new installation id, made once when sync is first turned on. */
export const newInstallId = () => randomUUID();

// ───────────────────────── Restore ─────────────────────────

export type RestoreOptions = SyncOptions & {
  cloudUrl: string;
  /** Where the safety backup of this computer's data is written before it is replaced. */
  backupDir: string;
};

export type RestoreResult = {
  /** The safety backup of the data that was replaced. */
  backupFile: string;
  /** Database updates this program has that the cloud copy did not (applied after the restore). */
  updated: number;
  customers: number;
  orders: number;
};

/** Where the current tables wait while the cloud copy is loaded. */
const OLD = "taqseem_restore_old";

/**
 * Replaces this computer's data with the cloud copy (a new or repaired office computer), then
 * links this installation to that cloud database so sync carries on where it left off.
 *
 *   1. Checks the cloud database holds a Taqseem copy this program can read (not a newer version).
 *   2. Backs up this computer's database to a file, and downloads the cloud copy.
 *   3. Moves the current tables aside, loads the cloud copy in one transaction, and only then drops
 *      the old tables; if loading fails, the old tables are put back.
 *   4. Applies the database updates this program has and the cloud copy did not yet.
 */
export async function restoreFromCloud(o: RestoreOptions): Promise<RestoreResult> {
  const local = new pg.Client({ connectionString: libpqUrl(o.localUrl) });
  await local.connect();
  try {
    await setupLocal(local);
    const lock = await local.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext('taqseem_sync')) AS ok`,
    );
    if (!lock.rows[0]?.ok) throw new Error("A sync is running. Wait a minute and try again.");
    try {
      return await restoreLocked(local, o);
    } finally {
      await local.query(`SELECT pg_advisory_unlock(hashtext('taqseem_sync'))`).catch(() => {});
    }
  } finally {
    await local.end().catch(() => {});
  }
}

/** The installation id of a cloud database holding a Taqseem copy this program can restore. */
async function checkRestorable(cloudUrl: string, migrationsDir: string): Promise<string> {
  let cloud: pg.Client;
  try {
    cloud = await connectCloud(cloudUrl);
  } catch (error) {
    throw new Error(
      `Could not reach the cloud database: ${error instanceof Error ? error.message : error}. Check the connection string and the internet.`,
    );
  }
  try {
    const owner = await cloudOwner(cloud);
    const tables = await cloud.query<{ ok: boolean }>(
      `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL
          AND to_regclass('public."Tenant"') IS NOT NULL AS ok`,
    );
    if (!owner || !tables.rows[0]?.ok)
      throw new Error("This cloud database has no Taqseem copy to restore.");
    const { rows } = await cloud.query<{ name: string }>(
      `SELECT migration_name AS name FROM public."_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    if (rows.some((r) => !existsSync(migrationFile(migrationsDir, r.name))))
      throw new Error(
        "The cloud copy was made by a newer version of Taqseem. Update this computer to the latest version first, then restore.",
      );
    return owner;
  } finally {
    await cloud.end().catch(() => {});
  }
}

const migrationFile = (dir: string, name: string) =>
  join(/* turbopackIgnore: true */ dir, name, "migration.sql");

async function restoreLocked(local: Db, o: RestoreOptions): Promise<RestoreResult> {
  const installId = await checkRestorable(o.cloudUrl, o.migrationsDir);

  const dir = await mkdtemp(join(tmpdir(), "taqseem-restore-"));
  try {
    // 2. Safety backup of what is here now (every schema; pg_restore can bring it back).
    await mkdir(/* turbopackIgnore: true */ o.backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const backupFile = join(
      /* turbopackIgnore: true */ o.backupDir,
      `taqseem-before-restore-${stamp}.dump`,
    );
    await run(tool(o.pgBin, "pg_dump"), [
      "--format=custom",
      "--no-owner",
      `--file=${backupFile}`,
      libpqUrl(o.localUrl),
    ]);

    // The cloud copy, downloaded before anything here changes.
    const dump = join(dir, "cloud.dump");
    const list = join(dir, "cloud.list");
    await run(tool(o.pgBin, "pg_dump"), [
      "--format=custom",
      "--schema=public",
      "--no-owner",
      "--no-privileges",
      `--file=${dump}`,
      libpqUrl(o.cloudUrl),
    ]);
    const entries = (await run(tool(o.pgBin, "pg_restore"), ["--list", dump])).split(/\r?\n/);
    await writeFile(
      list,
      entries
        .filter(
          (l) =>
            !/ SCHEMA - public /.test(l) &&
            !/COMMENT - SCHEMA public/.test(l) &&
            !l.includes(TRIGGER),
        )
        .join("\n"),
    );

    // 3. The swap.
    await local.query(`DROP SCHEMA IF EXISTS ${OLD} CASCADE`);
    await local.query(`BEGIN`);
    await local.query(`ALTER SCHEMA public RENAME TO ${OLD}`);
    await local.query(`CREATE SCHEMA public`);
    await local.query(`COMMIT`);
    try {
      await run(tool(o.pgBin, "pg_restore"), [
        "--no-owner",
        "--no-privileges",
        "--single-transaction",
        "--exit-on-error",
        `--use-list=${list}`,
        `--dbname=${libpqUrl(o.localUrl)}`,
        dump,
      ]);
    } catch (error) {
      await local.query(`BEGIN`);
      await local.query(`DROP SCHEMA public CASCADE`);
      await local.query(`ALTER SCHEMA ${OLD} RENAME TO public`);
      await local.query(`COMMIT`);
      throw error;
    }
    await local.query(`DROP SCHEMA ${OLD} CASCADE`);

    // 4. Database updates of this program the cloud copy did not have yet.
    const updated = await migrateLocal(local, o.migrationsDir);

    // Sync carries on into the same cloud database, as the same installation; the next run sends
    // these database updates to the cloud copy too.
    await local.query(`TRUNCATE ${SYNC_SCHEMA}.outbox`);
    await installTriggers(local);
    await writeConfig(local, {
      enabled: "true",
      cloud_url: o.cloudUrl,
      install_id: installId,
      copied_to: fingerprint(o.cloudUrl),
      restored_at: new Date().toISOString(),
      last_error: null,
    });

    const counts = await local.query<{ c: number; o: number }>(
      `SELECT (SELECT count(*) FROM "Customer")::int AS c,
              (SELECT count(*) FROM "SalesOrder")::int AS o`,
    );
    return { backupFile, updated, customers: counts.rows[0]!.c, orders: counts.rows[0]!.o };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Applies the migration files missing from this database's _prisma_migrations, in order. */
async function migrateLocal(local: Db, migrationsDir: string): Promise<number> {
  const { rows } = await local.query<{ name: string }>(
    `SELECT migration_name AS name FROM public."_prisma_migrations"
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  const done = new Set(rows.map((r) => r.name));
  const names = readdirSync(/* turbopackIgnore: true */ migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !done.has(d.name))
    .map((d) => d.name)
    .filter((name) => existsSync(migrationFile(migrationsDir, name)))
    .sort();
  for (const name of names) {
    const sql = readFileSync(
      /* turbopackIgnore: true */ migrationFile(migrationsDir, name),
      "utf8",
    );
    const started = new Date();
    await local.query(`BEGIN`);
    try {
      await local.query(sql);
      // As Prisma records it (checksum: SHA-256 of migration.sql), so later updates carry on.
      await local.query(
        `INSERT INTO public."_prisma_migrations"
           (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, $4, 1)`,
        [randomUUID(), createHash("sha256").update(sql).digest("hex"), name, started],
      );
      await local.query(`COMMIT`);
    } catch (error) {
      await local.query(`ROLLBACK`).catch(() => {});
      throw new Error(
        `The database update ${name} failed after the restore: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return names.length;
}
