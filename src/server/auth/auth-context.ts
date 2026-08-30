import { eq, and } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
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

/**
 * Server-side authentication boundary.
 *
 * In a future step this will be replaced by a verified session coming from the
 * central Couple Space application. The contract returned here is the same:
 *   { userId, spaceId } — both already authorized.
 *
 * For now, the only ways to obtain a non-error context are:
 *   1. NOTES_DEV_UI=true (in non-production) — returns a synthetic
 *      { userId: "dev-ui", spaceId: "dev-ui" } context so the existing Notes
 *      UI can be inspected locally without the future Couple Space app.
 *      This is for UI inspection only; the dev identity tables are NOT
 *      consulted and no persistent data is fabricated.
 *   2. DEV_AUTH_USER_ID + DEV_AUTH_SPACE_ID + a matching membership row in
 *      the dev identity tables.
 *
 * Both paths are disabled in production.
 */
export async function getAuthContext(): Promise<AuthContext> {
  if (isDevUiMode()) {
    return { userId: DEV_UI_USER_ID, spaceId: DEV_UI_SPACE_ID };
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
