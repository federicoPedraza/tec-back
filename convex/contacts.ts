import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const addContact = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if contact already exists by email or phone
    let existingContact: any = null;

    if (args.email) {
      existingContact = await ctx.db
        .query("contacts")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first();
    }

    if (!existingContact && args.phone) {
      existingContact = await ctx.db
        .query("contacts")
        .withIndex("by_phone", (q) => q.eq("phone", args.phone))
        .first();
    }

    if (existingContact) {
      // Update existing contact
      await ctx.db.patch(existingContact._id, {
        name: args.name,
        email: args.email || existingContact.email,
        phone: args.phone || existingContact.phone,
        updatedAt: now,
      });
      return existingContact._id;
    } else {
      // Create new contact
      const contactId = await ctx.db.insert("contacts", {
        name: args.name,
        email: args.email,
        phone: args.phone,
        createdAt: now,
        updatedAt: now,
      });
      return contactId;
    }
  },
});

export const getContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.contactId);
  },
});

export const getContactByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

export const getAllContacts = query({
  handler: async (ctx) => {
    return await ctx.db.query("contacts").order("desc").collect();
  },
});
