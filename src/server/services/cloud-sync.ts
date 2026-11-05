import "server-only";

import { join } from "node:path";

import pg from "pg";
import { z } from "zod";

import { writeAudit } from "../audit";
import { assertCan } from "../auth/permissions";
import { prisma } from "../db/client";
import {
  checkCloud,
  describeUrl,
  libpqUrl,
  newInstallId,
  pendingCount,
  readConfig,
  removeTriggers,
  restoreFromCloud as restoreEngine,
  type RestoreResult,
  setupLocal,
  writeConfig,
} from "../sync/engine";
import { ServiceError } from "./errors";
import type { ServiceCtx } from "./master/common";

// Settings → Cloud sync (owner only): turn the one-way copy of this installation's database to a
// cloud PostgreSQL on or off, and see how it is going. The work itself is in ../sync/engine.ts,
// run by the website's background agent. One installation is one business: the whole database is
// copied, so it is refused where several businesses share this database (the hosted service).

const urlSchema = z
  .string({ error: "Paste the connection string" })
  .trim()
  .min(1, "Paste the connection string")
  .max(500)
  .refine((v) => /^postgres(ql)?:\/\/[^@]+@[^/]+\/\w/.test(v), {
    message: "Use the PostgreSQL connection string, e.g. postgresql://user:password@host/dbname",
  });

async function withLocal<T>(body: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: libpqUrl(process.env.DATABASE_URL ?? "") });
  await db.connect();
  try {
    await setupLocal(db);
    return await body(db);
  } finally {
    await db.end().catch(() => {});
  }
}

async function oneBusinessOnly() {
  if ((await prisma.tenant.count()) > 1)
    throw new ServiceError(
      "Cloud sync copies the whole database, so it is for an installation with one business only.",
    );
}

export type CloudSyncStatus = {
  enabled: boolean;
  /** Host and database name, never the password. */
  target: string | null;
  copied: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  pending: number;
  /** When this computer's data was last replaced by the cloud copy. */
  restoredAt: string | null;
};

export async function getCloudSync(ctx: ServiceCtx): Promise<CloudSyncStatus> {
  assertCan(ctx.user.role, "settings.manage");
  return withLocal(async (db) => {
    const cfg = await readConfig(db);
    return {
      enabled: cfg.enabled === "true",
      target: cfg.cloud_url ? describeUrl(cfg.cloud_url) : null,
      copied: Boolean(cfg.copied_to),
      lastSyncAt: cfg.last_sync_at ?? null,
      lastError: cfg.last_error ?? null,
      lastErrorAt: cfg.last_error_at ?? null,
      pending: await pendingCount(db),
      restoredAt: cfg.restored_at ?? null,
    };
  });
}

/**
 * Checks the cloud database (reachable, PostgreSQL 17+, empty or already this installation's) and
 * turns sync on. A new database starts with a full copy on the next run.
 */
export async function enableCloudSync(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "settings.manage");
  const url = urlSchema.parse((input as { url?: unknown })?.url);
  await oneBusinessOnly();
  await withLocal(async (db) => {
    const cfg = await readConfig(db);
    const installId = cfg.install_id ?? newInstallId();
    const cloud = new pg.Client({
      connectionString: libpqUrl(url),
      connectionTimeoutMillis: 15_000,
    });
    try {
      await cloud.connect();
    } catch (error) {
      throw new ServiceError(
        `Could not reach the cloud database: ${error instanceof Error ? error.message : error}. Check the connection string and the internet.`,
      );
    }
    try {
      await checkCloud(cloud, installId);
    } catch (error) {
      throw new ServiceError(error instanceof Error ? error.message : String(error));
    } finally {
      await cloud.end().catch(() => {});
    }
    const sameTarget = cfg.cloud_url && describeUrl(cfg.cloud_url) === describeUrl(url);
    await writeConfig(db, {
      install_id: installId,
      cloud_url: url,
      enabled: "true",
      // Another database gets its own full copy.
      copied_to: sameTarget ? (cfg.copied_to ?? null) : null,
      last_error: null,
    });
  });
  await writeAudit(ctx.db, ctx.user, {
    action: "UPDATE",
    entityType: "CloudSync",
    entityId: ctx.user.tenantId,
    newValue: { enabled: true, target: describeUrl(url) },
  });
}

/** Turns sync off: nothing more is recorded or sent; the cloud copy stays as it is. */
export async function disableCloudSync(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "settings.manage");
  await withLocal(async (db) => {
    await removeTriggers(db);
    // Turning it on again makes a fresh full copy.
    await writeConfig(db, { enabled: "false", copied_to: null });
  });
  await writeAudit(ctx.db, ctx.user, {
    action: "UPDATE",
    entityType: "CloudSync",
    entityId: ctx.user.tenantId,
    newValue: { enabled: false },
  });
}

const restoreSchema = z.object({
  url: urlSchema,
  confirm: z
    .string()
    .trim()
    .refine((v) => v.toUpperCase() === "RESTORE", { message: "Type RESTORE to confirm" }),
});

/**
 * Replaces all of this computer's data with the cloud copy (a new or repaired office computer).
 * This computer's data is backed up to a file first. The users, passwords and audit log come
 * from the cloud copy too, so everyone signs in again with their old login; the audit log of this
 * computer is in the backup. Sync then carries on into the same cloud database.
 */
export async function restoreFromCloud(ctx: ServiceCtx, input: unknown): Promise<RestoreResult> {
  assertCan(ctx.user.role, "settings.manage");
  const { url } = restoreSchema.parse(input);
  await oneBusinessOnly();
  const localUrl = process.env.DATABASE_URL;
  if (!localUrl) throw new ServiceError("This computer's database is not configured.");
  try {
    return await restoreEngine({
      localUrl,
      cloudUrl: url,
      migrationsDir:
        process.env.TAQSEEM_MIGRATIONS_DIR ??
        join(/* turbopackIgnore: true */ process.cwd(), "prisma", "migrations"),
      pgBin: process.env.PG_BIN,
      backupDir:
        process.env.TAQSEEM_BACKUP_DIR ??
        join(/* turbopackIgnore: true */ process.cwd(), ".backups"),
    });
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : String(error));
  }
}
