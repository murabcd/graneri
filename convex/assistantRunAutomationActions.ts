"use node";

import type {
	AutomationActions,
	AutomationToolInput,
} from "@workspace/ai/automation-tools";
import {
	type ChatAppSourceProvider,
	chatAppSourceProviders,
} from "@workspace/ai/capability-metadata";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

const automationAppSourceProviders = new Set<string>(chatAppSourceProviders);

const toAutomationAppSourceProvider = (
	provider: string,
): ChatAppSourceProvider => {
	if (!automationAppSourceProviders.has(provider)) {
		throw new Error(`Unsupported automation app source: ${provider}`);
	}
	return provider as ChatAppSourceProvider;
};

const toAutomationMutationInput = (automation: AutomationToolInput) => ({
	...automation,
	appSources: automation.appSources.map((source) => ({
		...source,
		provider: toAutomationAppSourceProvider(source.provider),
	})),
	target:
		automation.target.kind === "notes"
			? {
					kind: "notes" as const,
					noteIds: automation.target.noteIds.map(
						(noteId) => noteId as Id<"notes">,
					),
				}
			: { kind: "workspace" as const },
});

export const createAssistantRunAutomationActions = (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		authorName: string;
		workspaceId: Id<"workspaces">;
	},
): AutomationActions => ({
	createAutomation: async (automation) =>
		await ctx.runMutation(internal.automations.createForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			authorName: args.authorName,
			workspaceId: args.workspaceId,
			...toAutomationMutationInput(automation),
		}),
	deleteAutomation: async ({ automationId }) =>
		await ctx.runMutation(internal.automations.removeForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationId as Id<"automations">,
		}),
	getAutomation: async ({ automationId }) =>
		await ctx.runQuery(internal.automations.getForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationId as Id<"automations">,
		}),
	listAutomations: async () =>
		await ctx.runQuery(internal.automations.listForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		}),
	runAutomationNow: async ({ automationId }) =>
		await ctx.runMutation(internal.automations.runNowForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationId as Id<"automations">,
		}),
	togglePaused: async ({ automationId }) =>
		await ctx.runMutation(internal.automations.togglePausedForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationId as Id<"automations">,
		}),
	updateAutomation: async ({ automationId, ...automation }) =>
		await ctx.runMutation(internal.automations.updateForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationId as Id<"automations">,
			...toAutomationMutationInput(automation),
		}),
});
