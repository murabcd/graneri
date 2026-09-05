import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "convex/react";
import { Building2, Search, UsersRound } from "lucide-react";
import * as React from "react";
import { PageTitle } from "@/components/layout/page-title";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type DirectoryEntity = {
	key: string;
	label: string;
	subtitle: string;
};

type DirectoryKind = "companies" | "people";

type RelationshipDirectoryPageProps = {
	isDesktopMac: boolean;
	workspaceId: Id<"workspaces"> | null;
};

export function PeopleDirectoryPage(props: RelationshipDirectoryPageProps) {
	const [searchQuery, setSearchQuery] = React.useState("");
	const deferredSearchQuery = React.useDeferredValue(searchQuery);
	const result = useQuery(
		api.people.listDirectory,
		props.workspaceId
			? { query: deferredSearchQuery, workspaceId: props.workspaceId }
			: "skip",
	);
	const currentResult = useRetainedDirectoryResult(result, props.workspaceId);
	const entities = currentResult?.people.map((person) => ({
		key: person.email,
		label: person.displayName?.trim() || person.email,
		subtitle: person.email,
	}));

	return (
		<RelationshipDirectoryPage
			{...props}
			emptyDescription="People from your calendar-linked notes will appear here."
			emptySearchDescription="Try another name or email."
			entities={entities}
			hasMore={currentResult?.hasMore ?? false}
			heading="People you meet"
			icon="people"
			searchPlaceholder="Search people..."
			searchQuery={searchQuery}
			onSearchQueryChange={setSearchQuery}
			title="People"
		/>
	);
}

export function CompaniesDirectoryPage(props: RelationshipDirectoryPageProps) {
	const [searchQuery, setSearchQuery] = React.useState("");
	const deferredSearchQuery = React.useDeferredValue(searchQuery);
	const result = useQuery(
		api.companies.listDirectory,
		props.workspaceId
			? { query: deferredSearchQuery, workspaceId: props.workspaceId }
			: "skip",
	);
	const currentResult = useRetainedDirectoryResult(result, props.workspaceId);
	const entities = currentResult?.companies.map((company) => ({
		key: company.domain,
		label: company.displayName,
		subtitle: company.domain,
	}));

	return (
		<RelationshipDirectoryPage
			{...props}
			emptyDescription="Companies from business email domains in your calendar-linked notes will appear here."
			emptySearchDescription="Try another company name or domain."
			entities={entities}
			hasMore={currentResult?.hasMore ?? false}
			heading="Companies you work with"
			icon="companies"
			searchPlaceholder="Search companies..."
			searchQuery={searchQuery}
			onSearchQueryChange={setSearchQuery}
			title="Companies"
		/>
	);
}

function RelationshipDirectoryPage({
	emptyDescription,
	emptySearchDescription,
	entities,
	hasMore,
	heading,
	icon,
	isDesktopMac,
	onSearchQueryChange,
	searchPlaceholder,
	searchQuery,
	title,
}: RelationshipDirectoryPageProps & {
	emptyDescription: string;
	emptySearchDescription: string;
	entities: DirectoryEntity[] | undefined;
	hasMore: boolean;
	heading: string;
	icon: DirectoryKind;
	onSearchQueryChange: (query: string) => void;
	searchPlaceholder: string;
	searchQuery: string;
	title: string;
}) {
	const isSearching = searchQuery.trim().length > 0;
	const searchInputId = React.useId();

	return (
		<div
			data-desktop-nonselectable
			className="box-border flex min-h-0 w-full max-w-full min-w-0 flex-1 justify-center px-4 pb-6 md:px-6"
		>
			<section
				className={cn(
					"flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6 md:max-w-xl",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<PageTitle isDesktopMac={isDesktopMac}>{heading}</PageTitle>
				<label className="relative block" htmlFor={searchInputId}>
					<span className="sr-only">{searchPlaceholder}</span>
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label={searchPlaceholder}
						className="h-9 pl-9"
						id={searchInputId}
						placeholder={searchPlaceholder}
						value={searchQuery}
						onChange={(event) => onSearchQueryChange(event.target.value)}
					/>
				</label>

				<div
					data-directory-surface
					className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm"
				>
					<div className="shrink-0 border-b border-border bg-muted/60 px-4 py-2 text-sm font-normal">
						{icon === "people" ? "Person" : "Company"}
					</div>
					<DirectoryBody
						emptyDescription={emptyDescription}
						emptySearchDescription={emptySearchDescription}
						entities={entities}
						icon={icon}
						isSearching={isSearching}
						title={title}
					/>
				</div>
				{hasMore ? (
					<p className="text-center text-xs text-muted-foreground">
						Refine your search to see more results.
					</p>
				) : null}
			</section>
		</div>
	);
}

function useRetainedDirectoryResult<Result>(
	result: Result | undefined,
	workspaceId: Id<"workspaces"> | null,
) {
	const resolvedSnapshotRef = React.useRef<{
		result: Result;
		workspaceId: Id<"workspaces">;
	} | null>(null);

	React.useLayoutEffect(() => {
		if (workspaceId && result !== undefined) {
			resolvedSnapshotRef.current = { result, workspaceId };
		}
	}, [result, workspaceId]);

	return result !== undefined
		? result
		: resolvedSnapshotRef.current?.workspaceId === workspaceId
			? resolvedSnapshotRef.current.result
			: undefined;
}

function DirectoryBody({
	emptyDescription,
	emptySearchDescription,
	entities,
	icon,
	isSearching,
	title,
}: {
	emptyDescription: string;
	emptySearchDescription: string;
	entities: DirectoryEntity[] | undefined;
	icon: DirectoryKind;
	isSearching: boolean;
	title: string;
}) {
	if (!entities) {
		return null;
	}

	if (entities.length > 0) {
		return (
			<div
				data-directory-scroll-viewport
				className="scroll-fade-b min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain"
			>
				{entities.map((entity) => (
					<DirectoryRow entity={entity} key={entity.key} />
				))}
			</div>
		);
	}

	return (
		<DirectoryEmptyState
			description={isSearching ? emptySearchDescription : emptyDescription}
			icon={icon}
			title={`No ${title.toLowerCase()} ${isSearching ? "found" : "yet"}`}
		/>
	);
}

function DirectoryEmptyState({
	description,
	icon,
	title,
}: {
	description: string;
	icon: DirectoryKind;
	title: string;
}) {
	const Icon = icon === "people" ? UsersRound : Building2;

	return (
		<Empty className="min-h-56 flex-1 rounded-none border-0">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon className="size-4" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function DirectoryRow({ entity }: { entity: DirectoryEntity }) {
	return (
		<div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
			<Avatar>
				<AvatarFallback>{getInitials(entity.label)}</AvatarFallback>
			</Avatar>
			<div className="min-w-0">
				<p className="truncate text-sm font-normal text-foreground">
					{entity.label}
				</p>
				<p className="truncate text-xs text-muted-foreground">
					{entity.subtitle}
				</p>
			</div>
		</div>
	);
}

function getInitials(value: string) {
	const words = value
		.split(/\s+/u)
		.map((word) => word.trim())
		.filter(Boolean);
	const initials = words
		.slice(0, 2)
		.map((word) => word[0])
		.join("")
		.toUpperCase();

	return initials || "?";
}
