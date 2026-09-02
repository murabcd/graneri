import type { Tool } from "ai";

export declare const CHART_GENERATION_TOOL_NAME = "generate_chart";

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
