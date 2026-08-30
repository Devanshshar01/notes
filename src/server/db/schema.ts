import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
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
 * In the larger product, `users`, `couple_spaces`, and `memberships` are owned
 * by the central `couple-space` application. They live in a shared schema and
 * are managed outside this repository.
 *
 * To make the Notes repository runnable in development and testable in
 * isolation, the same shapes are mirrored here under a clearly-marked dev
 * namespace. In production these tables MUST be removed and the queries below
 * should join against the central schema instead.
 *
 * Removing this block is the correct, expected evolution of the architecture
 * once the central Couple Space application exists.
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
