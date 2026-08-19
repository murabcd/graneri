import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight, FileText, Paperclip } from "lucide-react";
import * as React from "react";
import { AppSourceIcon } from "@/components/app-source-icon";
import {
	type ChatSummaryApp,
	type ChatSummaryArtifact,
	type ChatSummaryContent,
	type ChatSummarySource,
	getChatSummarySourceKey,
} from "@/lib/chat-summary-content";

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
								<SummaryArtifactRow key={artifact.url} artifact={artifact} />
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
				<ChatSummarySection title="Apps used">
					{content.appsUsed.length > 0 ? (
						<div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
							{content.appsUsed.map((app) => (
								<SummaryAppRow key={app.provider} app={app} />
							))}
						</div>
					) : (
						<p className="px-2 py-1.5 text-xs text-muted-foreground">
							No apps used yet
						</p>
					)}
				</ChatSummarySection>
			</div>
		</ScrollArea>
	);
}

function SummaryArtifactRow({ artifact }: { artifact: ChatSummaryArtifact }) {
	return (
		<HoverCard openDelay={150}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					title={artifact.filename || "Attached file"}
					className={cn(
						"group/artifact flex h-8 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-muted-foreground transition-colors",
						"hover:bg-accent/50 hover:text-foreground",
					)}
				>
					<Paperclip className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 basis-0 truncate">
						{artifact.filename || "Attached file"}
					</span>
				</button>
			</HoverCardTrigger>
			<SummaryFilePreview file={artifact} />
		</HoverCard>
	);
}

function SummarySourceRow({ source }: { source: ChatSummarySource }) {
	const className = cn(
		"group/source flex h-8 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-muted-foreground transition-colors",
		"hover:bg-accent/50 hover:text-foreground",
	);

	if (source.kind === "file") {
		return (
			<HoverCard openDelay={150}>
				<HoverCardTrigger asChild>
					<button
						type="button"
						className={cn(className, "cursor-pointer")}
						title={source.filename || "Attached file"}
					>
						<Paperclip className="size-3.5 shrink-0" />
						<span className="min-w-0 flex-1 basis-0 truncate">
							{source.filename || "Attached file"}
						</span>
					</button>
				</HoverCardTrigger>
				<SummaryFilePreview file={source} />
			</HoverCard>
		);
	}

	if (source.kind === "url") {
		return (
			<a
				className={cn(className, "cursor-pointer")}
				href={source.href}
				rel="noreferrer"
				target="_blank"
				title={source.title}
			>
				<FileText className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
			</a>
		);
	}

	return (
		<div className={className} title={source.title}>
			<FileText className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
		</div>
	);
}

function SummaryFilePreview({ file }: { file: ChatSummaryArtifact }) {
	return (
		<HoverCardContent
			align="start"
			side="left"
			className={
				file.mediaType.startsWith("image/")
					? "w-auto max-w-80 border-0 bg-transparent p-0 shadow-none ring-0"
					: "w-64"
			}
		>
			{file.mediaType.startsWith("image/") ? (
				<img
					src={file.url}
					alt={file.filename || "Attached image"}
					className="block max-h-80 max-w-80 rounded-lg object-contain shadow-md ring-1 ring-foreground/10"
				/>
			) : (
				<div className="flex h-28 items-center justify-center bg-muted/40 text-muted-foreground">
					<Paperclip className="size-6" />
				</div>
			)}
		</HoverCardContent>
	);
}

function SummaryAppRow({ app }: { app: ChatSummaryApp }) {
	return (
		<div
			className="flex h-8 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-muted-foreground"
			title={app.title}
		>
			<AppSourceIcon provider={app.provider} className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1 basis-0 truncate">{app.title}</span>
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
					"group/label flex h-8 w-full cursor-pointer items-center justify-start gap-1.5 rounded-lg px-3 text-xs font-medium text-sidebar-foreground/60 outline-hidden transition-colors",
					"hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
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
