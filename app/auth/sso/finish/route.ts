import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/server/db/client";
import {
  authAccount,
  authSession as sessionTable,
  coupleSpaces,
  externalSpaceMapping,
  memberships,
  users,
} from "@/server/db/schema";
import { auth } from "@/server/auth/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUR_SPACE_ISSUER =
  process.env["OUR_SPACE_ISSUER"] ?? "https://our-space-woad.vercel.app";
const MEMBERSHIP_URI =
  process.env["OUR_SPACE_MEMBERSHIP_URI"] ??
  `${OUR_SPACE_ISSUER}/api/oauth/membership`;

function safeDestination(value: string | null): string {
  if (!value) return "/notes";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/notes";
  }
  return value;
}

function deterministicLocalSpaceId(centralSpaceId: string): string {
  return createHash("sha256")
    .update(`${OUR_SPACE_ISSUER}:${centralSpaceId}`)
    .digest("hex")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

function textToUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function deterministicRandomId(): string {
  return createHash("sha256")
    .update(`${Date.now()}:${Math.random()}:${process.pid}`)
    .digest("hex")
    .slice(0, 32);
}

type MembershipPayload = {
  sub?: string;
  issuer?: string;
  membership?: { active?: boolean; coupleSpaceId?: string };
};

async function fetchMembership(
  accessToken: string,
): Promise<MembershipPayload | null> {
  try {
    const res = await fetch(MEMBERSHIP_URI, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as MembershipPayload;
  } catch {
    return null;
  }
}

async function readAccessTokenAndSubject(
  userId: string,
): Promise<{ accessToken: string | null; accountSubject: string | null }> {
  const rows = await db
    .select({
      accessToken: authAccount.accessToken,
      accountId: authAccount.accountId,
    })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.userId, userId),
        eq(authAccount.providerId, "our-space"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return {
    accessToken: row?.accessToken ?? null,
    accountSubject: row?.accountId ?? null,
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const destination = safeDestination(url.searchParams.get("next"));

  const authSession = await auth.api.getSession({ headers: await headers() });
  if (!authSession) {
    return NextResponse.redirect(
      new URL(
        `/?error=oauth_session&next=${encodeURIComponent(destination)}`,
        url,
      ),
    );
  }

  const userId = authSession.user.id;

  let accessToken: string | null = null;
  let accountSubject: string | null = null;
  try {
    const result = await readAccessTokenAndSubject(userId);
    accessToken = result.accessToken;
    accountSubject = result.accountSubject;
  } catch {}

  if (!accessToken || !accountSubject) {
    return NextResponse.redirect(
      new URL(
        `/?error=oauth_no_token&next=${encodeURIComponent(destination)}`,
        url,
      ),
    );
  }

  const membershipPayload = await fetchMembership(accessToken);

  if (
    !membershipPayload ||
    membershipPayload.issuer !== OUR_SPACE_ISSUER ||
    membershipPayload.membership?.active !== true ||
    !membershipPayload.membership.coupleSpaceId
  ) {
    return NextResponse.redirect(
      new URL(
        `/?error=no_central_membership&next=${encodeURIComponent(destination)}`,
        url,
      ),
    );
  }

  const centralSpaceId = membershipPayload.membership.coupleSpaceId;

  try {
    const localUserUuid = textToUuid(accountSubject);
    await db.transaction(async (tx) => {
      const existingUser = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, localUserUuid))
          .limit(1)
      )[0];
      if (!existingUser) {
        try {
          await tx.insert(users).values({ id: localUserUuid });
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code !== "23505") throw err;
        }
      }

      const existingMapping = (
        await tx
          .select({ localSpaceId: externalSpaceMapping.localSpaceId })
          .from(externalSpaceMapping)
          .where(eq(externalSpaceMapping.centralSpaceId, centralSpaceId))
          .limit(1)
      )[0];

      let localSpaceId = existingMapping?.localSpaceId;

      if (!localSpaceId) {
        const candidateId = deterministicLocalSpaceId(centralSpaceId);
        try {
          await tx.insert(coupleSpaces).values({
            id: candidateId,
          });
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code !== "23505") throw err;
        }
        try {
          await tx.insert(externalSpaceMapping).values({
            id: deterministicRandomId(),
            centralSpaceId,
            localSpaceId: candidateId,
          });
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code !== "23505") throw err;
        }
        const reread = (
          await tx
            .select({ localSpaceId: externalSpaceMapping.localSpaceId })
            .from(externalSpaceMapping)
            .where(eq(externalSpaceMapping.centralSpaceId, centralSpaceId))
            .limit(1)
        )[0];
        localSpaceId = reread?.localSpaceId ?? candidateId;
      }

      const existingMember = (
        await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.spaceId, localSpaceId!),
              eq(memberships.userId, localUserUuid),
            ),
          )
          .limit(1)
      )[0];

      if (!existingMember) {
        try {
          await tx.insert(memberships).values({
            id: deterministicRandomId(),
            userId: localUserUuid,
            spaceId: localSpaceId!,
          });
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code !== "23505") throw err;
        }
      }
    });
  } catch {
    return NextResponse.redirect(
      new URL(
        `/?error=sso_provision&next=${encodeURIComponent(destination)}`,
        url,
      ),
    );
  }

  await db
    .update(sessionTable)
    .set({ updatedAt: new Date() })
    .where(eq(sessionTable.userId, userId));

  return NextResponse.redirect(new URL(destination, url));
}