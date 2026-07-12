import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

export type AuthenticatedIdentity = NonNullable<
	Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
>;

type AuthContext = Pick<ActionCtx | MutationCtx | QueryCtx, "auth">;

const requireIdentity = async (ctx: AuthContext, resourceName: string) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: `You must be signed in to access ${resourceName}.`,
		});
	}

	return identity;
};

export const createResourceAccess = (resourceName: string) => ({
	requireIdentity: (ctx: AuthContext) => requireIdentity(ctx, resourceName),
	requireTokenIdentifier: async (ctx: AuthContext) =>
		(await requireIdentity(ctx, resourceName)).tokenIdentifier,
});

export const requireOwnedWorkspace = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const workspace = await ctx.db.get(workspaceId);

	if (!workspace || workspace.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "WORKSPACE_NOT_FOUND",
			message: "Workspace not found.",
		});
	}

	return workspace;
};

export const getAuthorName = (identity: AuthenticatedIdentity) =>
	identity.name?.trim() || identity.email?.trim() || "Unknown user";

export const clampWhitespace = (value: string) =>
	value.replace(/\s+/g, " ").trim();

export const truncate = (value: string, maxLength: number) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

export const uppercaseFirstCharacter = (value: string) => {
	if (!value) {
		return value;
	}

	return value.charAt(0).toUpperCase() + value.slice(1);
};
