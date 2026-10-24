"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * Makes the surrounding filter form apply itself: the search box after a short pause in typing
 * (no Enter needed), dropdowns and dates as soon as they change. Renders nothing; without
 * JavaScript the form still works with Enter or its button.
 */
export function AutoSubmit({ delayMs = 350 }: { delayMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const submit = () => {
      clearTimeout(timer);
      form.requestSubmit();
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el.type !== "search") return;
      clearTimeout(timer);
      timer = setTimeout(submit, delayMs);
    };
    const onChange = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "SELECT" || (el as HTMLInputElement).type === "date") submit();
    };
    form.addEventListener("input", onInput);
    form.addEventListener("change", onChange);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onChange);
    };
  }, [delayMs]);
  return <span ref={ref} hidden />;
}

/**
 * Clears the filter form and applies it. The boxes are uncontrolled, so following a plain link
 * would leave the old text in them; the link stays for when JavaScript is off.
 */
export function ClearFilters({ href }: { href: string }) {
  return (
    <Button asChild variant="ghost">
      <Link
        href={href}
        onClick={(e) => {
          const form = (e.currentTarget as HTMLElement).closest("form");
          if (!form) return;
          e.preventDefault();
          for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            "input[name], select[name]",
          )) {
            if (el instanceof HTMLSelectElement) el.selectedIndex = 0;
            else if (el.type !== "hidden") el.value = "";
          }
          form.requestSubmit();
        }}
      >
        Clear
      </Link>
    </Button>
  );
}
