import type { Tool, ToolExecutionOptions, ToolSet } from "ai";
import type { z } from "zod";
import type { AiToolPolicy, AiToolUi } from "./ai-tool-authority.mjs";

export type AiToolDefinition<TInput = unknown> = {
	description: string;
	inputSchema: z.ZodType<TInput>;
	name: string;
	policy: AiToolPolicy;
	ui: AiToolUi;
	toAITool(): ToolSet[string];
};

export type AiToolNamespace = {
	description: string;
	name: string;
};

export declare function defineAiTool<TInput, TOutput extends object>(args: {
	deferLoading?: boolean;
	description: string;
	execute(
		input: TInput,
		options: ToolExecutionOptions<never>,
	): Promise<TOutput> | TOutput;
	inputSchema: z.ZodType<TInput>;
	name: string;
	namespace?: AiToolNamespace;
	policy: AiToolPolicy;
	toModelOutput?: Tool<TInput, TOutput>["toModelOutput"];
	ui: AiToolUi;
}): AiToolDefinition<TInput>;

export declare function buildAiToolSet(
	definitions: AiToolDefinition[],
): ToolSet;
