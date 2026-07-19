import {
	type AutomationActions,
	createAutomationMutationInputNormalizer,
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
	convexClient,
	workspaceId,
}: {
	convexClient: ConvexHttpClient;
	workspaceId: Id<"workspaces">;
}): AutomationActions => ({
	createAutomation: async (automation) =>
		await convexClient.mutation(api.automations.create, {
			workspaceId,
			...automationMutationInput.create(automation),
		}),
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
	updateAutomation: async (automation) =>
		await convexClient.mutation(
			api.automations.update,
			automationMutationInput.update(automation),
		),
});
