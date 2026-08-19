import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
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
			await expect(
				session.readTextFile({
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

	it("caps image search inside the workspace boundary", async () => {
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
			expect(result).toMatchObject({
				totalImageCount: 11,
				truncated: true,
			});
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
				session.readTextFile({
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
