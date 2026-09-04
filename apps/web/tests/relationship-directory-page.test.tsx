import { cleanup, render, screen } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	CompaniesDirectoryPage,
	PeopleDirectoryPage,
} from "../src/components/relationships/relationship-directory-page";

const { useQueryMock } = vi.hoisted(() => ({
	useQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useQuery: useQueryMock,
}));

type PeopleDirectoryResult = FunctionReturnType<
	typeof api.people.listDirectory
>;

const primaryWorkspaceId = "workspace-1" as Id<"workspaces">;
const resolvedResult: PeopleDirectoryResult = {
	hasMore: false,
	people: [
		{
			displayName: "Alice Example",
			email: "alice@example.com",
		},
	],
};

describe("PeopleDirectoryPage", () => {
	let peopleResult: PeopleDirectoryResult | undefined;

	beforeEach(() => {
		peopleResult = resolvedResult;
		useQueryMock.mockImplementation(() => peopleResult);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the last resolved workspace results while a query refreshes", async () => {
		const view = render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(await screen.findByText("Alice Example")).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "People you meet" }),
		).not.toBeNull();
		const directorySurface = screen.getByText("Person").parentElement;
		expect(directorySurface?.hasAttribute("data-directory-surface")).toBe(true);
		expect(directorySurface?.className).toContain("rounded-xl");
		expect(directorySurface?.className).toContain("shadow-sm");
		expect(directorySurface?.className).toContain("min-h-0");
		expect(directorySurface?.className).toContain("flex-1");
		const directoryViewport = directorySurface?.querySelector(
			"[data-directory-scroll-viewport]",
		);
		expect(directoryViewport?.className).toContain("overflow-y-auto");
		expect(directoryViewport?.className).toContain("overscroll-contain");
		expect(screen.getByText("Alice Example").className).toContain(
			"font-normal",
		);
		expect(screen.getByText("Alice Example").className).not.toContain(
			"font-medium",
		);

		peopleResult = undefined;
		view.rerender(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);

		expect(screen.getByText("Alice Example")).not.toBeNull();
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
	});

	it("does not reuse retained results after the workspace changes", async () => {
		const view = render(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);
		expect(await screen.findByText("Alice Example")).not.toBeNull();

		peopleResult = undefined;
		view.rerender(
			<PeopleDirectoryPage
				isDesktopMac={false}
				workspaceId={"workspace-2" as Id<"workspaces">}
			/>,
		);

		expect(screen.queryByText("Alice Example")).toBeNull();
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
	});

	it("uses the same calendar-style surface for companies", async () => {
		useQueryMock.mockReturnValue({
			companies: [
				{
					displayName: "Acme",
					domain: "acme.example",
				},
			],
			hasMore: false,
		});

		render(
			<CompaniesDirectoryPage
				isDesktopMac={false}
				workspaceId={primaryWorkspaceId}
			/>,
		);

		const directorySurface = screen.getByText("Company").parentElement;
		expect(directorySurface?.hasAttribute("data-directory-surface")).toBe(true);
		expect(directorySurface?.className).toContain("rounded-xl");
		expect(directorySurface?.className).toContain("shadow-sm");
		expect(
			directorySurface?.querySelector("[data-directory-scroll-viewport]")
				?.className,
		).toContain("overflow-y-auto");
		expect(screen.getByText("Acme").className).toContain("font-normal");
		expect(screen.getByText("A").dataset.slot).toBe("avatar-fallback");
		expect(directorySurface?.querySelector("svg.lucide-building-2")).toBeNull();
	});
});
