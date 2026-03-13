"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ITEMS } from "@/src/config/app.config";
import { Button } from "@/src/components/ui";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<string[]>([]);

  function toggleExpanded(href: string) {
    setExpanded((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    );
  }

  function isExpanded(href: string) {
    return expanded.includes(href);
  }

  return (
    <aside className={["sticky top-0 h-screen border-r border-white/[0.06] bg-surface p-4 flex flex-col", collapsed ? "w-16" : "w-64"].join(" ")}>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <a href="https://renewableenergyincentives.com" target="_blank" rel="noopener noreferrer">
              <img src="/logo.png" alt="Renewable Energy Incentives" className="h-14 w-auto" />
            </a>
          )}
          <Button variant="ghost" onClick={onToggle} aria-label="Toggle sidebar">
            {collapsed ? "→" : "←"}
          </Button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const hasChildren = Array.isArray(item.children) && item.children.length > 0;
          const open = isExpanded(item.href) || active;

          if (hasChildren && !collapsed) {
            return (
              <div key={item.href}>
                <button
                  onClick={() => toggleExpanded(item.href)}
                  className={[
                    "w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-emerald-500/10 text-emerald-400 font-medium"
                      : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
                  ].join(" ")}
                >
                  <span>{item.label}</span>
                  <span className="text-xs">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="mt-1 ml-3 space-y-1 border-l border-white/[0.06] pl-3">
                    {item.children!.map((child) => {
                      const childActive = pathname === child.href || (child.href !== item.href && pathname.startsWith(child.href + "/"));
                      return (
                        <Link
                          key={child.href}
                          href={child.href as Route}
                          className={[
                            "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                            childActive
                              ? "bg-emerald-500/10 text-emerald-400 font-medium"
                              : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
                          ].join(" ")}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href as Route}
              className={[
                "block rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-emerald-500/10 text-emerald-400 font-medium"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
              ].join(" ")}
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

