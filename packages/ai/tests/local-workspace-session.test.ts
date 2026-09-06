import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalWorkspaceSession } from "../src/local-workspace-session.mjs";

const createSession = async (directory: string) => {
	const rootPath = await realpath(directory);
	return createLocalWorkspaceSession([
		{ name: basename(rootPath), path: rootPath },
	]);
};

describe("local workspace session", () => {
	it("owns visibility, traversal, media detection, and read limits", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-workspace-"));
		try {
			await writeFile(join(directory, "meeting.txt"), "roadmap decision\n");
			await writeFile(join(directory, ".env.example"), "EXAMPLE=true\n");
			await writeFile(join(directory, ".private"), "roadmap secret\n");
			await mkdir(join(directory, "node_modules"));
			await writeFile(
				join(directory, "node_modules", "ignored.txt"),
				"roadmap dependency\n",
			);
			await writeFile(
				join(directory, "screen.png"),
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
			);
			const session = await createSession(directory);

			await expect(
				session.listDirectory({ rootIndex: 0 }),
			).resolves.toMatchObject({
				entries: expect.arrayContaining([
					{ name: ".env.example", type: "file" },
					{ name: "meeting.txt", type: "file" },
				]),
				path: ".",
			});
			const fileSearch = await session.searchFiles({
				query: "roadmap",
				rootIndex: 0,
			});
			expect(fileSearch.matches.map((match) => match.path)).toEqual([
				"meeting.txt",
			]);
			expect(fileSearch.kind).toBe("text-search");
			await expect(
				session.readFile({
					lengthBytes: 7,
					offsetBytes: 0,
					relativePath: "meeting.txt",
					rootIndex: 0,
				}),
			).resolves.toMatchObject({ content: "roadmap", truncated: true });

			const imageSearch = await session.searchImages({
				maxResults: 1,
				query: "screen",
				rootIndex: 0,
			});
			expect(imageSearch.results).toHaveLength(1);
			expect(imageSearch.results[0]).toMatchObject({
				filename: "screen.png",
				mediaType: "image/png",
				path: "screen.png",
			});
			expect(imageSearch.results[0].bytes).toBeInstanceOf(Uint8Array);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("continues image inspection beyond the per-call upload limit", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-workspace-"));
		try {
			const image = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
			]);
			await Promise.all(
				Array.from({ length: 11 }, (_, index) =>
					writeFile(join(directory, `screenshot-${index}.png`), image),
				),
			);
			const session = await createSession(directory);

			const result = await session.searchImages({
				maxResults: 100,
				query: "screenshot",
				rootIndex: 0,
			});
			expect(result.results).toHaveLength(10);
			expect(result.nextCursor).toEqual(expect.any(String));
			const next = await session.searchImages({
				cursor: result.nextCursor,
				maxResults: 10,
				query: "screenshot",
				rootIndex: 0,
			});
			expect(next.results).toHaveLength(1);
			expect(next.nextCursor).toBeNull();
			expect(
				new Set([...result.results, ...next.results].map((image) => image.path))
					.size,
			).toBe(11);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("pages directory entries without duplicates and rejects stale or mismatched cursors", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-workspace-pages-"));
		try {
			await Promise.all(
				Array.from({ length: 215 }, (_, index) =>
					writeFile(join(directory, `entry-${index}.txt`), "entry"),
				),
			);
			const session = await createSession(directory);
			const first = await session.listDirectory({ rootIndex: 0 });
			const second = await session.listDirectory({
				rootIndex: 0,
				cursor: first.nextCursor,
			});
			expect(first.entries).toHaveLength(200);
			expect(second.entries).toHaveLength(15);
			expect(second.nextCursor).toBeNull();
			expect(
				new Set(
					[...first.entries, ...second.entries].map((entry) => entry.name),
				).size,
			).toBe(215);
			await expect(
				session.searchFiles({
					rootIndex: 0,
					query: "entry",
					cursor: first.nextCursor,
				}),
			).rejects.toThrow("does not match");
			await writeFile(join(directory, "new.txt"), "changed");
			await expect(
				session.listDirectory({ rootIndex: 0, cursor: first.nextCursor }),
			).rejects.toThrow("changed while paging");
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("resumes recursive search beyond the traversal budget without rereading earlier subtrees", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "graneri-workspace-recursive-"),
		);
		try {
			await mkdir(join(directory, "nested"));
			await Promise.all(
				Array.from({ length: 1_005 }, (_, index) =>
					writeFile(
						join(directory, "nested", `${String(index).padStart(4, "0")}.txt`),
						index === 1_004 ? "last needle" : "ordinary",
					),
				),
			);
			const session = await createSession(directory);
			const first = await session.searchFiles({
				rootIndex: 0,
				query: "needle",
			});
			expect(first.matches).toHaveLength(0);
			expect(first.nextCursor).toEqual(expect.any(String));
			const second = await session.searchFiles({
				rootIndex: 0,
				query: "needle",
				cursor: first.nextCursor,
			});
			expect(second.matches.map((match) => match.path)).toEqual([
				"nested/1004.txt",
			]);
			expect(second.nextCursor).toBeNull();
			expect(second.contentBytesRead).toBeLessThan(100);
			await expect(
				session.searchFiles({
					rootIndex: 0,
					query: "other",
					cursor: first.nextCursor,
				}),
			).rejects.toThrow("does not match");
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("finds text beyond 250 KB and reports every unsearched file instead of false completeness", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "graneri-workspace-coverage-"),
		);
		try {
			await writeFile(
				join(directory, "large.txt"),
				`${"x".repeat(250_001)}\nneedle\n`,
			);
			await writeFile(join(directory, "oversized.txt"), "text".repeat(2_048));
			await truncate(join(directory, "oversized.txt"), 20_000_001);
			await writeFile(join(directory, "document.pdf"), "%PDF-1.7\n");
			await writeFile(join(directory, ".private"), "needle");
			const result = await (await createSession(directory)).searchFiles({
				rootIndex: 0,
				query: "needle",
			});
			expect(result.matches).toMatchObject([
				{ path: "large.txt", matches: [{ line: 2, text: "needle" }] },
			]);
			expect(result.skippedFiles).toEqual([
				{ path: "document.pdf", reason: "non_text" },
				{ path: "oversized.txt", reason: "size_limit" },
			]);
			expect(result.excludedEntries).toBe(1);
			expect(result.nextCursor).toBeNull();
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("rejects paths that resolve through a symlink outside the shared root", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-workspace-"));
		const outsideDirectory = await mkdtemp(
			join(tmpdir(), "graneri-workspace-outside-"),
		);
		try {
			await writeFile(join(outsideDirectory, "secret.txt"), "outside secret");
			await symlink(
				join(outsideDirectory, "secret.txt"),
				join(directory, "escape"),
			);
			const session = await createSession(directory);

			await expect(
				session.readFile({
					lengthBytes: 100,
					offsetBytes: 0,
					relativePath: "escape",
					rootIndex: 0,
				}),
			).rejects.toThrow("outside the shared folder");
		} finally {
			await rm(directory, { force: true, recursive: true });
			await rm(outsideDirectory, { force: true, recursive: true });
		}
	});
});
