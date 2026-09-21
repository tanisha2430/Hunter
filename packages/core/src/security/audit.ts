import { prisma, Prisma } from "@hunter/db";

/**
 * Single audit-logging entry point, called from Route Handlers/Server
 * Actions (not from within domain logic, so packages/core's business
 * functions stay free of this particular persistence side-effect creeping
 * into every call site — callers opt in explicitly at the boundary).
 */
export async function logAudit(params: {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
  });
}
