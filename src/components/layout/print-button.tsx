"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Prints the page (and "Save as PDF" in the browser's print dialog). */
export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
