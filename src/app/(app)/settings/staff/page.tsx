import type { Metadata } from "next";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { EditLink, LinkButton, StatusBadge } from "@/components/master/page-helpers";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listStaff } from "@/server/services/master/staff";

import { STAFF_ROLE_OPTIONS } from "../master-fields";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage({ searchParams }: PageProps<"/settings/staff">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Staff"
        description="Drivers and office staff on the payroll. Logins are managed under Users."
        actions={<LinkButton href="/settings/staff/new">New staff member</LinkButton>}
      />
      <List searchParams={searchParams} />
    </RequirePermission>
  );
}

async function List({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("masterData.manage");
  const list = await listStaff(ctx, params, sp);
  const roleLabel = (role: string) =>
    STAFF_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
  return (
    <>
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/settings/staff"
        params={params}
        searchPlaceholder="Name or phone"
        filters={[
          {
            name: "role",
            label: "Role",
            value: filterParam(sp, "role"),
            options: STAFF_ROLE_OPTIONS,
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Phone</Th>
            <Th className="text-right">Monthly salary</Th>
            <Th>Joined</Th>
            <Th>Bike</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={7}>No staff match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((s) => (
            <tr key={s.id}>
              <Td>
                <EditLink href={`/settings/staff/${s.id}`} label={s.name} />
              </Td>
              <Td>{roleLabel(s.role)}</Td>
              <Td className="whitespace-nowrap">{s.phone ?? "—"}</Td>
              <Td className="text-right tabular-nums">{formatMoney(s.monthlySalary)}</Td>
              <Td className="whitespace-nowrap">
                {s.joiningDate ? formatDate(s.joiningDate) : "—"}
              </Td>
              <Td>{s.bikes.map((b) => b.name).join(", ") || "—"}</Td>
              <Td>
                <StatusBadge isActive={s.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/settings/staff"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
