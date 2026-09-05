import { cleanup, render, screen } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import { Suspense } from "react";
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

const pendingRender = new Promise<never>(() => {});

function SuspendRender({ suspend }: { suspend: boolean }) {
	if (suspend) {
		throw pendingRender;
	}
	return null;
}

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
		expect(screen.getByText("Alice Example")).not.toBeNull();

		peopleResult = {
			hasMore: false,
			people: [{ displayName: "Bob Example", email: "bob@example.com" }],
		};
		view.rerender(directory(true));
		expect(screen.getByText("Loading")).not.toBeNull();

		peopleResult = undefined;
		view.rerender(directory(false));
		expect(screen.getByText("Alice Example")).not.toBeNull();
		expect(screen.queryByText("Bob Example")).toBeNull();
	});
});
