import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const adminLogin = mutation({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const record = await ctx.db
      .query("admin_credentials")
      .withIndex("by_password", (q) => q.eq("password", args.password))
      .first();

    if (!record) {
      return { success: false };
    }

    await ctx.db.patch(record._id, { lastLoginAt: now });
    return { success: true };
  },
});

export const setAdminPassword = mutation({
  args: { oldPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("admin_credentials")
      .withIndex("by_password", (q) => q.eq("password", args.oldPassword))
      .first();
    if (!record) {
      return { success: false };
    }
    await ctx.db.patch(record._id, { password: args.newPassword });
    return { success: true };
  },
});

export const addOnboarding = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    objective: v.optional(v.string()),
    experience: v.optional(v.string()),
    experienceLevel: v.optional(v.string()),
    speakingExperience: v.optional(v.string()),
    listeningExperience: v.optional(v.string()),
    readingExperience: v.optional(v.string()),
    writingExperience: v.optional(v.string()),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // First, create or update the contact
    const contactId = await ctx.runMutation(api.contacts.addContact, {
      name: args.name,
      email: args.email,
      phone: args.phone,
    });

    // Then create the onboarding request
    const requestId = await ctx.db.insert("requests", {
      contactId,
      source: "onboarding",
      requestedAt: now,
      status: "pending",
      isRead: false,
      isFavorite: false,
      note: "",
      objective: args.objective,
      experience: args.experience,
      experienceLevel: args.experienceLevel,
      speakingExperience: args.speakingExperience,
      listeningExperience: args.listeningExperience,
      readingExperience: args.readingExperience,
      writingExperience: args.writingExperience,
      comment: args.comment,
    });

    return { contactId, requestId };
  },
});

export const addInterview = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // First, create or update the contact
    const contactId = await ctx.runMutation(api.contacts.addContact, {
      name: args.name,
      email: args.email,
      phone: args.phone,
    });

    // Then create the interview request
    const requestId = await ctx.db.insert("requests", {
      contactId,
      source: "interview",
      requestedAt: now,
      status: "pending",
      isRead: false,
      isFavorite: false,
      note: "",
    });

    return { contactId, requestId };
  },
});

export const markRequestRead = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, { isRead: true });
  },
});

export const markRequestUnread = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, { isRead: false });
  },
});

export const setRequestNote = mutation({
  args: { requestId: v.id("requests"), note: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, { note: args.note });
  },
});

export const markRequestFavorite = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, { isFavorite: true });
  },
});

export const unmarkRequestFavorite = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, { isFavorite: false });
  },
});

export const updateRequestStatus = mutation({
  args: {
    requestId: v.id("requests"),
    status: v.union(v.literal("pending"), v.literal("processed")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      status: args.status,
    });
  },
});

export const getRequest = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.requestId);
  },
});

export const getRequestsByContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .order("desc")
      .collect();
  },
});

export const getAllRequests = query({
  handler: async (ctx) => {
    return await ctx.db.query("requests").order("desc").collect();
  },
});

export const getRequestsBySource = query({
  args: { source: v.union(v.literal("interview"), v.literal("onboarding")) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .order("desc")
      .collect();
  },
});

export const getRequestsByStatus = query({
  args: { status: v.union(v.literal("pending"), v.literal("processed")) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .collect();
  },
});

// ---- Added utilities (app-level filters/pagination) ----
export const getRequestsFilteredPaged = query({
  args: {
    page: v.number(),
    pageSize: v.number(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    favoritesOnly: v.optional(v.boolean()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(1, Math.trunc(args.page || 1));
    const pageSize = Math.max(1, Math.min(200, Math.trunc(args.pageSize || 20)));

    const hasStart = typeof args.startDate === "number";
    const hasEnd = typeof args.endDate === "number";

    let docs: any[] = [];
    if (hasStart && hasEnd) {
      docs = await ctx.db
        .query("requests")
        .withIndex("by_requested_at", (q) =>
          q
            .gte("requestedAt", args.startDate as number)
            .lte("requestedAt", args.endDate as number)
        )
        .order("desc")
        .collect();
    } else if (hasStart) {
      docs = await ctx.db
        .query("requests")
        .withIndex("by_requested_at", (q) => q.gte("requestedAt", args.startDate as number))
        .order("desc")
        .collect();
    } else if (hasEnd) {
      docs = await ctx.db
        .query("requests")
        .withIndex("by_requested_at", (q) => q.lte("requestedAt", args.endDate as number))
        .order("desc")
        .collect();
    } else {
      docs = await ctx.db.query("requests").order("desc").collect();
    }

    const filtered = (docs as any[]).filter((r) => {
      const isFav = !!(r as any).isFavorite;
      const isUnread = !(r as any).isRead;
      if (args.favoritesOnly && !isFav) return false;
      if (args.unreadOnly && !isUnread) return false;
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = filtered.slice(start, end);

    return { page, pageSize, total, totalPages, items };
  },
});

export const markAllRequestsRead = mutation({
  handler: async (ctx) => {
    const all = await ctx.db.query("requests").collect();
    for (const req of all) {
      if (!req.isRead) {
        await ctx.db.patch(req._id, { isRead: true });
      }
    }
    return { success: true, updated: all.length };
  },
});

export const deleteRequest = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.requestId);
    return { success: true };
  },
});

export const forceSetAdminPassword = mutation({
  args: { newPassword: v.string() },
  handler: async (ctx, args) => {
    const records = await ctx.db.query("admin_credentials").collect();
    if (!records || records.length === 0) {
      await ctx.db.insert("admin_credentials", {
        password: args.newPassword,
        lastLoginAt: Date.now(),
      });
      return { success: true, created: true };
    }
    for (const rec of records) {
      await ctx.db.patch(rec._id, { password: args.newPassword });
    }
    return { success: true, updated: records.length };
  },
});
