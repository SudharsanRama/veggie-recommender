// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    items: i.entity({
      name: i.string(),
      type: i.string().indexed(), // 'vegetable' or 'fruit'
      category: i.string().indexed(), // 'leafy', 'root', 'fruit', etc.
      enabled: i.boolean().indexed(),
      lastSuggestedAt: i.number().indexed().optional(),
      createdAt: i.number().indexed(),
    }),
    suggestions: i.entity({
      generatedAt: i.number().indexed(),
    }),
    settings: i.entity({
      itemsPerCategory: i.number(),
      cooldownDays: i.number(),
      updatedAt: i.number(),
    }),
  },
  links: {
    suggestionItems: {
      forward: {
        on: "suggestions",
        has: "many",
        label: "items",
      },
      reverse: {
        on: "items",
        has: "many",
        label: "suggestions",
      },
    },
  },
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
