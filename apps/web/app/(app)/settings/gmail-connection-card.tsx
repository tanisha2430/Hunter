import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from "@hunter/ui";
import { prisma } from "@hunter/db";

export async function GmailConnectionCard({
  userId,
  connected: connectedParam,
  error,
}: {
  userId: string;
  connected?: string;
  error?: string;
}) {
  const account = await prisma.connectedAccount.findFirst({ where: { userId, provider: "GMAIL" } });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email (Gmail)</CardTitle>
        <CardDescription>
          Connect Gmail so outreach emails send from your real address, and so replies (acknowledgment, rejection,
          interview, offer) can be detected and reflected on the Dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {connectedParam ? (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">Gmail connected successfully.</p>
        ) : null}
        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Couldn&apos;t connect Gmail: {decodeURIComponent(error)}
          </p>
        ) : null}

        {account ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">
                Connected as <span className="font-medium">{account.emailAddress}</span>
              </p>
              <Badge variant="success" className="mt-1">
                Active
              </Badge>
            </div>
            <a href="/api/auth/gmail/connect">
              <Button type="button" variant="outline" size="sm">
                Reconnect
              </Button>
            </a>
          </div>
        ) : (
          <a href="/api/auth/gmail/connect">
            <Button type="button" variant="primary">
              Connect Gmail
            </Button>
          </a>
        )}
      </CardContent>
    </Card>
  );
}
