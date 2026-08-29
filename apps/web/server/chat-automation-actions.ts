import {
	type AutomationActions,
	createAutomationMutationInputNormalizer,
	resolveAutomationProjectIdForCreate,
} from "@workspace/ai/automation-tools";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

const automationMutationInput = createAutomationMutationInputNormalizer<
	Id<"automations">,
	Id<"notes">
>({
	toAutomationId: (automationId) => automationId as Id<"automations">,
	toNoteId: (noteId) => noteId as Id<"notes">,
});

export const createHostedChatAutomationActions = ({
	chatId,
	convexClient,
	workspaceId,
}: {
	chatId: string;
	convexClient: ConvexHttpClient;
	workspaceId: Id<"workspaces">;
}): AutomationActions => ({
	createAutomation: async (automation) => {
		const projectId = await resolveAutomationProjectIdForCreate({
			destination: automation.destination,
			loadSourceProjectId: async () => {
				const sourceChat = await convexClient.query(api.chats.getSession, {
					workspaceId,
					chatId,
				});
				return sourceChat?.projectId ?? null;
			},
		});
		return await convexClient.mutation(api.automations.create, {
			workspaceId,
			...automationMutationInput.create(automation),
			projectId,
		});
	},
	deleteAutomation: async ({ automationId }) =>
		await convexClient.mutation(api.automations.remove, {
			automationId: automationMutationInput.automationId(automationId),
		}),
	getAutomation: async ({ automationId }) =>
		await convexClient.query(api.automations.get, {
			automationId: automationMutationInput.automationId(automationId),
		}),
	listAutomations: async () =>
		await convexClient.query(api.automations.list, { workspaceId }),
	runAutomationNow: async ({ automationId }) =>
		await convexClient.mutation(api.automations.runNow, {
			automationId: automationMutationInput.automationId(automationId),
		}),
	togglePaused: async ({ automationId }) =>
		await convexClient.mutation(api.automations.togglePaused, {
			automationId: automationMutationInput.automationId(automationId),
		}),
	updateAutomation: async (automation) => {
		const automationId = automationMutationInput.automationId(
			automation.automationId,
		);
		const existing = await convexClient.query(api.automations.get, {
			automationId,
		});
		return await convexClient.mutation(api.automations.update, {
			...automationMutationInput.update(automation),
			projectId: existing?.projectId ?? null,
		});
	},
});
