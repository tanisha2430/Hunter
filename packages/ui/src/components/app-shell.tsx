import * as React from "react";
import { cn } from "../lib/cn";

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

export interface AppShellProps {
  navItems: NavItem[];
  activeHref: string;
  /** Defaults to a plain <a> — pass Next.js's `Link` from apps/web for client-side nav. */
  LinkComponent?: React.ComponentType<{ href: string; className?: string; children: React.ReactNode }>;
  userLabel?: string;
  commandBox?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The authenticated app shell: a fixed left sidebar (brand + nav + user footer)
 * and a top bar (page title slot handled by each page) wrapping page content.
 * Kept framework-agnostic (no next/link import) so it stays reusable if a
 * future app shares this package.
 */
export function AppShell({
  navItems,
  activeHref,
  LinkComponent,
  userLabel,
  commandBox,
  children,
}: AppShellProps) {
  const Anchor = LinkComponent ?? (({ href, className, children }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ));

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center border-b border-border px-4">
          <span className="text-sm font-semibold tracking-tight">AI Job Hunter</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <Anchor
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.icon}
                {item.label}
              </Anchor>
            );
          })}
        </nav>
        {userLabel ? (
          <div className="border-t border-border p-3 text-xs text-muted-foreground">{userLabel}</div>
        ) : null}
      </aside>
      <div className="flex flex-1 flex-col">
        {commandBox ? (
          <div className="border-b border-border bg-surface px-6 py-3">{commandBox}</div>
        ) : null}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
