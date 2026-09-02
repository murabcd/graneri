import { tool } from "ai";
import { createAiToolMetadata } from "./ai-tool-authority.mjs";
import { withToolTiming } from "./tool-timing.mjs";

const normalizeToolNamespace = (namespace, toolName) => {
	if (!namespace) {
		return undefined;
	}
	const name = namespace.name.trim();
	const description = namespace.description.trim();
	if (!name || !description) {
		throw new Error(
			`AI tool ${toolName} must have a complete model-facing namespace.`,
		);
	}
	return { name, description };
};

export const defineAiTool = ({
	deferLoading = true,
	description,
	execute,
	inputSchema,
	name,
	namespace,
	policy,
	toModelOutput,
	ui,
}) => {
	const normalizedDescription = description.trim();
	const normalizedNamespace = normalizeToolNamespace(namespace, name);
	if (!normalizedDescription) {
		throw new Error(`AI tool ${name} must have a model-facing description.`);
	}

	return {
		name,
		description: normalizedDescription,
		inputSchema,
		policy,
		ui,
		toAITool: () =>
			tool({
				description: normalizedDescription,
				inputSchema,
				metadata: createAiToolMetadata({ policy, ui }),
				providerOptions: {
					openai: {
						deferLoading,
						...(normalizedNamespace && { namespace: normalizedNamespace }),
					},
				},
				toModelOutput,
				execute: async (input, options) =>
					await withToolTiming(async () => execute(input, options)),
			}),
	};
};

export const buildAiToolSet = (definitions) =>
	Object.fromEntries(
		definitions.map((definition) => [definition.name, definition.toAITool()]),
	);
