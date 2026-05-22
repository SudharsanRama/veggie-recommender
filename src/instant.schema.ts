// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
    }),
    sessions: i.entity({
      sessionId: i.string().unique().indexed(),
      lastVisitedAt: i.date().indexed(),
    }),
    items: i.entity({
      category: i.string().indexed(),
      createdAt: i.date().indexed(),
      enabled: i.boolean().indexed(),
      lastSuggestedAt: i.date().indexed().optional(),
      name: i.string(),
      type: i.string().indexed(),
    }),
    settings: i.entity({
      cooldownDays: i.number(),
      itemsPerCategory: i.number(),
      updatedAt: i.date(),
    }),
    suggestions: i.entity({
      generatedAt: i.date().indexed(),
    }),
  },
  links: {
    $usersLinkedPrimaryUser: {
      forward: {
        on: "$users",
        has: "one",
        label: "linkedPrimaryUser",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "linkedGuestUsers",
      },
    },
    suggestionsItems: {
      forward: { on: "suggestions", has: "many", label: "items" },
      reverse: { on: "items", has: "many", label: "suggestions" },
    },
    sessionItems: {
      forward: { on: "items", has: "one", label: "session", onDelete: "cascade" },
      reverse: { on: "sessions", has: "many", label: "items" },
    },
    sessionSettings: {
      forward: { on: "settings", has: "one", label: "session", onDelete: "cascade" },
      reverse: { on: "sessions", has: "many", label: "settings" },
    },
    sessionSuggestions: {
      forward: { on: "suggestions", has: "one", label: "session", onDelete: "cascade" },
      reverse: { on: "sessions", has: "many", label: "suggestions" },
    },
  },
  rooms: {},
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
