import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as hostedTurn from "../src/hosted-chat-turn.mjs";

type PackageExport = {
	types: string;
	import: string;
};

type PackageManifest = {
	exports: Record<string, PackageExport>;
};

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const consumerDirectories = ["api", "apps", "convex", "packages", "scripts"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
	".package-app",
	"coverage",
	"dist",
	"dist-app",
	"dist-electron",
	"node_modules",
]);

async function collectSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (ignoredDirectories.has(entry.name)) {
					return [];
				}
				return collectSourceFiles(path);
			}
			return sourceExtensions.has(extname(entry.name)) ? [path] : [];
		}),
	);
	return files.flat();
}

async function readManifest(): Promise<PackageManifest> {
	const contents = await readFile(
		join(packageDirectory, "package.json"),
		"utf8",
	);
	return JSON.parse(contents) as PackageManifest;
}

describe("AI package boundary", () => {
	it("exposes only explicit modules backed by runtime and type files", async () => {
		const manifest = await readManifest();

		expect(manifest.exports["./*"]).toBeUndefined();
		for (const [subpath, packageExport] of Object.entries(manifest.exports)) {
			expect(subpath).toMatch(/^\.\/[a-z0-9-]+$/);
			await expect(
				readFile(resolve(packageDirectory, packageExport.import)),
			).resolves.toBeDefined();
			await expect(
				readFile(resolve(packageDirectory, packageExport.types)),
			).resolves.toBeDefined();
		}
	});

	it("keeps consumers behind declared workspace exports", async () => {
		const manifest = await readManifest();
		const sourceFiles = (
			await Promise.all(
				consumerDirectories.map((directory) =>
					collectSourceFiles(join(repositoryDirectory, directory)),
				),
			)
		).flat();
		const undeclaredImports = new Set<string>();
		const consumedExports = new Set<string>();
		const deepImports: string[] = [];

		for (const sourceFile of sourceFiles) {
			if (sourceFile.startsWith(packageDirectory)) {
				continue;
			}
			const contents = await readFile(sourceFile, "utf8");
			if (contents.includes("packages/ai/src")) {
				deepImports.push(sourceFile);
			}
			for (const match of contents.matchAll(/@workspace\/ai\/([a-z0-9-]+)/g)) {
				const subpath = `./${match[1]}`;
				consumedExports.add(subpath);
				if (!(subpath in manifest.exports)) {
					undeclaredImports.add(subpath);
				}
			}
		}

		expect(deepImports).toEqual([]);
		expect([...undeclaredImports]).toEqual([]);
		expect([...consumedExports].sort()).toEqual(
			Object.keys(manifest.exports).sort(),
		);
	});

	it("exposes hosted chat orchestration through one public turn interface", async () => {
		const manifest = await readManifest();
		const hostedChatExports = Object.keys(manifest.exports).filter((subpath) =>
			subpath.startsWith("./hosted-chat-"),
		);

		expect(hostedChatExports.sort()).toEqual([
			"./hosted-chat-http",
			"./hosted-chat-runtime",
			"./hosted-chat-turn",
		]);
	});

	it("keeps the hosted turn interface intention-level", () => {
		expect(Object.keys(hostedTurn).sort()).toEqual([
			"createHostedActiveStreamKey",
			"createHostedAssistantRunFinalizer",
			"createHostedChatRunResponseStream",
			"createHostedChatTurnInput",
			"isHostedQueuedUserMessageAccept",
			"persistHostedChatUserMessage",
			"prepareHostedAssistantExecution",
			"prepareHostedChatContextWindow",
			"prepareHostedChatTurn",
			"startHostedAssistantExecution",
			"startHostedChatRun",
			"stopOrphanedHostedAssistantRun",
		]);
		expect(hostedTurn).not.toHaveProperty("buildHostedChatRunContext");
		expect(hostedTurn).not.toHaveProperty("prepareHostedChatTurnBranch");
		expect(hostedTurn).not.toHaveProperty("createHostedChatQueuedInput");
		expect(hostedTurn).not.toHaveProperty("createHostedChatTurnController");
	});
});
