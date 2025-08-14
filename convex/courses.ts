import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Common object validators reused in args
const attachmentValidator = v.object({ label: v.string(), url: v.string() });
const linkValidator = v.object({ label: v.string(), url: v.string() });

export const addCourse = mutation({
  args: {
    title: v.string(),
    image: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.union(v.number(), v.null())),
    textColor: v.optional(v.string()),
    minLevel: v.optional(v.string()),
    specialNotes: v.optional(v.string()),
    attachments: v.optional(v.array(attachmentValidator)),
    links: v.optional(v.array(linkValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const courseId = await ctx.db.insert("courses", {
      title: args.title,
      image: args.image,
      description: args.description,
      startDate: args.startDate,
      textColor: args.textColor,
      minLevel: args.minLevel,
      specialNotes: args.specialNotes,
      attachments: args.attachments,
      links: args.links,
      createdAt: now,
      updatedAt: now,
    });

    return courseId;
  },
});

export const updateCourse = mutation({
  args: {
    courseId: v.id("courses"),
    title: v.optional(v.string()),
    image: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.union(v.number(), v.null())),
    textColor: v.optional(v.string()),
    minLevel: v.optional(v.string()),
    specialNotes: v.optional(v.union(v.string(), v.null())),
    attachments: v.optional(v.union(v.array(attachmentValidator), v.null())),
    links: v.optional(v.union(v.array(linkValidator), v.null())),
  },
  handler: async (ctx, args) => {
    const { courseId, ...rest } = args as any;
    const updates: Record<string, any> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) updates[key] = value;
    }

    await ctx.db.patch(courseId, updates);
    return { success: true };
  },
});

export const deleteCourse = mutation({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.courseId);
    return { success: true };
  },
});

export const getCourse = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.courseId);
  },
});

export const getAllCourses = query({
  handler: async (ctx) => {
    return await ctx.db.query("courses").withIndex("by_created_at").order("desc").collect();
  },
});

export const findCourses = query({
  args: {
    minLevel: v.optional(v.string()),
    startDateFrom: v.optional(v.number()),
    startDateTo: v.optional(v.number()),
    textSearch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { minLevel, startDateFrom, startDateTo, textSearch } = args;

    let results: any[] = [];

    if (startDateFrom !== undefined || startDateTo !== undefined) {
      const from = startDateFrom ?? 0;
      const to = startDateTo ?? Number.MAX_SAFE_INTEGER;
      results = await ctx.db
        .query("courses")
        .withIndex("by_start_date", (q) => q.gte("startDate", from).lte("startDate", to))
        .collect();
    } else if (minLevel) {
      results = await ctx.db
        .query("courses")
        .withIndex("by_min_level", (q) => q.eq("minLevel", minLevel))
        .collect();
    } else {
      results = await ctx.db.query("courses").collect();
    }

    if (textSearch && textSearch.trim().length > 0) {
      const needle = textSearch.toLowerCase();
      results = results.filter((c) =>
        [c.title, c.description, c.specialNotes]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(needle))
      );
    }

    return results;
  },
});

// ----------------------
// Course thumbnails
// ----------------------

const courseThumbnailText = v.object({
  id: v.string(),
  text: v.string(),
  left: v.number(),
  top: v.number(),
  fontSize: v.optional(v.number()),
  color: v.optional(v.string()),
  fontFamily: v.optional(v.string()),
  fontWeight: v.optional(v.string()),
  textAlign: v.optional(v.union(v.literal("left"), v.literal("center"), v.literal("right"))),
});

export const getCourseThumbnail = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("course_thumbnails")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .first();
    return existing || null;
  },
});

export const upsertCourseThumbnail = mutation({
  args: {
    courseId: v.id("courses"),
    customTexts: v.array(courseThumbnailText),
    imagePosition: v.optional(v.object({ x: v.number(), y: v.number() })),
    imageScale: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("course_thumbnails")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        customTexts: args.customTexts,
        imagePosition: args.imagePosition,
        imageScale: args.imageScale,
        updatedAt: args.updatedAt ?? now,
      });
      return { success: true, id: existing._id };
    }

    const id = await ctx.db.insert("course_thumbnails", {
      courseId: args.courseId,
      customTexts: args.customTexts,
      imagePosition: args.imagePosition,
      imageScale: args.imageScale,
      createdAt: now,
      updatedAt: args.updatedAt ?? now,
    });
    return { success: true, id };
  },
});


