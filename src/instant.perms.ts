// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/core";

const rules = {
  sessions: {
    allow: {
      view: "true",
      create: "true",
      delete: "true",
      update: "true",
    },
  },
  items: {
    allow: {
      view: "true",
      create: "true",
      delete: "true",
      update: "true",
    },
  },
  settings: {
    allow: {
      view: "true",
      create: "true",
      delete: "true",
      update: "true",
    },
  },
  suggestions: {
    allow: {
      view: "true",
      create: "true",
      delete: "true",
      update: "true",
    },
  },
} satisfies InstantRules;

export default rules;
