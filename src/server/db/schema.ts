import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notesSchema = pgSchema("notes");

export const DEFAULT_DOCUMENT = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;

export const noteCategories = [
  "general",
  "ideas",
  "lists",
  "letters",
  "plans",
  "memories",
  "travel",
] as const;

export const noteColors = ["none", "warm", "cool", "rose", "sage", "sand"] as const;

export const notes = notesSchema.table(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    spaceId: uuid("space_id").notNull(),

    title: text("title").notNull().default(""),
    content: jsonb("content").notNull(),

    isPinned: boolean("is_pinned").notNull().default(false),
    color: text("color").notNull().default("none"),
    category: text("category").notNull().default("general"),

    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),

    revision: integer("revision").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("notes_space_idx").on(t.spaceId),
    index("notes_active_list_idx").on(
      t.spaceId,
      t.isPinned,
      t.updatedAt,
    ).where(sql`${t.deletedAt} IS NULL AND ${t.archivedAt} IS NULL`),
  ],
);

export type NoteRow = typeof notes.$inferSelect;
export type NoteInsert = typeof notes.$inferInsert;

/**
 * DEV / TEST IDENTITY TABLES
 *
 * The `users`, `couple_spaces`, and `memberships` tables are owned by the
 * central `couple-space` application in production. To keep the Notes
 * repository runnable in isolation and inspectable in development, the same
 * shapes are mirrored here under a clearly-marked dev namespace.
 *
 * In production, all production authentication flows through Better Auth +
 * the Our Space OIDC provider and the `external_space_mapping` table. The dev
 * identity tables are still queried, but only as a fallback when no Better
 * Auth session is present and the NODE_ENV guard has confirmed we are not in
 * production. They are NEVER consulted in production.
 */
export const devIdentitySchema = pgSchema("notes_dev_identity");

export const users = devIdentitySchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const coupleSpaces = devIdentitySchema.table("couple_spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = devIdentitySchema.table("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => coupleSpaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * BETTER AUTH TABLES
 *
 * These tables back Better Auth's standard session + OIDC account model. They
 * are the production identity boundary. The `account` row's `(providerId,
 * accountId)` is the federated identity mapping to the central Our Space
 * subject. Each row's `userId` is the local Notes UUID user.
 */
export const authSchema = pgSchema("notes_auth");

export const authUser = authSchema.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authSession = authSchema.table("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("account_provider_account_unique").on(
      t.providerId,
      t.accountId,
    ),
    index("account_user_idx").on(t.userId),
  ],
);

export const authVerification = authSchema.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * CENTRAL → LOCAL SPACE MAPPING
 *
 * Each row binds a central Our Space Couple Space id to one local Notes
 * couple space UUID. The unique indexes enforce the invariant: ONE central
 * Couple Space resolves to exactly ONE Notes space.
 */
export const externalSpaceMapping = notesSchema.table(
  "external_space_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centralSpaceId: text("central_space_id").notNull().unique(),
    localSpaceId: uuid("local_space_id")
      .notNull()
      .references(() => coupleSpaces.id, { onDelete: "cascade" })
      .unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);