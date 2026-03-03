import type { Session } from "@prisma/client";
import db from "../db.server";
import { appConfig } from "../config.server";

export type UserRole = "ADMIN" | "REP" | "OWNER";

export interface PlatformUserContext {
  userRole: UserRole;
  platformUser: Awaited<ReturnType<typeof db.platformUser.findUnique>> | null;
  isPlatformAdmin: boolean;
  isSalesRep: boolean;
}

export function getPlatformAdminEmail() {
  return appConfig.platform.adminEmail;
}

export async function resolveUserContext(session: Session): Promise<PlatformUserContext> {
  const shop = session.shop;
  const email = (session as any).email as string | undefined;
  const platformAdminEmail = getPlatformAdminEmail();

  const platformUser = email
    ? await db.platformUser.findUnique({
        where: { email },
      })
    : null;

  const isPlatformAdmin = !!email && email === platformAdminEmail;
  const isSalesRep =
    platformUser?.role === "SALES_REP" && platformUser.status === "ACTIVE";

  if (isPlatformAdmin) {
    return {
      userRole: "ADMIN",
      platformUser,
      isPlatformAdmin: true,
      isSalesRep: false,
    };
  }

  if (isSalesRep && platformUser) {
    return {
      userRole: "REP",
      platformUser,
      isPlatformAdmin: false,
      isSalesRep: true,
    };
  }

  return {
    userRole: "OWNER",
    platformUser: null,
    isPlatformAdmin: false,
    isSalesRep: false,
  };
}

export function requirePlatformAdmin(session: Session) {
  const email = (session as any).email as string | undefined;
  const platformAdminEmail = getPlatformAdminEmail();

  if (!email || email !== platformAdminEmail) {
    throw new Response("Unauthorized: Platform admin access required", {
      status: 403,
    });
  }

  return { email, shop: session.shop };
}

