import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const subscribe = mutation({
  args: {
    name: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create or find contact based on email
    let contactId: any;

    // Check if contact already exists by email
    const existingContact = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingContact) {
      // Update existing contact with new name if provided
      await ctx.db.patch(existingContact._id, {
        name: args.name,
        updatedAt: now,
      });
      contactId = existingContact._id;
    } else {
      // Create new contact
      contactId = await ctx.db.insert("contacts", {
        name: args.name,
        email: args.email,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Check if newsletter subscription already exists for this contact
    const existingSubscription = await ctx.db
      .query("newsletter")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .first();

    if (existingSubscription) {
      // Update existing subscription to active
      await ctx.db.patch(existingSubscription._id, {
        active: true,
        subscription_at: now,
      });
    } else {
      // Create new newsletter subscription
      await ctx.db.insert("newsletter", {
        contactId,
        subscription_at: now,
        active: true,
      });
    }

    return { success: true, message: "Successfully subscribed to newsletter" };
  },
});

export const unsubscribe = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Find contact by email
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!contact) {
      return { success: true, message: "Email not found in our records" };
    }

    // Find newsletter subscription for this contact
    const subscription = await ctx.db
      .query("newsletter")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .first();

    if (subscription) {
      // Update subscription to inactive
      await ctx.db.patch(subscription._id, {
        active: false,
      });
    }

    return { success: true, message: "Successfully unsubscribed from newsletter" };
  },
});

export const getSubscription = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Find contact by email
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!contact) {
      return null;
    }

    // Find newsletter subscription for this contact
    const subscription = await ctx.db
      .query("newsletter")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .first();

    if (!subscription) {
      return null;
    }

    return {
      contactId: contact._id,
      email: contact.email,
      name: contact.name,
      subscription_at: subscription.subscription_at,
      active: subscription.active,
    };
  },
});

export const getAllActiveSubscriptions = query({
  handler: async (ctx) => {
    // Get all active newsletter subscriptions with contact details
    const activeSubscriptions = await ctx.db
      .query("newsletter")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    const subscriptionsWithContacts = await Promise.all(
      activeSubscriptions.map(async (subscription) => {
        const contact = await ctx.db.get(subscription.contactId);
        return {
          subscriptionId: subscription._id,
          contactId: subscription.contactId,
          email: contact?.email,
          name: contact?.name,
          subscription_at: subscription.subscription_at,
          active: subscription.active,
        };
      })
    );

    return subscriptionsWithContacts;
  },
});
