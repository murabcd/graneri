import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireIdentity } from "./domain";

export const verify = query({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => {
		await requireIdentity(ctx, "AI features");
		return true;
	},
});
