/**
 * Minimal robots.txt check — only what's needed to honor a `Disallow` on the
 * exact path we're about to fetch. Not a full robots.txt parser (no
 * wildcard/crawl-delay handling); when in doubt this errs toward refusing
 * rather than guessing permissively.
 */
export async function isAllowedByRobotsTxt(targetUrl: string, userAgent = "*"): Promise<boolean> {
  const url = new URL(targetUrl);
  const robotsUrl = `${url.origin}/robots.txt`;

  let robotsText: string;
  try {
    const res = await fetch(robotsUrl);
    if (!res.ok) return true; // no robots.txt (or unreadable) => nothing disallowed
    robotsText = await res.text();
  } catch {
    return true;
  }

  const lines = robotsText.split("\n").map((l) => l.trim());
  let applies = false;
  const disallowedPaths: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#") || line.length === 0) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === userAgent.toLowerCase();
    } else if (applies && key === "disallow" && value) {
      disallowedPaths.push(value);
    }
  }

  return !disallowedPaths.some((path) => url.pathname.startsWith(path));
}
