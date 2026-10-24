"use client";

import { useState, useTransition } from "react";

import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { deleteRecordAction, setActiveAction } from "@/server/master-actions";
import type { MasterEntity } from "@/server/services/master/common";

/**
 * Deactivate / reactivate, and delete for records that were never used. The server decides
 * whether delete is allowed and explains when it is not.
 */
export function RecordStatusActions({
  entity,
  id,
  label,
  isActive,
  canDelete = true,
}: {
  entity: MasterEntity;
  id: string;
  /** e.g. "this customer" */
  label: string;
  isActive: boolean;
  canDelete?: boolean;
}) {
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const run = (confirmText: string, action: () => Promise<ActionState>) => {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => setState(await action()));
  };

  return (
    <section aria-labelledby="status-heading" className="max-w-4xl space-y-3 rounded-lg border p-4">
      <h2 id="status-heading" className="font-medium">
        Status
      </h2>
      <p className="text-muted-foreground text-sm">
        {isActive
          ? `Deactivating hides ${label} from pick lists but keeps all its history.`
          : `${label[0]!.toUpperCase()}${label.slice(1)} is deactivated and hidden from pick lists.`}
        {canDelete ? " Delete is only possible if it was never used." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(isActive ? `Deactivate ${label}?` : `Reactivate ${label}?`, () =>
              setActiveAction(entity, id, !isActive),
            )
          }
        >
          {isActive ? "Deactivate" : "Reactivate"}
        </Button>
        {canDelete ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(`Delete ${label} permanently?`, () => deleteRecordAction(entity, id))
            }
          >
            Delete
          </Button>
        ) : null}
      </div>
      <FormMessage state={state} />
    </section>
  );
}
