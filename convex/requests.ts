import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

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
    });

    return { contactId, requestId };
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
