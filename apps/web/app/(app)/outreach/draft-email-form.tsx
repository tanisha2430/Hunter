"use client";

import { useActionState, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Label, Textarea } from "@hunter/ui";
import {
  draftColdEmailAction,
  createManualDraftAction,
  addContactAction,
  type DraftEmailState,
  type AddContactState,
} from "./actions";
import { SuggestContactsPanel } from "./suggest-contacts-panel";

interface CompanyOption {
  id: string;
  name: string;
}
interface ContactOption {
  id: string;
  companyId: string;
  fullName: string | null;
  email: string | null;
}

const draftInitial: DraftEmailState = {};
const contactInitial: AddContactState = {};

export function OutreachForms({ companies, contacts }: { companies: CompanyOption[]; contacts: ContactOption[] }) {
  const [draftState, draftAction, draftPending] = useActionState(draftColdEmailAction, draftInitial);
  const [manualState, manualAction, manualPending] = useActionState(createManualDraftAction, draftInitial);
  const [contactState, contactAction, contactPending] = useActionState(addContactAction, contactInitial);
  const [mode, setMode] = useState<"ai" | "manual">("ai");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Add a contact</CardTitle>
          <CardDescription>Only add someone you actually found yourself — never fabricated.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={contactAction} className="flex flex-col gap-3">
            <CompanySelect companies={companies} />
            <input name="fullName" placeholder="Full name" className="h-9 rounded-md border border-border bg-surface px-3 text-sm" />
            <input name="title" placeholder="Title (e.g. Recruiter)" className="h-9 rounded-md border border-border bg-surface px-3 text-sm" />
            <input name="email" type="email" placeholder="Email" className="h-9 rounded-md border border-border bg-surface px-3 text-sm" />
            <input name="linkedinUrl" placeholder="LinkedIn URL" className="h-9 rounded-md border border-border bg-surface px-3 text-sm" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="verified" className="h-4 w-4 rounded border-border" />
              I verified this myself (marks confidence as High)
            </label>
            {contactState.error ? <p className="text-sm text-destructive">{contactState.error}</p> : null}
            {contactState.success ? <p className="text-sm text-success">Contact added.</p> : null}
            <Button type="submit" loading={contactPending} className="w-fit">
              {contactPending ? "Saving…" : "Add contact"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{mode === "ai" ? "Draft a cold email" : "Write your own draft"}</CardTitle>
            <div className="flex overflow-hidden rounded-md border border-border text-xs">
              <button
                type="button"
                onClick={() => setMode("ai")}
                className={`px-2.5 py-1 ${mode === "ai" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}
              >
                Generate with AI
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={`px-2.5 py-1 ${mode === "manual" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}
              >
                Write it myself
              </button>
            </div>
          </div>
          <CardDescription>
            {mode === "ai"
              ? "Generated, grounded in your default resume — review before sending."
              : "Nothing generated — this goes to your drafts exactly as typed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "ai" ? (
            <form action={draftAction} className="flex flex-col gap-3">
              <CompanySelect companies={companies} />
              <ContactSelect contacts={contacts} />
              {draftState.error ? <p className="text-sm text-destructive">{draftState.error}</p> : null}
              {draftState.success ? <p className="text-sm text-success">Draft created below.</p> : null}
              <Button type="submit" loading={draftPending} className="w-fit">
                {draftPending ? "Drafting…" : "Generate draft"}
              </Button>
            </form>
          ) : (
            <form action={manualAction} className="flex flex-col gap-3">
              <CompanySelect companies={companies} />
              <ContactSelect contacts={contacts} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subject">Subject</Label>
                <input
                  id="subject"
                  name="subject"
                  placeholder="Interest in opportunities at {Company}"
                  className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="content">Body</Label>
                <Textarea id="content" name="content" rows={6} placeholder="Hi ..." />
              </div>
              {manualState.error ? <p className="text-sm text-destructive">{manualState.error}</p> : null}
              {manualState.success ? <p className="text-sm text-success">Draft created below.</p> : null}
              <Button type="submit" loading={manualPending} className="w-fit">
                {manualPending ? "Saving…" : "Save draft"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suggest an email</CardTitle>
          <CardDescription>
            Don't have a real contact yet? Get common-pattern guesses (careers@, talent@, ...) — always labeled as
            unverified guesses, never sent to without your say-so.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SuggestContactsPanel companies={companies} />
        </CardContent>
      </Card>
    </div>
  );
}

function CompanySelect({ companies }: { companies: CompanyOption[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="companyId">Company</Label>
      <select id="companyId" name="companyId" className="h-9 rounded-md border border-border bg-surface px-3 text-sm" required>
        <option value="">Select a company…</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ContactSelect({ contacts }: { contacts: ContactOption[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="contactId">Contact (optional)</Label>
      <select id="contactId" name="contactId" className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">(no specific contact)</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName ?? c.email ?? c.id} ({c.companyId.slice(0, 6)})
          </option>
        ))}
      </select>
    </div>
  );
}
