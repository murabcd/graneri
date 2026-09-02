import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { ARTIFACT_TOOL_NAMESPACE } from "./artifact-authoring-contract.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const CHART_GENERATION_TOOL_NAME = "generate_chart";

const chartDataValueSchema = z.union([z.string(), z.number()]);
const chartKeySchema = z
	.string()
	.min(1)
	.max(64)
	.regex(
		/^[A-Za-z][A-Za-z0-9_-]*$/u,
		"Chart keys must start with a letter and contain only letters, numbers, underscores, or dashes.",
	);

const chartDataRowSchema = z
	.record(z.string().min(1), chartDataValueSchema)
	.refine(
		(row) => Object.keys(row).length <= 16,
		"Chart rows can contain at most 16 fields.",
	);

const chartSeriesConfigSchema = z.object({
	label: z.string().min(1).max(80),
	color: z.string().max(80).optional(),
});

const canonicalChartSpecSchema = z
	.object({
		chartType: z.enum(["bar", "line", "area", "pie"]),
		title: z.string().min(1).max(120).optional(),
		description: z.string().min(1).max(240).optional(),
		xKey: chartKeySchema.optional(),
		yKeys: z.array(chartKeySchema).min(1).max(5),
		data: z.array(chartDataRowSchema).min(1).max(80),
		config: z
			.record(chartKeySchema, chartSeriesConfigSchema)
			.optional()
			.default({}),
	})
	.refine(
		(spec) => spec.chartType === "pie" || Boolean(spec.xKey),
		"Bar, line, and area charts require xKey.",
	)
	.refine(
		(spec) => spec.chartType !== "pie" || spec.yKeys.length === 1,
		"Pie charts support exactly one numeric value key.",
	)
	.refine(
		(spec) =>
			spec.data.every((row) => {
				if (spec.xKey && !(spec.xKey in row)) {
					return false;
				}

				return spec.yKeys.every(
					(key) => typeof row[key] === "number" && Number.isFinite(row[key]),
				);
			}),
		"Every row must include the xKey and finite numeric yKey values.",
	);

const repairableChartSpecSchema = z
	.object({
		chartType: z.string().optional(),
		type: z.string().optional(),
		title: z.string().optional(),
		description: z.string().optional(),
		xKey: z.string().optional(),
		x_key: z.string().optional(),
		categoryKey: z.string().optional(),
		yKeys: z.union([z.string(), z.array(z.string())]).optional(),
		yKey: z.string().optional(),
		valueKey: z.string().optional(),
		data: z.array(z.record(z.string(), chartDataValueSchema)).min(1).max(80),
		config: z.record(z.string(), chartSeriesConfigSchema).optional(),
	})
	.passthrough();

const normalizeChartType = (value) => {
	const normalized = value
		?.trim()
		.toLowerCase()
		.replace(/[\s_-]+chart$/u, "");
	return normalized === "column"
		? "bar"
		: normalized === "donut" || normalized === "doughnut"
			? "pie"
			: normalized;
};

const normalizeChartKey = (value) => {
	const normalized = value
		.trim()
		.replace(/[^A-Za-z0-9_-]+/gu, "_")
		.replace(/^([^A-Za-z])/u, "field_$1")
		.slice(0, 64);
	return normalized || "value";
};

const createChartKeyMap = (sourceKeys) => {
	const usedKeys = new Set();
	return Object.fromEntries(
		sourceKeys.map((sourceKey) => {
			const baseKey = normalizeChartKey(sourceKey);
			let key = baseKey;
			let suffix = 2;
			while (usedKeys.has(key)) {
				const suffixText = `_${suffix}`;
				key = `${baseKey.slice(0, 64 - suffixText.length)}${suffixText}`;
				suffix += 1;
			}
			usedKeys.add(key);
			return [sourceKey, key];
		}),
	);
};

export const normalizeChartSpecInput = (value) => {
	const parsed = repairableChartSpecSchema.safeParse(value);
	if (!parsed.success) {
		return value;
	}
	const raw = parsed.data;
	const firstRow = raw.data[0];
	const firstRowKeys = Object.keys(firstRow);
	const sourceKeys = [...new Set(raw.data.flatMap((row) => Object.keys(row)))];
	const explicitYKeys = Array.isArray(raw.yKeys)
		? raw.yKeys
		: raw.yKeys
			? [raw.yKeys]
			: raw.yKey
				? [raw.yKey]
				: raw.valueKey
					? [raw.valueKey]
					: [];
	const explicitXKey = raw.xKey ?? raw.x_key ?? raw.categoryKey;
	const inferredXKey =
		explicitXKey ??
		firstRowKeys.find((key) => typeof firstRow[key] === "string") ??
		firstRowKeys[0];
	const inferredYKeys =
		explicitYKeys.length > 0
			? explicitYKeys
			: firstRowKeys
					.filter((key) => key !== inferredXKey)
					.filter((key) => {
						const entry = firstRow[key];
						return (
							typeof entry === "number" ||
							(typeof entry === "string" &&
								entry.trim() !== "" &&
								Number.isFinite(Number(entry)))
						);
					});
	const keyMap = createChartKeyMap(sourceKeys);
	const xKey = inferredXKey ? keyMap[inferredXKey] : undefined;
	const yKeys = inferredYKeys.map(
		(key) => keyMap[key] ?? normalizeChartKey(key),
	);
	const numericKeys = new Set(inferredYKeys);
	const data = raw.data.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, entry]) => {
				const numericValue =
					numericKeys.has(key) &&
					typeof entry === "string" &&
					entry.trim() !== ""
						? Number(entry)
						: entry;
				return [keyMap[key] ?? normalizeChartKey(key), numericValue];
			}),
		),
	);
	const config = Object.fromEntries(
		Object.entries(raw.config ?? {}).map(([key, entry]) => [
			keyMap[key] ?? normalizeChartKey(key),
			entry,
		]),
	);

	return {
		chartType: normalizeChartType(raw.chartType ?? raw.type),
		title: raw.title,
		description: raw.description,
		xKey,
		yKeys,
		data,
		config,
	};
};

const chartSpecSchema = z.preprocess(
	normalizeChartSpecInput,
	canonicalChartSpecSchema,
);

export const parseChartSpecInput = (value) => chartSpecSchema.parse(value);

const isSafeChartColor = (color) =>
	typeof color === "string" &&
	(/^var\(--chart-[1-5]\)$/u.test(color) ||
		/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(color));

const normalizeChartConfig = (spec) =>
	Object.fromEntries(
		spec.yKeys.map((key, index) => {
			const config = spec.config[key] ?? {};
			const color = isSafeChartColor(config.color)
				? config.color
				: `var(--chart-${(index % 5) + 1})`;

			return [
				key,
				{
					label: config.label || key,
					color,
				},
			];
		}),
	);

export const createChartGenerationTool = () =>
	defineAiTool({
		name: CHART_GENERATION_TOOL_NAME,
		description:
			"Create a visual bar, line, area, or pie chart only when the user explicitly asks for a chart, graph, plot, or data visualization and sufficient numeric data is available. Do not use this for research, prose comparisons, comparison tables, or answers that merely contain numbers. Use only user-provided or retrieved data; never invent values.",
		inputSchema: chartSpecSchema,
		namespace: ARTIFACT_TOOL_NAMESPACE,
		policy: {
			access: "read",
			approval: "not_required",
			capability: "generate",
			provider: "openai",
		},
		ui: toolUiMetadata.generate_chart,
		execute: async (spec) => ({
			...spec,
			config: normalizeChartConfig(spec),
			type: "chart",
		}),
	}).toAITool();
