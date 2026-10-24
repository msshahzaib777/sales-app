"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// The sidebar can shrink to icons only. The choice is kept in this browser (a convenience, not
// data) and set on the <aside> as data-collapsed; CSS (group/sidebar) does the rest.

const KEY = "taqseem.sidebar.collapsed";

/** Applies the saved choice before the first paint, so the sidebar does not jump on load. */
export const SIDEBAR_INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(KEY)})==="1"){document.currentScript.parentElement.dataset.collapsed="true"}}catch(e){}`;

export function SidebarToggle() {
  const ref = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const aside = ref.current?.closest("aside");
    setCollapsed(aside?.dataset.collapsed === "true");
  }, []);

  const toggle = () => {
    const aside = ref.current?.closest("aside");
    if (!aside) return;
    const next = !collapsed;
    aside.dataset.collapsed = String(next);
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Private window or storage blocked: it just won't be remembered.
    }
  };

  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring rounded-md p-1.5 outline-none focus-visible:ring-2"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
