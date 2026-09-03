import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { db, schema } from "@/server/db/client";
import { auth } from "@/server/auth/auth";
import {
  DEV_UI_SPACE_ID,
  DEV_UI_USER_ID,
  isDevUiMode,
} from "@/server/dev/dev-ui";

export type AuthContext = {
  userId: string;
  spaceId: string;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isDevAuthEnabled(): boolean {
  if (isDevUiMode()) return true;
  return (
    process.env["NODE_ENV"] !== "production" &&
    Boolean(process.env["DEV_AUTH_USER_ID"]) &&
    Boolean(process.env["DEV_AUTH_SPACE_ID"])
  );
}

function getCentralIssuer(): string {
  return (
    process.env["OUR_SPACE_ISSUER"] ?? "https://our-space-woad.vercel.app"
  );
}

function getMembershipUrl(): string {
  return (
    process.env["OUR_SPACE_MEMBERSHIP_URI"] ??
    `${getCentralIssuer()}/api/oauth/membership`
  );
}

function textToUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

/**
 * Server-side authentication boundary.
 *
 * Production authentication goes through Better Auth + Our Space OIDC. The
 * server obtains the verified local user from the Better Auth session cookie,
 * calls the central membership endpoint server-to-server with the stored
 * access token, and resolves the active local space from the
 * `external_space_mapping` table.
 *
 * Development paths:
 *   1. NOTES_DEV_UI=true in non-production — synthetic { userId: "dev-ui",
 *      spaceId: "dev-ui" } context, never persisted.
 *   2. DEV_AUTH_USER_ID + DEV_AUTH_SPACE_ID + a matching membership row in
 *      the dev identity tables.
 *
 * Both development paths are disabled in production. A production request
 * cannot become authenticated by virtue of these environment variables.
 */
export async function getAuthContext(): Promise<AuthContext> {
  if (isDevUiMode()) {
    return { userId: DEV_UI_USER_ID, spaceId: DEV_UI_SPACE_ID };
  }

  const inProduction = process.env["NODE_ENV"] === "production";

  let authSession: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    authSession = await auth.api.getSession({ headers: await headers() });
  } catch {
    authSession = null;
  }

  if (authSession) {
    const userId = authSession.user.id;

    const accountRow = (
      await db
        .select({
          accountId: schema.authAccount.accountId,
          accessToken: schema.authAccount.accessToken,
        })
        .from(schema.authAccount)
        .where(
          and(
            eq(schema.authAccount.userId, userId),
            eq(schema.authAccount.providerId, "our-space"),
          ),
        )
        .limit(1)
    )[0];

    if (!accountRow) {
      throw new AuthError("Unauthorized", 401);
    }

    const accessToken = accountRow.accessToken ?? null;
    if (!accessToken) {
      throw new AuthError("Unauthorized", 401);
    }

    const localUserUuid = textToUuid(accountRow.accountId);

    type MembershipPayload = {
      issuer?: string;
      membership?: { active?: boolean; coupleSpaceId?: string };
    };

    let membershipJson: MembershipPayload | null = null;
    try {
      const res = await fetch(getMembershipUrl(), {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (res.ok) {
        membershipJson = (await res.json()) as MembershipPayload;
      }
    } catch {}

    if (
      !membershipJson ||
      membershipJson.issuer !== getCentralIssuer() ||
      membershipJson.membership?.active !== true ||
      !membershipJson.membership.coupleSpaceId
    ) {
      throw new AuthError("Forbidden", 403);
    }

    const centralSpaceId = membershipJson.membership.coupleSpaceId;

    const mappingRow = (
      await db
        .select({ localSpaceId: schema.externalSpaceMapping.localSpaceId })
        .from(schema.externalSpaceMapping)
        .where(eq(schema.externalSpaceMapping.centralSpaceId, centralSpaceId))
        .limit(1)
    )[0];

    if (!mappingRow) {
      throw new AuthError("Forbidden", 403);
    }

    const memberRow = (
      await db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, localUserUuid),
            eq(schema.memberships.spaceId, mappingRow.localSpaceId),
          ),
        )
        .limit(1)
    )[0];

    if (!memberRow) {
      throw new AuthError("Forbidden", 403);
    }

    return { userId: localUserUuid, spaceId: mappingRow.localSpaceId };
  }

  if (inProduction) {
    throw new AuthError("Unauthorized", 401);
  }

  if (!isDevAuthEnabled()) {
    throw new AuthError("Unauthorized", 401);
  }

  const userId = process.env["DEV_AUTH_USER_ID"];
  const spaceId = process.env["DEV_AUTH_SPACE_ID"];
  if (!userId || !spaceId) {
    throw new AuthError("Unauthorized", 401);
  }

  const membership = await db
    .select({ spaceId: schema.memberships.spaceId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.spaceId, spaceId),
      ),
    )
    .limit(1);

  if (membership.length === 0) {
    throw new AuthError("Forbidden", 403);
  }

  return { userId, spaceId };
}