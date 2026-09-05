import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UsePaginatedQueryResult } from "convex/react";
import { getFunctionName } from "convex/server";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { DirectoryEntry } from "../../../convex/relationshipDirectoryModel";
import {
	CompaniesDirectoryPage,
	PeopleDirectoryPage,
} from "../src/components/relationships/relationship-directory-page";

const { usePaginatedQueryMock, loadPrimaryMore, loadDerivedMore } = vi.hoisted(
	() => ({
		usePaginatedQueryMock: vi.fn(),
		loadPrimaryMore: vi.fn(),
		loadDerivedMore: vi.fn(),
	}),
);
vi.mock("convex/react", () => ({ usePaginatedQuery: usePaginatedQueryMock }));

const primaryWorkspaceId = "workspace-1" as Id<"workspaces">;
const alice: DirectoryEntry = {
	key: "alice@example.com",
	label: "Alice Example",
	subtitle: "alice@example.com",
};
const pendingRender = new Promise<never>(() => {});
function SuspendRender({ suspend }: { suspend: boolean }) {
	if (suspend) throw pendingRender;
	return null;
}

describe("relationship directories", () => {
	let primary: UsePaginatedQueryResult<DirectoryEntry>;
	let derived: UsePaginatedQueryResult<DirectoryEntry>;
	beforeEach(() => {
		primary = {
			results: [alice],
			status: "Exhausted",
			isLoading: false,
			loadMore: loadPrimaryMore,
		};
		derived = {
			results: [],
			status: "Exhausted",
			isLoading: false,
			loadMore: loadDerivedMore,
		};
		usePaginatedQueryMock.mockImplementation((reference, args) => {
			if (args === "skip")
				return {
					results: [],
					status: "LoadingFirstPage",
					isLoading: true,
					loadMore: loadDerivedMore,
				};
			return getFunctionName(reference) ===
				"relationshipDirectory:listCompaniesFromPeople"
				? derived
				: primary;
		});
	});
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the last resolved workspace results while a query refreshes", () => {
		const view = render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(screen.getByText("Alice Example")).not.toBeNull();
		primary = {
			results: [],
			status: "LoadingFirstPage",
			isLoading: true,
			loadMore: loadPrimaryMore,
		};
		view.rerender(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(screen.getByText("Alice Example")).not.toBeNull();
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
	});

	it("does not reuse retained results after the workspace changes", () => {
		const view = render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		primary = {
			results: [],
			status: "LoadingFirstPage",
			isLoading: true,
			loadMore: loadPrimaryMore,
		};
		view.rerender(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={"workspace-2" as Id<"workspaces">}
			/>,
		);
		expect(screen.queryByText("Alice Example")).toBeNull();
		expect(screen.queryByText("No people yet")).toBeNull();
	});

	it("retains only committed results when a render suspends", () => {
		const directory = (suspend: boolean) => (
			<Suspense fallback={<p>Loading</p>}>
				<PeopleDirectoryPage
					isDesktopMac={false}
					workspaceId={primaryWorkspaceId}
				/>
				<SuspendRender suspend={suspend} />
			</Suspense>
		);
		const view = render(directory(false));
		primary = {
			...primary,
			results: [
				{
					key: "bob@example.com",
					label: "Bob Example",
					subtitle: "bob@example.com",
				},
			],
		};
		view.rerender(directory(true));
		expect(screen.getByText("Loading")).not.toBeNull();
		primary = {
			results: [],
			status: "LoadingFirstPage",
			isLoading: true,
			loadMore: loadPrimaryMore,
		};
		view.rerender(directory(false));
		expect(screen.getByText("Alice Example")).not.toBeNull();
		expect(screen.queryByText("Bob Example")).toBeNull();
	});

	it("continues through empty pages before declaring no people found", () => {
		primary = {
			results: [],
			status: "CanLoadMore",
			isLoading: false,
			loadMore: loadPrimaryMore,
		};
		const view = render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(loadPrimaryMore).toHaveBeenCalledWith(100);
		expect(screen.queryByText("No people yet")).toBeNull();
		expect(
			screen.queryByText("Refine your search to see more results."),
		).toBeNull();
		primary = {
			results: [alice],
			status: "Exhausted",
			isLoading: false,
			loadMore: loadPrimaryMore,
		};
		view.rerender(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(screen.getByText("Alice Example")).not.toBeNull();
		expect(
			screen.queryByText("Refine your search to see more results."),
		).toBeNull();
	});

	it("stops reading people once actual matching overflow is known", () => {
		primary = {
			results: Array.from({ length: 101 }, (_, index) => ({
				key: `p${index}@example.com`,
				label: `Person ${index}`,
				subtitle: `p${index}@example.com`,
			})),
			status: "CanLoadMore",
			isLoading: false,
			loadMore: loadPrimaryMore,
		};
		render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(loadPrimaryMore).not.toHaveBeenCalled();
		expect(screen.getByText("Person 99")).not.toBeNull();
		expect(screen.queryByText("Person 100")).toBeNull();
		expect(
			screen.getByText("Refine your search to see more results."),
		).not.toBeNull();
	});

	it("waits for both company sources and preserves canonical names and global ordering", () => {
		primary = {
			results: [
				{ key: "zulu.example", label: "Zulu", subtitle: "zulu.example" },
			],
			status: "Exhausted",
			isLoading: false,
			loadMore: loadPrimaryMore,
		};
		derived = {
			results: [],
			status: "CanLoadMore",
			isLoading: false,
			loadMore: loadDerivedMore,
		};
		const view = render(
			<CompaniesDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(loadDerivedMore).toHaveBeenCalledWith(100);
		expect(screen.queryByText("No companies yet")).toBeNull();
		derived = {
			results: [
				{ key: "alpha.example", label: "Alpha", subtitle: "alpha.example" },
				{ key: "alpha.example", label: "Alpha", subtitle: "alpha.example" },
				{
					key: "zulu.example",
					label: "Stale derived name",
					subtitle: "zulu.example",
				},
			],
			status: "Exhausted",
			isLoading: false,
			loadMore: loadDerivedMore,
		};
		view.rerender(
			<CompaniesDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(screen.queryByText("Stale derived name")).toBeNull();
		expect(screen.getAllByText("Alpha")).toHaveLength(1);
		const rows = document.querySelector("[data-directory-scroll-viewport]");
		expect(rows?.children[0]?.textContent).toContain("Alpha");
		expect(rows?.children[1]?.textContent).toContain("Zulu");
		expect(
			screen.queryByText("Refine your search to see more results."),
		).toBeNull();
	});

	it("starts a new search at the existing input without changing the directory surface", () => {
		render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		fireEvent.change(
			screen.getByRole("textbox", { name: "Search people..." }),
			{ target: { value: "alice" } },
		);
		expect(usePaginatedQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			{ workspaceId: primaryWorkspaceId, query: "alice" },
			{ initialNumItems: 100 },
		);
		expect(
			screen.getByRole("heading", { name: "People you meet" }),
		).not.toBeNull();
		expect(document.querySelector("[data-directory-surface]")).not.toBeNull();
	});
});
