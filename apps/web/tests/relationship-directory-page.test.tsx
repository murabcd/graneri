import { cleanup, render, screen } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PeopleDirectoryPage } from "../src/components/relationships/relationship-directory-page";

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
});
