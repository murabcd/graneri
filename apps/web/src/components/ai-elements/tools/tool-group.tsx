import type { UIMessage } from "ai";
import { memo, useEffect, useMemo, useState } from "react";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { ToolDetails } from "@/components/ai-elements/tools/tool-details";
import {
	type AssistantWorkPart,
	isAssistantWorkPart,
	isRenderableToolUiPart,
	type ToolUiPart,
	toToolPartLike,
} from "@/components/ai-elements/tools/tool-part-like";
import { ToolPreview } from "@/components/ai-elements/tools/tool-preview";
import { hasCustomToolPreview } from "@/components/ai-elements/tools/tool-preview-policy";
import { getToolMeta } from "@/components/ai-elements/tools/tool-registry";
import { ToolRowBase } from "@/components/ai-elements/tools/tool-row-base";
import { getToolStatus } from "@/components/ai-elements/utils/format-tool";
import {
	formatElapsedTime,
	getToolDurationMs,
} from "@/components/ai-elements/utils/tool-display";

export type ToolGroupProps = {
	chatStatus: "streaming" | "ready";
	parts: UIMessage["parts"];
	startedAt?: number;
	totalDurationMs?: number;
};

const formatCallCount = (count: number) =>
	`${count} ${count === 1 ? "call" : "calls"}`;

const getGroupSummary = ({
	failedCount,
	toolCallCount,
}: {
	failedCount: number;
	toolCallCount: number;
}) => {
	if (toolCallCount === 0) {
		return undefined;
	}

	const segments = [formatCallCount(toolCallCount)];

	if (failedCount > 0) {
		segments.push(`${failedCount} failed`);
	}

	return segments.join(", ");
};

export const ToolGroup = memo(function ToolGroup({
	chatStatus,
	parts,
	startedAt,
	totalDurationMs,
}: ToolGroupProps) {
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
	const toolParts = useMemo(
		() => workParts.filter(isRenderableToolUiPart),
		[workParts],
	);
	const toolStatuses = useMemo(
		() =>
			toolParts.map((part) => getToolStatus(toToolPartLike(part), chatStatus)),
		[chatStatus, toolParts],
	);
	const [isWorkingCollapsed, setIsWorkingCollapsed] = useState(false);
	const [isWorkedExpanded, setIsWorkedExpanded] = useState(false);
	const isExpanded = isWorking ? !isWorkingCollapsed : isWorkedExpanded;
	const { completedAt, fallbackStartedAt, now } = useWorkTimer(isWorking);
	const summary = useMemo(() => {
		let failedCount = 0;

		for (const [index] of toolParts.entries()) {
			const status = toolStatuses[index];
			if (!status) {
				continue;
			}

			if (status.isError) {
				failedCount += 1;
			}
		}

		const measuredDurationMs = Math.max(
			1,
			(completedAt ?? now) - (startedAt ?? fallbackStartedAt),
		);

		return {
			durationLabel: formatElapsedTime(totalDurationMs ?? measuredDurationMs),
			detail: getGroupSummary({
				failedCount,
				toolCallCount: toolParts.length,
			}),
		};
	}, [
		completedAt,
		fallbackStartedAt,
		now,
		startedAt,
		toolParts,
		toolStatuses,
		totalDurationMs,
	]);

	return (
		<div className="mb-3 flex w-full flex-col gap-2 first:mt-0">
			<ToolRowBase
				shimmerLabel="Working"
				completeLabel="Worked"
				isAnimating={isWorking}
				detail={summary.detail}
				expandable={renderableWorkParts.length > 0}
				expanded={isExpanded}
				onToggleExpand={() => {
					if (isWorking) {
						setIsWorkingCollapsed((collapsed) => !collapsed);
						return;
					}

					setIsWorkedExpanded((expanded) => !expanded);
				}}
				trailingContent={
					summary.durationLabel ? (
						<span className="shrink-0 font-normal tabular-nums text-muted-foreground/60">
							{summary.durationLabel}
						</span>
					) : undefined
				}
			>
				<div className="flex flex-col gap-1.5">
					{renderableWorkParts.map((part, index) =>
						part.type === "reasoning" ? (
							<Reasoning
								key={getWorkPartKey(part, index)}
								text={part.text}
								isStreaming={
									chatStatus === "streaming" && part.state !== "done"
								}
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
			</ToolRowBase>
		</div>
	);
});

const getToolDisplayDurationMs = ({
	completedAt,
	fallbackStartedAt,
	isPending,
	now,
	part,
}: {
	completedAt: number | null;
	fallbackStartedAt: number;
	isPending: boolean;
	now: number;
	part: ReturnType<typeof toToolPartLike>;
}) => {
	const completedDuration = getToolDurationMs(part);
	if (completedDuration !== null && completedDuration > 0) {
		return completedDuration;
	}

	if (!isPending && completedAt !== null) {
		return Math.max(1, completedAt - fallbackStartedAt);
	}

	return isPending ? Math.max(1, now - fallbackStartedAt) : null;
};

const useWorkTimer = (isPending: boolean) => {
	const [fallbackStartedAt] = useState(() => Date.now());
	const [completedAt, setCompletedAt] = useState<number | null>(null);
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

	useEffect(() => {
		if (isPending) {
			if (completedAt !== null) {
				setCompletedAt(null);
			}
			return;
		}

		if (completedAt === null) {
			setCompletedAt(Date.now());
		}
	}, [completedAt, isPending]);

	return {
		completedAt,
		fallbackStartedAt,
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
	const { completedAt, fallbackStartedAt, now } = useWorkTimer(isPending);
	const durationMs = getToolDisplayDurationMs({
		completedAt,
		fallbackStartedAt,
		isPending,
		now,
		part: toolPart,
	});
	const durationLabel =
		durationMs !== null ? formatElapsedTime(Math.max(1, durationMs)) : "";
	const hasPreview = hasCustomToolPreview({ isError, toolPart });
	const hasDetails = Boolean(
		hasPreview || toolPart.input || toolPart.output || toolPart.errorText,
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
			trailingContent={
				durationLabel ? (
					<span className="shrink-0 font-normal tabular-nums text-muted-foreground/60">
						{durationLabel}
					</span>
				) : undefined
			}
		>
			{hasPreview ? (
				<ToolPreview isError={isError} toolPart={toolPart} />
			) : (
				<ToolDetails
					input={toolPart.input}
					output={toolPart.output}
					errorText={toolPart.errorText}
				/>
			)}
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
