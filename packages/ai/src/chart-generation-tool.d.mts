import type { Tool, UIMessage } from "ai";

export declare const CHART_GENERATION_TOOL_NAME = "generate_chart";

export declare const buildChartGenerationInstruction: () => string;

export declare const buildChartGenerationPrepareStep: () => ({
	stepNumber,
}: {
	stepNumber: number;
}) =>
	| {
			toolChoice: { type: "tool"; toolName: typeof CHART_GENERATION_TOOL_NAME };
	  }
	| { toolChoice: "auto" };

export declare const createChartGenerationTool: () => Tool;

export declare const normalizeChartSpecInput: (value: unknown) => unknown;

export declare const parseChartSpecInput: (value: unknown) => {
	chartType: "bar" | "line" | "area" | "pie";
	title?: string;
	description?: string;
	xKey?: string;
	yKeys: string[];
	data: Array<Record<string, string | number>>;
	config: Record<string, { label: string; color?: string }>;
};

export declare const shouldEnableChartGeneration: (
	message: UIMessage | undefined,
) => boolean;
