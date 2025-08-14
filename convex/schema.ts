import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  admin_credentials: defineTable({
    password: v.string(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_password", ["password"]) 
    .index("by_last_login", ["lastLoginAt"]),

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

    // Common metadata fields
    isRead: v.optional(v.boolean()),
    isFavorite: v.optional(v.boolean()),
    note: v.optional(v.string()),

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

  // Courses catalog
  courses: defineTable({
    title: v.string(),
    image: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.union(v.number(), v.null())), // ms since epoch
    textColor: v.optional(v.string()),
    minLevel: v.optional(v.string()),
    specialNotes: v.optional(v.union(v.string(), v.null())),
    attachments: v.optional(
      v.union(
        v.array(
          v.object({
            label: v.string(),
            url: v.string(),
          })
        ),
        v.null()
      )
    ),
    links: v.optional(
      v.union(
        v.array(
          v.object({
            label: v.string(),
            url: v.string(),
          })
        ),
        v.null()
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_title", ["title"]) 
    .index("by_min_level", ["minLevel"]) 
    .index("by_start_date", ["startDate"]) 
    .index("by_created_at", ["createdAt"]),

  // Course thumbnail configurations
  course_thumbnails: defineTable({
    courseId: v.id("courses"),
    customTexts: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        left: v.number(),
        top: v.number(),
        fontSize: v.optional(v.number()),
        color: v.optional(v.string()),
        fontFamily: v.optional(v.string()),
        fontWeight: v.optional(v.string()),
        textAlign: v.optional(
          v.union(v.literal("left"), v.literal("center"), v.literal("right"))
        ),
      })
    ),
    imagePosition: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
      })
    ),
    imageScale: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_course", ["courseId"]) 
    .index("by_updated_at", ["updatedAt"]),

  // Multimedia assets (images/files stored in Convex storage)
  multimedia: defineTable({
    kind: v.union(v.literal("image"), v.literal("file")),
    mimeType: v.string(),
    filename: v.optional(v.string()),
    size: v.optional(v.number()),
    // Storage provider info
    storageProvider: v.union(v.literal("convex"), v.literal("supabase")),
    // Convex storage id (when storageProvider === 'convex')
    storageId: v.optional(v.id("_storage")),
    // Supabase storage info (when storageProvider === 'supabase')
    supabaseBucket: v.optional(v.string()),
    supabasePath: v.optional(v.string()),
    // Optional link to a course this asset belongs to
    courseId: v.optional(v.id("courses")),
    status: v.union(v.literal("orphan"), v.literal("linked")),
    title: v.optional(v.string()),
    alt: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_course", ["courseId"]) 
    .index("by_status", ["status"]) 
    .index("by_created_at", ["createdAt"]),
});
