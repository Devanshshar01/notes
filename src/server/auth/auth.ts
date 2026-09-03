import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { decodeJwt } from "jose";
import { createHash } from "node:crypto";
import { db } from "@/server/db/client";
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
} from "@/server/db/schema";

const OUR_SPACE_ISSUER =
  process.env["OUR_SPACE_ISSUER"] ?? "https://our-space-woad.vercel.app";

const NOTES_CLIENT_ID = process.env["NOTES_OAUTH_CLIENT_ID"] ?? "notes";
const NOTES_REDIRECT_URI =
  process.env["NOTES_OAUTH_REDIRECT_URI"] ??
  (process.env["BETTER_AUTH_URL"] ?? "http://localhost:3002") +
    "/api/auth/oauth2/callback/our-space";

function syntheticEmail(subject: string): string {
  return `federated-${createHash("sha256")
    .update(subject)
    .digest("hex")
    .slice(0, 20)}@notes.invalid`;
}

export const auth = betterAuth({
  baseURL: process.env["BETTER_AUTH_URL"] ?? (process.env.NODE_ENV === "production" ? "https://notes-rust-five.vercel.app" : "http://localhost:3002"),
  trustedOrigins: [
    "https://notes-rust-five.vercel.app",
    "http://localhost:3002",
  ],
  secret: process.env["BETTER_AUTH_SECRET"] || "default_secret_please_change_this_in_production",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
    },
  }),
  emailAndPassword: {
    enabled: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  account: {
    accountLinking: {
      enabled: false,
    },
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "our-space",
          discoveryUrl: `${OUR_SPACE_ISSUER}/.well-known/openid-configuration`,
          clientId: NOTES_CLIENT_ID,
          scopes: ["openid", "profile", "email"],
          pkce: true,
          redirectURI: NOTES_REDIRECT_URI,
          getUserInfo: async (tokens) => {
            const claims = decodeJwt(tokens.idToken ?? "");
            if (!claims.sub || typeof claims.sub !== "string") {
              return null;
            }
            return {
              id: claims.sub,
              email:
                typeof claims["email"] === "string"
                  ? (claims["email"] as string)
                  : syntheticEmail(claims.sub),
              emailVerified: claims["email_verified"] === true,
              name:
                typeof claims["name"] === "string"
                  ? (claims["name"] as string)
                  : "Notes user",
              sub: claims.sub,
            };
          },
          mapProfileToUser: (profile) => {
            const sub =
              typeof profile["sub"] === "string"
                ? (profile["sub"] as string)
                : typeof profile["email"] === "string"
                  ? (profile["email"] as string)
                  : "";
            if (!sub) {
              throw new Error("Missing sub in OIDC profile");
            }
            const rawEmail = profile["email"];
            const rawName = profile["name"];
            return {
              email:
                typeof rawEmail === "string" && rawEmail
                  ? rawEmail
                  : syntheticEmail(sub),
              emailVerified: profile["emailVerified"] === true,
              name:
                typeof rawName === "string" && rawName
                  ? rawName
                  : "Notes user",
            };
          },
        },
      ],
    }),
  ],
});

export type Auth = typeof auth;