"use node";

import {
	type AutomationActions,
	createAutomationMutationInputNormalizer,
	resolveAutomationProjectIdForCreate,
} from "@workspace/ai/automation-tools";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

const automationMutationInput = createAutomationMutationInputNormalizer<
	Id<"automations">,
	Id<"notes">
>({
	toAutomationId: (automationId) => automationId as Id<"automations">,
	toNoteId: (noteId) => noteId as Id<"notes">,
});

export const createAssistantRunAutomationActions = (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		authorName: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
	},
): AutomationActions => ({
	createAutomation: async (automation) => {
		const projectId = await resolveAutomationProjectIdForCreate({
			destination: automation.destination,
			loadSourceProjectId: async () =>
				await ctx.runQuery(internal.chatProjectState.getForOwner, {
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					chatId: args.chatId,
				}),
		});
		return await ctx.runMutation(internal.automations.createForOwner, {
			projectId,
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			authorName: args.authorName,
			workspaceId: args.workspaceId,
			...automationMutationInput.create(automation),
		});
	},
	deleteAutomation: async ({ automationId }) =>
		await ctx.runMutation(internal.automations.removeForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationMutationInput.automationId(automationId),
		}),
	getAutomation: async ({ automationId }) =>
		await ctx.runQuery(internal.automations.getForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationMutationInput.automationId(automationId),
		}),
	listAutomations: async () =>
		await ctx.runQuery(internal.automations.listForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		}),
	runAutomationNow: async ({ automationId }) =>
		await ctx.runMutation(internal.automations.runNowForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationMutationInput.automationId(automationId),
		}),
	togglePaused: async ({ automationId }) =>
		await ctx.runMutation(internal.automations.togglePausedForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			automationId: automationMutationInput.automationId(automationId),
		}),
	updateAutomation: async (automation) =>
		await ctx.runMutation(internal.automations.updateFromAssistantForOwner, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			...automationMutationInput.update(automation),
		}),
});
