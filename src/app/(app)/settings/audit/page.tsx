import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { formatDateTime } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listAuditLog } from "@/server/services/audit-log";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Audit log" };

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Changed",
  DELETE: "Deleted",
  POST: "Posted",
  REVERSE: "Reversed",
  APPROVE: "Approved",
  REJECT: "Rejected",
  LOGIN: "Signed in",
};

function Value({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details>
      <summary className="text-muted-foreground cursor-pointer text-xs">{label}</summary>
      <pre className="bg-muted mt-1 max-h-64 max-w-xl overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export default function AuditLogPage({ searchParams }: PageProps<"/settings/audit">) {
  return (
    <RequirePermission permission="audit.view">
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Audit log"
        description="Every change to orders, bills, payments, stock, rates and master data: who, when, and the old and new values."
      />
      <Log searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Log({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("audit.view");
  const log = await listAuditLog(ctx, {
    q,
    page,
    entityType: filterParam(sp, "entityType"),
    action: filterParam(sp, "action"),
    userId: filterParam(sp, "userId"),
    ...parseDateRange(sp),
  });
  return (
    <>
      <ListToolbar
        basePath="/settings/audit"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Record id"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "When" }}
        filters={[
          {
            name: "entityType",
            label: "Record",
            value: filterParam(sp, "entityType"),
            options: log.entityTypes.map((t) => ({ value: t, label: t })),
          },
          {
            name: "action",
            label: "Action",
            value: filterParam(sp, "action"),
            options: log.actions.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a })),
          },
          {
            name: "userId",
            label: "User",
            value: filterParam(sp, "userId"),
            options: log.users.map((u) => ({ value: u.id, label: u.name })),
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>User</Th>
            <Th>Action</Th>
            <Th>Record</Th>
            <Th>Values</Th>
          </tr>
        </thead>
        <tbody>
          {log.rows.length === 0 ? (
            <EmptyRow colSpan={5}>No entries match these filters.</EmptyRow>
          ) : null}
          {log.rows.map((r) => (
            <tr key={r.id} className="align-top">
              <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
              <Td>{r.user?.name ?? "System"}</Td>
              <Td>{ACTION_LABEL[r.action] ?? r.action}</Td>
              <Td>
                {r.entityType}
                <div className="text-muted-foreground font-mono text-xs">{r.entityId}</div>
              </Td>
              <Td className="space-y-1">
                <Value label="Before" value={r.oldValue} />
                <Value label="After" value={r.newValue} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/settings/audit"
        searchParams={sp}
        page={log.page}
        pageCount={log.pageCount}
        total={log.total}
      />
    </>
  );
}
