"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Label } from "@hunter/ui";
import { suggestContactsAction, addSuggestedContactAction } from "./actions";

interface CompanyOption {
  id: string;
  name: string;
}

/**
 * Zero-cost, zero-AI fallback for when you don't have a real contact yet:
 * common-pattern address guesses (careers@, talent@, ...), always shown and
 * saved as LOW confidence — never presented as if they were verified.
 */
export function SuggestContactsPanel({ companies }: { companies: CompanyOption[] }) {
  const [companyId, setCompanyId] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ email: string; confidence: "LOW" }>>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="suggestCompanyId">Company</Label>
        <select
          id="suggestCompanyId"
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            setSuggestions([]);
            setAdded(new Set());
            setChecked(false);
          }}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">Select a company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="outline"
        loading={pending}
        disabled={!companyId}
        className="w-fit"
        onClick={() =>
          startTransition(async () => {
            const result = await suggestContactsAction(companyId);
            setSuggestions(result);
            setChecked(true);
          })
        }
      >
        {pending ? "Looking up…" : "Suggest common addresses"}
      </Button>

      {checked && suggestions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No domain on file for this company, so there's nothing to guess a pattern from.
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {suggestions.map((s) => (
            <li key={s.email} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {s.email} <Badge variant="outline">guess, unverified</Badge>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={added.has(s.email)}
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    await addSuggestedContactAction(companyId, s.email);
                    setAdded((prev) => new Set(prev).add(s.email));
                  })
                }
              >
                {added.has(s.email) ? "Added" : "Add as contact"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
