import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight, FileText, Globe2 } from "lucide-react";
import * as React from "react";
import { FileAttachmentGlyph } from "@/components/ai-elements/file-attachment-type-icon";
import { AppSourceIcon } from "@/components/app-source-icon";
import {
	type ChatSummaryArtifact,
	type ChatSummaryContent,
	type ChatSummarySource,
	getChatSummarySourceKey,
} from "@/lib/chat-summary-content";

const SUMMARY_ROW_CLASS_NAME =
	"flex h-8 w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-2 text-start text-sm text-muted-foreground";

export function ChatSummaryOverview({
	content,
}: {
	content: ChatSummaryContent;
}) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			reserveScrollbarGap
			viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
		>
			<div className="flex flex-col gap-2 px-3 py-4">
				<ChatSummarySection title="Artifacts">
					{content.artifacts.length > 0 ? (
						<div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
							{content.artifacts.map((artifact) => (
								<SummaryArtifactRow
									key={artifact.identity}
									artifact={artifact}
								/>
							))}
						</div>
					) : (
						<p className="px-2 py-1.5 text-xs text-muted-foreground">
							View and open files
						</p>
					)}
				</ChatSummarySection>
				<ChatSummarySection title="Sources">
					{content.sources.length > 0 ? (
						<div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
							{content.sources.map((source) => (
								<SummarySourceRow
									key={getChatSummarySourceKey(source)}
									source={source}
								/>
							))}
						</div>
					) : (
						<p className="px-2 py-1.5 text-xs text-muted-foreground">
							No sources yet
						</p>
					)}
				</ChatSummarySection>
			</div>
		</ScrollArea>
	);
}

function SummaryArtifactRow({ artifact }: { artifact: ChatSummaryArtifact }) {
	return (
		<div
			className={SUMMARY_ROW_CLASS_NAME}
			title={artifact.filename || "Attached file"}
		>
			<FileAttachmentGlyph className="size-4" file={artifact} />
			<span className="min-w-0 flex-1 basis-0 truncate">
				{artifact.filename || "Attached file"}
			</span>
		</div>
	);
}

function SummarySourceRow({ source }: { source: ChatSummarySource }) {
	if (source.kind === "app") {
		return (
			<div className={SUMMARY_ROW_CLASS_NAME} title={source.title}>
				<AppSourceIcon provider={source.provider} className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
			</div>
		);
	}

	if (source.kind === "file") {
		return (
			<div
				className={SUMMARY_ROW_CLASS_NAME}
				title={source.filename || "Attached file"}
			>
				<FileAttachmentGlyph className="size-4" file={source} />
				<span className="min-w-0 flex-1 basis-0 truncate">
					{source.filename || "Attached file"}
				</span>
			</div>
		);
	}

	if (source.kind === "web-search") {
		return (
			<div className={SUMMARY_ROW_CLASS_NAME} title={source.title}>
				<Globe2 className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
			</div>
		);
	}

	return (
		<div className={SUMMARY_ROW_CLASS_NAME} title={source.title}>
			<FileText className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
		</div>
	);
}
export function ChatSummarySection({
	children,
	defaultOpen = true,
	title,
}: {
	children: React.ReactNode;
	defaultOpen?: boolean;
	title: string;
}) {
	const contentId = React.useId();

	return (
		<Collapsible defaultOpen={defaultOpen} className="group/collapsible">
			<CollapsibleTrigger
				aria-controls={contentId}
				className={cn(
					"group/label flex h-8 w-full cursor-pointer items-center justify-start gap-1.5 rounded-lg px-3 text-xs font-medium text-sidebar-foreground/60 outline-hidden",
					"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				)}
			>
				<span>{title}</span>
				<ChevronRight
					className={cn(
						"mt-px size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/label:opacity-100 group-focus-visible/label:opacity-100",
						"group-data-[state=open]/collapsible:rotate-90",
					)}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent
				id={contentId}
				className="min-w-0 overflow-hidden px-1 pb-2"
			>
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
