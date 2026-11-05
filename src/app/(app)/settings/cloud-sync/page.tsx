import type { Metadata } from "next";

import { ConfirmAction } from "@/components/form/confirm-action";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { CloudRestoreForm } from "@/components/settings/cloud-restore-form";
import { CloudSyncForm } from "@/components/settings/cloud-sync-form";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/auth/session";
import { getCloudSync } from "@/server/services/cloud-sync";
import {
  disableCloudSyncAction,
  enableCloudSyncAction,
  restoreFromCloudAction,
  syncNowAction,
} from "@/server/settings-actions";

export const metadata: Metadata = { title: "Cloud sync" };

export default function CloudSyncPage() {
  return (
    <RequirePermission permission="settings.manage">
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Cloud sync"
        description="Keep a copy of this computer's data in your own cloud database: an off-site backup that stays up to date. Taqseem keeps working without internet; changes wait and are sent when the internet is back."
      />
      <Status />
    </RequirePermission>
  );
}

async function Status() {
  const ctx = await requireTenantContext("settings.manage");
  const s = await getCloudSync(ctx);
  return (
    <div className="max-w-3xl space-y-6">
      <section aria-labelledby="sync-status" className="space-y-3 rounded-lg border p-4">
        <h2 id="sync-status" className="flex items-center gap-2 font-medium">
          Status
          {s.enabled ? (
            s.lastError ? (
              <Badge variant="destructive">On, with a problem</Badge>
            ) : (
              <Badge variant="secondary">On</Badge>
            )
          ) : (
            <Badge variant="outline">Off</Badge>
          )}
        </h2>
        <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Cloud database</dt>
          <dd>{s.target ?? "—"}</dd>
          <dt className="text-muted-foreground">Full copy</dt>
          <dd>{s.copied ? "Made" : s.enabled ? "Waiting for the first run" : "—"}</dd>
          <dt className="text-muted-foreground">Last sent</dt>
          <dd>{s.lastSyncAt ? formatDateTime(new Date(s.lastSyncAt)) : "Never"}</dd>
          <dt className="text-muted-foreground">Changes waiting</dt>
          <dd className="tabular-nums">
            {s.pending}
            {s.pending > 0 && s.enabled ? " (sent when the internet is up)" : ""}
          </dd>
          {s.restoredAt ? (
            <>
              <dt className="text-muted-foreground">Restored from the cloud</dt>
              <dd>{formatDateTime(new Date(s.restoredAt))}</dd>
            </>
          ) : null}
        </dl>
        {s.lastError ? (
          <p role="alert" className="text-destructive text-sm">
            Last problem
            {s.lastErrorAt ? ` (${formatDateTime(new Date(s.lastErrorAt))})` : ""}: {s.lastError}
          </p>
        ) : null}
        {s.enabled ? (
          <div className="flex flex-wrap gap-2">
            <ConfirmAction
              action={syncNowAction}
              label="Sync now"
              confirm="Send all waiting changes to the cloud now?"
            />
            <ConfirmAction
              action={disableCloudSyncAction}
              label="Turn off"
              confirm="Turn cloud sync off? Nothing more is sent; the cloud copy stays as it is. Turning it on again makes a fresh full copy."
            />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="sync-setup" className="space-y-3">
        <h2 id="sync-setup" className="font-medium">
          {s.enabled ? "Change the cloud database" : "Turn it on"}
        </h2>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          <li>
            Make a free account at <strong>neon.tech</strong> (or supabase.com) and create a new
            project with <strong>PostgreSQL 17</strong>. Use one project for each Taqseem computer:
            each installation has its own cloud database.
          </li>
          <li>
            Copy its connection string (Neon: <em>Connect</em>, with &ldquo;Connection
            pooling&rdquo; off; Supabase: <em>Connect → Session pooler</em>). It looks like
            <code className="mx-1">postgresql://user:password@host/dbname?sslmode=require</code>.
          </li>
          <li>
            Paste it below. Taqseem checks it, then copies everything and keeps it up to date.
          </li>
        </ol>
        <CloudSyncForm action={enableCloudSyncAction} enabled={s.enabled} />
      </section>

      <section aria-labelledby="sync-restore" className="space-y-3 rounded-lg border p-4">
        <h2 id="sync-restore" className="font-medium">
          Restore from the cloud copy
        </h2>
        <p className="text-muted-foreground text-sm">
          For a new or repaired office computer: install Taqseem, sign in, and bring the data back
          from the cloud copy. <strong>All data on this computer is replaced</strong> (it is saved
          to a backup file first). Users and passwords come back too, so everyone signs in with
          their usual login afterwards, and sync carries on into the same cloud database.
        </p>
        <p className="text-muted-foreground text-sm">
          Use it on one computer only: if the old office computer still works, turn its cloud sync
          off first, so two computers never send to the same cloud copy.
        </p>
        <CloudRestoreForm action={restoreFromCloudAction} />
      </section>
    </div>
  );
}
