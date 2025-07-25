import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  contacts: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"])
    .index("by_created_at", ["createdAt"]),

  requests: defineTable({
    contactId: v.id("contacts"),
    source: v.union(v.literal("interview"), v.literal("onboarding")),
    requestedAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("processed")),

    // Onboarding-specific fields (optional)
    objective: v.optional(v.string()),
    experience: v.optional(v.string()),
    experienceLevel: v.optional(v.string()),
    speakingExperience: v.optional(v.string()),
    listeningExperience: v.optional(v.string()),
    readingExperience: v.optional(v.string()),
    writingExperience: v.optional(v.string()),
    comment: v.optional(v.string()),
  })
    .index("by_contact", ["contactId"])
    .index("by_source", ["source"])
    .index("by_status", ["status"])
    .index("by_requested_at", ["requestedAt"]),

  newsletter: defineTable({
    contactId: v.id("contacts"),
    subscription_at: v.number(),
    active: v.boolean(),
  })
    .index("by_contact", ["contactId"])
    .index("by_active", ["active"])
    .index("by_subscription_at", ["subscription_at"]),
});
