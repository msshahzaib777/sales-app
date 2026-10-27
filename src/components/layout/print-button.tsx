"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Opens the print dialog once the page has loaded (e.g. "Save and print bill"). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}

/** Prints the page (and "Save as PDF" in the browser's print dialog). */
export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
