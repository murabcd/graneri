import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const AI_ADMISSION_RESERVATION_TTL_MS = 5 * 60 * 1000;

export const createChatTurnAdmissionReservation = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const createdAt = Date.now();
	const reservationId = await ctx.db.insert("aiAdmissionReservations", {
		ownerTokenIdentifier,
		operation: "chat-turn",
		createdAt,
		expiresAt: createdAt + AI_ADMISSION_RESERVATION_TTL_MS,
	});
	await ctx.scheduler.runAfter(
		AI_ADMISSION_RESERVATION_TTL_MS,
		internal.aiAdmissionReservations.expire,
		{ reservationId },
	);
	return reservationId;
};

export const consumeChatTurnAdmissionReservation = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		reservationId?: Id<"aiAdmissionReservations">;
	},
) => {
	if (!args.reservationId) {
		throw new ConvexError({
			code: "AI_ADMISSION_REQUIRED",
			message: "Assistant generation requires a valid admission reservation.",
		});
	}

	const reservation = await ctx.db.get(args.reservationId);
	if (
		!reservation ||
		reservation.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
		reservation.operation !== "chat-turn"
	) {
		throw new ConvexError({
			code: "AI_ADMISSION_INVALID",
			message: "Assistant generation admission reservation is invalid.",
		});
	}
	if (reservation.expiresAt <= Date.now()) {
		throw new ConvexError({
			code: "AI_ADMISSION_EXPIRED",
			message: "Assistant generation admission reservation has expired.",
		});
	}

	await ctx.db.delete(reservation._id);
};

export const expire = internalMutation({
	args: {
		reservationId: v.id("aiAdmissionReservations"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const reservation = await ctx.db.get(args.reservationId);
		if (reservation && reservation.expiresAt <= Date.now()) {
			await ctx.db.delete(reservation._id);
		}
		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const reservations = await ctx.db
			.query("aiAdmissionReservations")
			.withIndex("by_ownerTokenIdentifier", (query) =>
				query.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.collect();
		await Promise.all(
			reservations.map((reservation) => ctx.db.delete(reservation._id)),
		);
		return null;
	},
});
