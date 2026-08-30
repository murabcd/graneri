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
	toModelOutput,
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
			toModelOutput,
			execute: async (input, options) =>
				await withToolTiming(async () => execute(input, options)),
		}),
});

export const buildAiToolSet = (definitions) =>
	Object.fromEntries(
		definitions.map((definition) => [definition.name, definition.toAITool()]),
	);
