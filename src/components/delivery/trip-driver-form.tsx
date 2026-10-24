"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionState, idleState } from "@/lib/action-state";

/** Sets, changes or clears the trip's driver (until day-end is done). */
export function TripDriverForm({
  action,
  driverId,
  staff,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  driverId: string | null;
  staff: { id: string; name: string; role: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="trip-driver" className="font-medium">
        Driver
      </label>
      <NativeSelect id="trip-driver" name="driverId" defaultValue={driverId ?? ""} className="w-56">
        <option value="">Not set</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.role === "DRIVER" ? "" : ` (${s.role.toLowerCase()})`}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save driver"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
