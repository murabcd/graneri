import type { OptimisticLocalStore } from "convex/browser";
import {
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType,
	getFunctionName,
	type OptionalRestArgs,
} from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	archiveNoteChats,
	removeNoteChats,
	restoreNoteChats,
} from "../src/lib/optimistic-note-chats";

class FakeOptimisticLocalStore implements OptimisticLocalStore {
	private readonly queryIds = new WeakMap<FunctionReference<"query">, number>();
	private readonly values = new Map<string, unknown>();
	private nextQueryId = 0;

	private getStoreKey<Query extends FunctionReference<"query">>(
		query: Query,
		args: FunctionArgs<Query> | undefined,
	) {
		const functionName = getFunctionName(query);

		if (functionName) {
			return `${functionName}:${JSON.stringify(args)}`;
		}

		let queryId = this.queryIds.get(query);

		if (queryId === undefined) {
			queryId = this.nextQueryId;
			this.nextQueryId += 1;
			this.queryIds.set(query, queryId);
		}

		return `${queryId}:${JSON.stringify(args)}`;
	}

	seed<Query extends FunctionReference<"query">>(
		query: Query,
		args: FunctionArgs<Query>,
		value: FunctionReturnType<Query>,
	) {
		this.values.set(this.getStoreKey(query, args), value);
	}

	getQuery<Query extends FunctionReference<"query">>(
		query: Query,
		...args: OptionalRestArgs<Query>
	) {
		return this.values.get(this.getStoreKey(query, args[0])) as
			| FunctionReturnType<Query>
			| undefined;
	}

	getAllQueries<Query extends FunctionReference<"query">>(query: Query) {
		void query;
		return [];
	}

	setQuery<Query extends FunctionReference<"query">>(
		query: Query,
		args: FunctionArgs<Query>,
		value: FunctionReturnType<Query> | undefined,
	) {
		this.values.set(this.getStoreKey(query, args), value);
	}
}

const workspaceId = "workspace-1" as Doc<"chats">["workspaceId"];
const noteId = "note-1" as Doc<"chats">["noteId"] & string;

const makeChat = (
	overrides: Partial<Doc<"chats">> & Pick<Doc<"chats">, "_id" | "chatId">,
): Doc<"chats"> => ({
	_id: overrides._id,
	_creationTime: 1,
	ownerTokenIdentifier: "owner-1",
	workspaceId,
	authorName: "Murad",
	chatId: overrides.chatId,
	noteId,
	title: "Chat",
	preview: "Preview",
	model: undefined,
	isArchived: false,
	archivedAt: undefined,
	createdAt: 1,
	updatedAt: 1,
	lastMessageAt: 1,
	...overrides,
});

describe("optimistic-note-chats", () => {
	it("archives note-linked chats across active and note-specific caches", () => {
		const store = new FakeOptimisticLocalStore();
		const linkedChat = makeChat({
			_id: "chat-doc-1" as never,
			chatId: "chat-1",
		});
		const otherChat = makeChat({
			_id: "chat-doc-2" as never,
			chatId: "chat-2",
			noteId: "note-2" as never,
		});

		store.seed(api.chats.list, { workspaceId }, [linkedChat, otherChat]);
		store.seed(api.chats.listArchived, { workspaceId }, []);
		store.seed(api.chats.listForNote, { workspaceId, noteId }, [linkedChat]);
		store.seed(
			api.chats.getSession,
			{ workspaceId, chatId: "chat-1" },
			linkedChat,
		);

		archiveNoteChats(store, workspaceId, noteId as never);

		expect(store.getQuery(api.chats.list, { workspaceId })).toEqual([
			otherChat,
		]);
		expect(
			store.getQuery(api.chats.listForNote, { workspaceId, noteId }),
		).toEqual([]);
		expect(
			(
				store.getQuery(api.chats.listArchived, {
					workspaceId,
				}) as Doc<"chats">[]
			)[0]?.chatId,
		).toBe("chat-1");
		expect(
			store.getQuery(api.chats.getSession, { workspaceId, chatId: "chat-1" }),
		).toBeNull();
	});

	it("restores note-linked chats back into active and note-specific caches", () => {
		const store = new FakeOptimisticLocalStore();
		const archivedChat = makeChat({
			_id: "chat-doc-1" as never,
			chatId: "chat-1",
			isArchived: true,
			archivedAt: 10,
		});

		store.seed(api.chats.list, { workspaceId }, []);
		store.seed(api.chats.listArchived, { workspaceId }, [archivedChat]);
		store.seed(api.chats.listForNote, { workspaceId, noteId }, []);
		store.seed(api.chats.getSession, { workspaceId, chatId: "chat-1" }, null);

		restoreNoteChats(store, workspaceId, noteId as never);

		expect(
			(store.getQuery(api.chats.list, { workspaceId }) as Doc<"chats">[])[0]
				?.chatId,
		).toBe("chat-1");
		expect(store.getQuery(api.chats.listArchived, { workspaceId })).toEqual([]);
		expect(
			(
				store.getQuery(api.chats.listForNote, {
					workspaceId,
					noteId,
				}) as Doc<"chats">[]
			)[0]?.chatId,
		).toBe("chat-1");
		expect(
			(
				store.getQuery(api.chats.getSession, {
					workspaceId,
					chatId: "chat-1",
				}) as Doc<"chats"> | null
			)?.isArchived,
		).toBe(false);
	});

	it("removes note-linked chats from all cached surfaces", () => {
		const store = new FakeOptimisticLocalStore();
		const linkedChat = makeChat({
			_id: "chat-doc-1" as never,
			chatId: "chat-1",
			isArchived: true,
			archivedAt: 10,
		});

		store.seed(api.chats.list, { workspaceId }, [linkedChat]);
		store.seed(api.chats.listArchived, { workspaceId }, [linkedChat]);
		store.seed(api.chats.listForNote, { workspaceId, noteId }, [linkedChat]);
		store.seed(
			api.chats.getSession,
			{ workspaceId, chatId: "chat-1" },
			linkedChat,
		);

		removeNoteChats(store, workspaceId, noteId as never);

		expect(store.getQuery(api.chats.list, { workspaceId })).toEqual([]);
		expect(store.getQuery(api.chats.listArchived, { workspaceId })).toEqual([]);
		expect(
			store.getQuery(api.chats.listForNote, { workspaceId, noteId }),
		).toEqual([]);
		expect(
			store.getQuery(api.chats.getSession, { workspaceId, chatId: "chat-1" }),
		).toBeNull();
	});
});
