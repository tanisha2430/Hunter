"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, Drawer, Badge } from "@hunter/ui";
import type { DashboardDetailItem, DashboardMetricKey } from "@hunter/core";
import { getMetricDetail } from "./actions";

export interface MetricTile {
  key: DashboardMetricKey;
  label: string;
  value: string | number;
}

const STATUS_LABELS: Record<string, string> = {
  DISCOVERED: "Discovered",
  MATCHED: "Matched",
  SHORTLISTED: "Shortlisted",
  PREPARING: "Preparing",
  READY_FOR_REVIEW: "Ready for review",
  APPROVED: "Approved",
  SUBMITTED: "Submitted — under review",
  FAILED: "Failed",
  RECRUITER_REPLIED: "Recruiter replied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  TECHNICAL: "Technical round",
  HR: "HR round",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export function MetricTiles({ tiles }: { tiles: MetricTile[] }) {
  const [openMetric, setOpenMetric] = useState<MetricTile | null>(null);
  const [items, setItems] = useState<DashboardDetailItem[]>([]);
  const [pending, startTransition] = useTransition();

  function openTile(tile: MetricTile) {
    setOpenMetric(tile);
    startTransition(async () => {
      const detail = await getMetricDetail(tile.key);
      setItems(detail);
    });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <button key={tile.key} type="button" onClick={() => openTile(tile)} className="text-left">
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="text-xs font-medium text-muted-foreground">{tile.label}</CardTitle>
              </CardHeader>
              <CardContent className="pt-2 text-2xl font-semibold">{tile.value}</CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Drawer
        open={openMetric !== null}
        onClose={() => setOpenMetric(null)}
        title={openMetric?.label ?? ""}
        description={openMetric ? `${openMetric.value} total` : undefined}
      >
        {pending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item, i) => (
              <li key={item.applicationId ?? item.jobId ?? i} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.jobTitle}</p>
                    <p className="text-xs text-muted-foreground">{item.company}</p>
                  </div>
                  {item.source === "EXTERNAL" ? (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      via email
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {item.status ? <Badge className="text-[10px]">{STATUS_LABELS[item.status] ?? item.status}</Badge> : null}
                  {item.score !== undefined ? <span>Match: {Math.round(item.score)}%</span> : null}
                  {item.lastStatusChangeAt ? (
                    <span>Updated {new Date(item.lastStatusChangeAt).toLocaleDateString()}</span>
                  ) : null}
                </div>
                <a
                  href={item.applicationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-primary hover:underline"
                >
                  Open →
                </a>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </>
  );
}
