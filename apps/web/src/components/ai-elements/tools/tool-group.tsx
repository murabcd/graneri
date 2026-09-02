import type { UIMessage } from "ai";
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { ToolDetails } from "@/components/ai-elements/tools/tool-details";
import {
	type AssistantWorkPart,
	isAssistantWorkPart,
	type ToolUiPart,
	toToolPartLike,
} from "@/components/ai-elements/tools/tool-part-like";
import { getToolMeta } from "@/components/ai-elements/tools/tool-registry";
import { ToolRowBase } from "@/components/ai-elements/tools/tool-row-base";
import { getToolStatus } from "@/components/ai-elements/utils/format-tool";
import { formatElapsedTime } from "@/components/ai-elements/utils/tool-display";

export type AssistantActivityGroupProps = {
	chatStatus: "streaming" | "ready";
	parts: UIMessage["parts"];
};

export type AssistantWorkGroupProps = {
	children?: ReactNode;
	hasActivity: boolean;
	status: "streaming" | "ready";
	startedAt?: number;
	totalDurationMs?: number;
};

export const AssistantActivityGroup = memo(function AssistantActivityGroup({
	chatStatus,
	parts,
}: AssistantActivityGroupProps) {
	const workParts = useMemo(() => parts.filter(isAssistantWorkPart), [parts]);
	const isWorking = chatStatus === "streaming";
	const renderableWorkParts = useMemo(
		() =>
			workParts.filter(
				(part) =>
					part.type !== "reasoning" ||
					part.text.trim().length > 0 ||
					(isWorking && part.state !== "done"),
			),
		[isWorking, workParts],
	);
	if (renderableWorkParts.length === 0) {
		return null;
	}

	return (
		<div className="flex w-full flex-col gap-1.5">
			{renderableWorkParts.map((part, index) =>
				part.type === "reasoning" ? (
					<Reasoning
						key={getWorkPartKey(part, index)}
						text={part.text}
						isStreaming={chatStatus === "streaming" && part.state !== "done"}
					/>
				) : (
					<NestedToolRow
						key={getWorkPartKey(part, index)}
						part={part}
						chatStatus={chatStatus}
					/>
				),
			)}
		</div>
	);
});

export const AssistantWorkGroup = memo(function AssistantWorkGroup({
	children,
	hasActivity,
	startedAt,
	status,
	totalDurationMs,
}: AssistantWorkGroupProps) {
	const [fallbackStartedAt] = useState(() => Date.now());

	return (
		<AssistantWorkGroupPhase
			key={status}
			fallbackStartedAt={fallbackStartedAt}
			hasActivity={hasActivity}
			startedAt={startedAt}
			status={status}
			totalDurationMs={totalDurationMs}
		>
			{children}
		</AssistantWorkGroupPhase>
	);
});

const AssistantWorkGroupPhase = ({
	children,
	fallbackStartedAt,
	hasActivity,
	startedAt,
	status,
	totalDurationMs,
}: AssistantWorkGroupProps & { fallbackStartedAt: number }) => {
	const isWorking = status === "streaming";
	const [isWorkingCollapsed, setIsWorkingCollapsed] = useState(false);
	const [isWorkedExpanded, setIsWorkedExpanded] = useState(false);
	const isExpanded = hasActivity
		? isWorking
			? !isWorkingCollapsed
			: isWorkedExpanded
		: false;
	const { completedAt, now } = useWorkTimer(isWorking);
	const measuredDurationMs = Math.max(
		1,
		(completedAt ?? now) - (startedAt ?? fallbackStartedAt),
	);
	const durationLabel = formatElapsedTime(
		totalDurationMs ?? measuredDurationMs,
	);

	return (
		<div
			className="mb-4 flex w-full flex-col gap-2 first:mt-0"
			data-assistant-work-group
		>
			<ToolRowBase
				ariaLabel={`${isWorking ? "Working" : "Worked"} for ${durationLabel}`}
				shimmerLabel="Working"
				completeLabel="Worked"
				isAnimating={isWorking}
				expandable={hasActivity}
				expanded={isExpanded}
				onToggleExpand={() => {
					if (isWorking) {
						setIsWorkingCollapsed((collapsed) => !collapsed);
						return;
					}

					setIsWorkedExpanded((expanded) => !expanded);
				}}
				separatorAfterRow
				trailingContent={
					<span className="shrink-0 font-normal tabular-nums text-muted-foreground/60">
						{" for "}
						<span>{durationLabel}</span>
					</span>
				}
			>
				<div className="flex flex-col gap-3">{children}</div>
			</ToolRowBase>
		</div>
	);
};

const useWorkTimer = (isPending: boolean) => {
	const [completedAt] = useState<number | null>(() =>
		isPending ? null : Date.now(),
	);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!isPending) {
			return;
		}

		setNow(Date.now());
		const interval = window.setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => window.clearInterval(interval);
	}, [isPending]);

	return {
		completedAt,
		now,
	};
};

const getWorkPartKey = (part: AssistantWorkPart, index: number) =>
	part.type === "reasoning"
		? `reasoning:${index}`
		: part.toolCallId || `${part.type}:${index}`;

const NestedToolRow = memo(function NestedToolRow({
	chatStatus,
	part,
}: {
	chatStatus: "streaming" | "ready";
	part: ToolUiPart;
}) {
	const toolPart = toToolPartLike(part);
	const { isError, isPending } = getToolStatus(toolPart, chatStatus);
	const hasDetails = Boolean(
		toolPart.input || toolPart.output || toolPart.errorText,
	);

	const meta = getToolMeta(toolPart);
	if (!meta) {
		return null;
	}

	const Icon = meta.icon;
	const title = meta.title(toolPart);

	return (
		<ToolRowBase
			icon={
				Icon ? (
					<Icon className="size-full shrink-0 text-muted-foreground" />
				) : undefined
			}
			shimmerLabel={title}
			completeLabel={getNestedLabel({ isError, title })}
			isAnimating={isPending}
			detail={meta.subtitle?.(toolPart)}
			expandable={hasDetails}
			hideChevronUntilHover
		>
			<ToolDetails
				input={toolPart.input}
				output={toolPart.output}
				errorText={toolPart.errorText}
			/>
		</ToolRowBase>
	);
});

const getNestedLabel = ({
	isError,
	title,
}: {
	isError: boolean;
	title: string;
}) => {
	if (isError) {
		return `${title} failed`;
	}

	return title;
};
