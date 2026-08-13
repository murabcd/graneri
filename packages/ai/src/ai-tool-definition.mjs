import { tool } from "ai";
import { withToolTiming } from "./tool-timing.mjs";

const GRANERI_TOOL_METADATA_KEY = "graneri";

export const requiresAiToolUserApproval = (toolDefinition) =>
	toolDefinition.metadata?.[GRANERI_TOOL_METADATA_KEY]?.requiresApproval ===
	true;

export const defineAiTool = ({
	deferLoading = true,
	description,
	execute,
	inputSchema,
	name,
	policy,
	ui,
}) => ({
	name,
	description,
	inputSchema,
	policy,
	ui,
	toAITool: () =>
		tool({
			description,
			inputSchema,
			metadata: {
				...(policy.requiresApproval && {
					[GRANERI_TOOL_METADATA_KEY]: {
						requiresApproval: true,
					},
				}),
				ui,
			},
			providerOptions: {
				openai: {
					deferLoading,
				},
			},
			execute: async (input) =>
				await withToolTiming(async () => execute(input)),
		}),
});

export const buildAiToolSet = (definitions) =>
	Object.fromEntries(
		definitions.map((definition) => [definition.name, definition.toAITool()]),
	);

export const buildAiToolMetadata = (definitions) =>
	Object.fromEntries(
		definitions.map((definition) => [
			definition.name,
			{
				description: definition.description,
				policy: definition.policy,
				ui: definition.ui,
			},
		]),
	);
