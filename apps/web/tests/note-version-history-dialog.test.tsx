import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { NoteVersionHistoryDialog } from "../src/components/note/note-version-history-dialog";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { useMutationMock, useQueryMock } = vi.hoisted(() => ({
	useMutationMock: vi.fn(),
	useQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const noteId = "note-1" as Id<"notes">;
const revisionId = "revision-1" as Id<"noteRevisions">;
const currentCreatedAt = new Date("2026-04-10T18:00:00.000Z").getTime();
const revisionCreatedAt = new Date("2026-04-09T18:00:00.000Z").getTime();
const createDocument = (text: string) =>
	JSON.stringify({
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text }],
			},
		],
	});

describe("NoteVersionHistoryDialog", () => {
	beforeEach(() => {
		useMutationMock.mockReturnValue(vi.fn());
		useQueryMock.mockImplementation((reference: never, args: unknown) => {
			if (getFunctionName(reference) === "noteVersions:list") {
				return [
					{
						id: "current",
						isCurrent: true,
						authorName: "Murad",
						title: "Current note",
						createdAt: currentCreatedAt,
					},
					{
						id: revisionId,
						isCurrent: false,
						authorName: "Murad",
						title: "Historical note",
						createdAt: revisionCreatedAt,
					},
				];
			}

			if (
				getFunctionName(reference) === "noteVersions:get" &&
				args !== "skip"
			) {
				return {
					id: revisionId,
					isCurrent: false,
					authorName: "Murad",
					title: "Historical note",
					content: createDocument("Historical body"),
					searchableText: "Historical body",
					createdAt: revisionCreatedAt,
				};
			}

			return undefined;
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("lists metadata and fetches only the selected historical body", async () => {
		const user = userEvent.setup();
		render(
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<NoteVersionHistoryDialog
					initialVersion={{
						id: "current",
						isCurrent: true,
						authorName: "Murad",
						title: "Current note",
						content: createDocument("Current body"),
						searchableText: "Current body",
						createdAt: currentCreatedAt,
					}}
					noteId={noteId}
					open={true}
					onOpenChange={vi.fn()}
				/>
			</ActiveWorkspaceProvider>,
		);

		expect(await screen.findByText("Current body")).not.toBeNull();
		expect(
			useQueryMock.mock.calls.some(
				([reference, args]) =>
					getFunctionName(reference) === "noteVersions:get" && args !== "skip",
			),
		).toBe(false);

		const revisionLabel = new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date(revisionCreatedAt));
		const revisionItem = screen.getAllByText(revisionLabel)[0];
		if (!revisionItem) {
			throw new Error("Expected the historical version navigation item.");
		}
		await user.click(revisionItem);

		expect(await screen.findByText("Historical body")).not.toBeNull();
		await waitFor(() =>
			expect(
				useQueryMock.mock.calls.some(
					([reference, args]) =>
						getFunctionName(reference) === "noteVersions:get" &&
						args !== "skip" &&
						args.versionId === revisionId,
				),
			).toBe(true),
		);
	});
});
