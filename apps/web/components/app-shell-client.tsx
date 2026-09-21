"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  ClipboardList,
  Mail,
  Settings,
  UserCircle,
  Sparkles,
} from "lucide-react";
import { AppShell, type NavItem } from "@hunter/ui";
import { CommandBox } from "./command-box";

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  // More specific than "/jobs" — must come first so activeHref matching
  // (which checks pathname.startsWith(item.href)) picks this one for
  // /jobs/fresh rather than falling through to the generic Jobs entry.
  { href: "/jobs/fresh", label: "Fresh Matches", icon: <Sparkles className="h-4 w-4" /> },
  { href: "/jobs", label: "Jobs", icon: <Briefcase className="h-4 w-4" /> },
  { href: "/applications", label: "Applications", icon: <ClipboardList className="h-4 w-4" /> },
  { href: "/resumes", label: "Resumes", icon: <FileText className="h-4 w-4" /> },
  { href: "/outreach", label: "Outreach", icon: <Mail className="h-4 w-4" /> },
  { href: "/profile", label: "Profile", icon: <UserCircle className="h-4 w-4" /> },
  { href: "/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

export function AppShellClient({
  userLabel,
  children,
}: {
  userLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeHref =
    NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href ??
    "/dashboard";

  return (
    <AppShell
      navItems={NAV_ITEMS}
      activeHref={activeHref}
      LinkComponent={Link}
      userLabel={userLabel}
      commandBox={<CommandBox />}
    >
      {children}
    </AppShell>
  );
}
