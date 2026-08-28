import { tool } from "ai";
import { createAiToolMetadata } from "./ai-tool-authority.mjs";
import { withToolTiming } from "./tool-timing.mjs";

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
			metadata: createAiToolMetadata({ policy, ui }),
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
