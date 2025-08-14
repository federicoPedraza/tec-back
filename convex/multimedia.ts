import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Create a new multimedia asset by uploading binary/base64 to Convex storage first
// Record a multimedia asset that was uploaded to a provider (convex or supabase)
export const createRecord = mutation({
  args: {
    kind: v.union(v.literal("image"), v.literal("file")),
    mimeType: v.string(),
    filename: v.optional(v.string()),
    size: v.optional(v.number()),
    storageProvider: v.union(v.literal("convex"), v.literal("supabase")),
    // When storageProvider === 'convex'
    storageId: v.optional(v.id("_storage")),
    // When storageProvider === 'supabase'
    supabaseBucket: v.optional(v.string()),
    supabasePath: v.optional(v.string()),
    title: v.optional(v.string()),
    alt: v.optional(v.string()),
    // Optional link to a course
    courseId: v.optional(v.id("courses")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const assetId = await ctx.db.insert("multimedia", {
      kind: args.kind,
      mimeType: args.mimeType,
      filename: args.filename,
      size: args.size,
      storageProvider: args.storageProvider,
      storageId: args.storageId,
      supabaseBucket: args.supabaseBucket,
      supabasePath: args.supabasePath,
      courseId: args.courseId,
      status: args.courseId ? "linked" : "orphan",
      title: args.title,
      alt: args.alt,
      createdAt: now,
      updatedAt: now,
    });

    return assetId;
  },
});

export const linkToCourse = mutation({
  args: {
    multimediaId: v.id("multimedia"),
    courseId: v.id("courses"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.multimediaId, {
      courseId: args.courseId,
      status: "linked",
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const unlinkFromCourse = mutation({
  args: {
    multimediaId: v.id("multimedia"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.multimediaId, {
      courseId: undefined,
      status: "orphan",
      updatedAt: Date.now(),
    } as any);
    return { success: true };
  },
});

export const deleteIfOrphan = mutation({
  args: { multimediaId: v.id("multimedia") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.multimediaId);
    if (!doc) return { success: true, deleted: false };
    if (doc.status !== "orphan") return { success: false, reason: "not_orphan" };
    if (doc.storageProvider === "convex" && doc.storageId) {
      await (ctx.storage as any).delete(doc.storageId);
    }
    // For supabase, deletion of the remote object will be done via Express endpoint using service role key
    await ctx.db.delete(args.multimediaId);
    return { success: true, deleted: true };
  },
});

export const getById = query({
  args: { multimediaId: v.id("multimedia") },
  handler: async (ctx, args) => ctx.db.get(args.multimediaId),
});

export const getUrl = query({
  args: { multimediaId: v.id("multimedia") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.multimediaId);
    if (!doc) return null;
    if (doc.storageProvider === "convex" && doc.storageId) {
      const url = await (ctx.storage as any).getUrl(doc.storageId);
      return { url, mimeType: doc.mimeType };
    }
    // For supabase, return the public or signed url will be generated via Express endpoint
    return { url: null, mimeType: doc.mimeType };
  },
});

export const listOrphans = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("multimedia")
      .withIndex("by_status", (q) => q.eq("status", "orphan"))
      .order("desc")
      .collect();
  },
});

export const getAllMultimedia = query({
  handler: async (ctx) => {
    const items = await ctx.db
      .query("multimedia")
      .order("desc")
      .collect();
    return items;
  },
});

export const getCourseImages = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("multimedia")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .collect();
  },
});


