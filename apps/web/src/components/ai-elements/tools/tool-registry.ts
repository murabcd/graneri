import { remoteMcpToolPrefixes } from "@workspace/ai/capability-metadata";
import {
	type ToolUiIcon,
	toolUiMetadata,
} from "@workspace/ai/tool-ui-metadata";
import type { DynamicToolUIPart, JSONValue, ToolUIPart } from "ai";
import {
	AudioLines,
	Calendar,
	ChartNoAxesColumn,
	Database,
	FileImage,
	FileSearch,
	FileText,
	FolderClosed,
	FolderOpen,
	Globe,
	Search,
	Terminal,
	Video,
} from "lucide-react";
import type React from "react";
import { z } from "zod";
import { getTrimmedString } from "@/lib/string-value";

export type ToolMeta = {
	errorTitle?: (part: ToolPartLike) => string;
	groupKey?: string;
	groupLabel?: string;
	icon: React.ComponentType<{ className?: string }>;
	subtitle?: (part: ToolPartLike) => string;
	title: (part: ToolPartLike) => string;
};

type NativeToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolPartLike = {
	errorText?: string;
	input?: JSONValue;
	output?: JSONValue;
	state: NativeToolPart["state"];
	toolMetadata?: NativeToolPart["toolMetadata"];
	toolCallId: string;
	toolName: string;
	type: NativeToolPart["type"];
};

const isPending = (part: ToolPartLike) =>
	part.state !== "output-available" && part.state !== "output-error";

const getFirstString = (value: JSONValue | undefined, keys: string[]) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "";
	}

	for (const key of keys) {
		const candidate = getTrimmedString(value[key]);
		if (candidate) {
			return candidate;
		}
	}

	return "";
};

const clamp = (value: string, maxLength = 54) =>
	value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const getReadableToolName = (name: string) =>
	name
		.trim()
		.replace(/^tool-/u, "")
		.replace(/[_-]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();

const toolIconRegistry = {
	"audio-lines": AudioLines,
	calendar: Calendar,
	chart: ChartNoAxesColumn,
	database: Database,
	"file-image": FileImage,
	"file-search": FileSearch,
	"file-text": FileText,
	folder: FolderClosed,
	"folder-open": FolderOpen,
	globe: Globe,
	search: Search,
	terminal: Terminal,
	video: Video,
} satisfies Record<
	ToolUiIcon | "audio-lines" | "video",
	React.ComponentType<{ className?: string }>
>;

const dynamicToolIconSchema = z.enum([
	"audio-lines",
	"calendar",
	"chart",
	"database",
	"file-image",
	"file-search",
	"file-text",
	"folder",
	"folder-open",
	"globe",
	"search",
	"terminal",
	"video",
]);

const toolUiSchema = z.object({
	complete: z.string().min(1),
	error: z.string().optional(),
	groupKey: z.string().optional(),
	groupLabel: z.string().optional(),
	icon: dynamicToolIconSchema,
	running: z.string().min(1),
	subtitleKeys: z.array(z.string()).optional(),
});

const makeToolMeta = ({
	complete,
	error,
	groupKey,
	icon: iconKey,
	running,
	subtitleKeys,
}: {
	complete: string;
	error?: string;
	groupKey?: string;
	icon: ToolUiIcon;
	running: string;
	subtitleKeys?: string[];
}): ToolMeta => ({
	groupKey,
	icon: toolIconRegistry[iconKey],
	errorTitle: error ? () => error : undefined,
	title: (part) => (isPending(part) ? running : complete),
	subtitle: subtitleKeys
		? (part) => clamp(getFirstString(part.input, subtitleKeys))
		: undefined,
});

const toolRegistry: Record<string, ToolMeta> = {};
for (const [toolName, metadata] of Object.entries(toolUiMetadata)) {
	toolRegistry[`tool-${toolName}`] = makeToolMeta(metadata);
}

const getStaticToolMeta = (part: ToolPartLike) => {
	if (part.type === "dynamic-tool") {
		return null;
	}

	return toolRegistry[part.type] ?? null;
};

function getRemoteMcpPrefixMeta(part: ToolPartLike): ToolMeta | null {
	const toolName =
		getTrimmedString(part.toolName) || getTrimmedString(part.type);
	const provider = remoteMcpToolPrefixes.find(({ prefix }) =>
		toolName.startsWith(prefix),
	);

	if (!provider) {
		return null;
	}

	const operation = clamp(
		getReadableToolName(toolName.slice(provider.prefix.length)) ||
			`${provider.label} tool`,
	);

	return {
		groupKey: `mcp:${provider.provider}`,
		groupLabel: provider.label,
		icon: Database,
		title: (currentPart) =>
			isPending(currentPart)
				? `Using ${provider.label}: ${operation}`
				: `Used ${provider.label}: ${operation}`,
		subtitle: (currentPart) =>
			clamp(
				getFirstString(currentPart.input, [
					"query",
					"question",
					"q",
					"search",
					"jql",
					"issueKey",
					"key",
					"url",
					"id",
					"name",
					"title",
				]),
			),
	};
}

function getMetadataToolMeta(part: ToolPartLike): ToolMeta | null {
	const metadata = part.toolMetadata;
	const result = toolUiSchema.safeParse(metadata?.ui);
	if (!result.success) {
		return null;
	}
	const ui = result.data;

	const running = getTrimmedString(ui.running);
	const complete = getTrimmedString(ui.complete);
	const error = getTrimmedString(ui.error);
	if (!running || !complete) {
		return null;
	}

	const icon = toolIconRegistry[ui.icon];
	const subtitleKeys = ui.subtitleKeys ?? [];
	const groupKey = getTrimmedString(ui.groupKey) || undefined;
	const groupLabel = getTrimmedString(ui.groupLabel) || undefined;
	const isRemoteMcpTool = getTrimmedString(metadata?.source) === "mcp";
	const mcpToolName = getTrimmedString(metadata?.mcpToolName);
	const operationLabel =
		isRemoteMcpTool && mcpToolName ? getReadableToolName(mcpToolName) : "";

	return {
		groupKey,
		groupLabel,
		icon,
		errorTitle: error ? () => error : undefined,
		title: (currentPart) => {
			const title = isPending(currentPart) ? running : complete;
			return operationLabel ? `${title}: ${operationLabel}` : title;
		},
		subtitle: (currentPart) => {
			const value = getFirstString(currentPart.input, subtitleKeys);
			return value ? clamp(value) : "";
		},
	};
}

export const getToolMeta = (part: ToolPartLike) =>
	getMetadataToolMeta(part) ??
	getStaticToolMeta(part) ??
	getRemoteMcpPrefixMeta(part);
