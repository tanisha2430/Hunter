import { listMessagesForUser } from "@hunter/core";
import { prisma } from "@hunter/db";
import { Badge, Card, CardContent, CardHeader, CardTitle, ListGroup, ListItem, PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { OutreachForms } from "./draft-email-form";
import { QueueButton, MarkSentButton, SendNowButton } from "./message-row-actions";
import { CheckRepliesButton } from "./check-replies-button";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "outline"> = {
  DRAFT: "outline",
  QUEUED: "warning",
  SENT: "success",
  REPLIED: "success",
  BOUNCED: "default",
  FAILED: "default",
};

export default async function OutreachPage() {
  const user = await getCurrentUser();

  const [companies, contacts, messages, gmailAccount] = await Promise.all([
    prisma.company.findMany({ orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } }),
    prisma.companyContact.findMany({ take: 100, select: { id: true, companyId: true, fullName: true, email: true } }),
    user ? listMessagesForUser(user.id) : Promise.resolve([]),
    user ? prisma.connectedAccount.findFirst({ where: { userId: user.id, provider: "GMAIL" } }) : Promise.resolve(null),
  ]);
  const gmailConnected = Boolean(gmailAccount);
  const hasSentMessages = messages.some((m) => m.status === "SENT");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Outreach"
          description={
            gmailConnected
              ? `Company/HR contacts and cold-email drafts — nothing sends without your review. Sending from ${gmailAccount!.emailAddress}.`
              : "Company/HR contacts and cold-email drafts — nothing sends without your review. Connect Gmail in Settings to send directly from here instead of copying drafts manually."
          }
        />
        {gmailConnected && hasSentMessages ? <CheckRepliesButton /> : null}
      </div>

      <OutreachForms companies={companies} contacts={contacts} />

      <Card>
        <CardHeader>
          <CardTitle>Drafts &amp; messages</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ListGroup className="border-none">
            {messages.length === 0 ? (
              <ListItem interactive={false} className="text-sm text-muted-foreground">
                No outreach drafts yet.
              </ListItem>
            ) : (
              messages.map((msg) => (
                <ListItem key={msg.id} interactive={false} className="items-start">
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{msg.subject}</span>
                      <Badge variant={STATUS_VARIANT[msg.status] ?? "outline"}>{msg.status}</Badge>
                    </div>
                    <p className="whitespace-pre-line text-xs text-muted-foreground">{msg.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {msg.contact?.email ? `To: ${msg.contact.email}` : "No linked contact email yet"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {msg.status === "DRAFT" ? <QueueButton messageId={msg.id} /> : null}
                    {msg.status === "QUEUED" && gmailConnected && msg.contact?.email ? (
                      <SendNowButton messageId={msg.id} />
                    ) : null}
                    {msg.status === "QUEUED" ? <MarkSentButton messageId={msg.id} /> : null}
                  </div>
                </ListItem>
              ))
            )}
          </ListGroup>
        </CardContent>
      </Card>
    </div>
  );
}
