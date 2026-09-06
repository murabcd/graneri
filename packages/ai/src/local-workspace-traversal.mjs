import { createHash } from "node:crypto";
import { opendir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const MAX_PAGE_ENTRIES = 1_000;
const MAX_DIRECTORY_DEPTH = 64;
const MAX_DIRECTORY_ENTRIES = 50_000;
const MAX_CURSOR_LENGTH = 65_536;
const ignoredDirectories = new Set([
	".cache",
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
]);
const traversalCursorSchema = z.strictObject({
	context: z.string(),
	stack: z
		.array(
			z.strictObject({
				path: z.string().max(4_096),
				offset: z.number().int().nonnegative(),
				modifiedAt: z.string(),
			}),
		)
		.max(MAX_DIRECTORY_DEPTH),
});

const isVisibleEntry = (entry) =>
	(!entry.name.startsWith(".") || entry.name === ".env.example") &&
	!(entry.isDirectory() && ignoredDirectories.has(entry.name));

export const createLocalWorkspaceTraversal = async ({
	cursor,
	context,
	relativePath,
	resolveDirectory,
	recursive,
}) => {
	const contextKey = createHash("sha256")
		.update(JSON.stringify(context))
		.digest("hex");
	const loadDirectory = async (path) => {
		const directoryPath = await resolveDirectory(path);
		const metadata = await stat(directoryPath, { bigint: true });
		if (!metadata.isDirectory())
			throw new Error("Search path is not a directory.");
		const entries = [];
		for await (const entry of await opendir(directoryPath)) {
			if (entries.length >= MAX_DIRECTORY_ENTRIES) {
				throw new Error(
					"Local directory exceeds the discovery entry limit. Search a narrower folder.",
				);
			}
			entries.push(entry);
		}
		if (
			metadata.mtimeNs !== (await stat(directoryPath, { bigint: true })).mtimeNs
		) {
			throw new Error("Local folder changed while paging. Restart the search.");
		}
		entries.sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		);
		return { entries, modifiedAt: String(metadata.mtimeNs) };
	};
	let positions;
	if (cursor) {
		const parsed = traversalCursorSchema.parse(
			JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
		);
		if (parsed.context !== contextKey || parsed.stack.length === 0) {
			throw new Error(
				"Local discovery cursor does not match this request. Restart the search.",
			);
		}
		positions = parsed.stack;
	} else {
		positions = [];
	}
	const stack = [];
	if (positions.length === 0) {
		stack.push({
			path: relativePath,
			offset: 0,
			...(await loadDirectory(relativePath)),
		});
	} else {
		for (const position of positions) {
			const directory = await loadDirectory(position.path);
			if (
				position.modifiedAt !== directory.modifiedAt ||
				position.offset > directory.entries.length
			) {
				throw new Error(
					"Local folder changed while paging. Restart the search.",
				);
			}
			stack.push({ ...position, ...directory });
		}
	}
	let visitedEntries = 0;
	let excludedEntries = 0;
	const next = async () => {
		while (stack.length > 0 && visitedEntries < MAX_PAGE_ENTRIES) {
			const frame = stack[stack.length - 1];
			const entry = frame.entries[frame.offset];
			if (!entry) {
				stack.pop();
				continue;
			}
			frame.offset += 1;
			visitedEntries += 1;
			if (!isVisibleEntry(entry) || entry.isSymbolicLink()) {
				excludedEntries += 1;
				continue;
			}
			const path = join(frame.path, entry.name);
			if (recursive && entry.isDirectory()) {
				if (stack.length >= MAX_DIRECTORY_DEPTH) {
					throw new Error(
						"Local folder exceeds the discovery depth limit. Search a narrower folder.",
					);
				}
				const nested = await loadDirectory(path);
				stack.push({ path, offset: 0, ...nested });
				continue;
			}
			return { entry, path };
		}
		return null;
	};
	return {
		next,
		page: () => {
			while (stack.length > 0) {
				const frame = stack[stack.length - 1];
				if (frame.offset < frame.entries.length) break;
				stack.pop();
			}
			const nextCursor =
				stack.length === 0
					? null
					: Buffer.from(
							JSON.stringify({
								context: contextKey,
								stack: stack.map(({ path, offset, modifiedAt }) => ({
									path,
									offset,
									modifiedAt,
								})),
							}),
						).toString("base64url");
			if (nextCursor && nextCursor.length > MAX_CURSOR_LENGTH) {
				throw new Error(
					"Local discovery cursor exceeds its path budget. Search a narrower folder.",
				);
			}
			return {
				nextCursor,
				visitedEntries,
				excludedEntries,
			};
		},
	};
};
