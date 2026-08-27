import type { ToolSet } from "ai";
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

export declare function defineAiTool<TInput, TOutput extends object>(args: {
	deferLoading?: boolean;
	description: string;
	execute(input: TInput): Promise<TOutput> | TOutput;
	inputSchema: z.ZodType<TInput>;
	name: string;
	policy: AiToolPolicy;
	ui: AiToolUi;
}): AiToolDefinition<TInput>;

export declare function buildAiToolSet(
	definitions: AiToolDefinition[],
): ToolSet;

export declare function buildAiToolMetadata(
	definitions: AiToolDefinition[],
): Record<
	string,
	{
		description: string;
		policy: AiToolPolicy;
		ui: AiToolUi;
	}
>;
