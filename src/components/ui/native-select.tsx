import * as React from "react";

import { cn } from "@/lib/utils";

/** A plain <select> styled like the inputs. Lighter than a JS dropdown and keyboard-friendly. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input flex h-9 w-full rounded-md border bg-transparent px-2 py-1 text-base shadow-xs outline-none md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
