import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { desktopPackageContract } from "../scripts/desktop-package-contract.mjs";
import { verifyPackagedResources } from "../scripts/package-verification.mjs";

const configuration = {
	expectedDeployment: "release-fixture",
	expectedSiteUrl: "https://graneri.example",
	forbiddenDeployments: ["development-fixture"],
	forbiddenOpenAIApiKey: "test-server-secret",
};
const mainSource = `
const hostedRuntimeConfig = {
	convexUrl: "https://release-fixture.convex.cloud",
	siteUrl: "https://graneri.example",
};
headers["Content-Security-Policy"] = "script-src 'self'";
`;

function createArchive(
	t,
	{ files = {}, extraSource = "", unpacked = [] } = {},
) {
	const directory = mkdtempSync(join(tmpdir(), "graneri-package-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const archivePath = join(directory, "app.asar");
	const contents = {
		...Object.fromEntries(
			desktopPackageContract.packagedNodeModules.map((name) => [
				`node_modules/${name}/package.json`,
				"{}",
			]),
		),
		...Object.fromEntries(
			[
				...desktopPackageContract.runtimeTrace.requiredFiles,
				...desktopPackageContract.localRuntimeFiles,
			].map((path) => [path, ""]),
		),
		"dist-app/theme-init.js": "// theme initializer",
		[desktopPackageContract.mainEntry]: mainSource + extraSource,
		...files,
	};
	const header = { files: {} };
	const payload = [];
	let offset = 0;
	for (const [path, source] of Object.entries(contents)) {
		if (source === null) continue;
		const parts = path.split("/");
		const name = parts.pop();
		let directoryFiles = header.files;
		for (const part of parts) {
			directoryFiles[part] ??= { files: {} };
			directoryFiles = directoryFiles[part].files;
		}
		const data = Buffer.from(source);
		if (unpacked.includes(path)) {
			directoryFiles[name] = { size: data.length, unpacked: true };
			const target = join(`${archivePath}.unpacked`, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, data);
		} else {
			directoryFiles[name] = { size: data.length, offset: String(offset) };
			payload.push(data);
			offset += data.length;
		}
	}
	// ASAR starts with two Chromium Pickles: header size, then a JSON string.
	// String payloads are aligned to four bytes, followed by packed file bytes.
	const json = Buffer.from(JSON.stringify(header));
	const paddedLength = Math.ceil(json.length / 4) * 4;
	const prefix = Buffer.alloc(16 + paddedLength);
	prefix.writeUInt32LE(4, 0);
	prefix.writeUInt32LE(8 + paddedLength, 4);
	prefix.writeUInt32LE(4 + paddedLength, 8);
	prefix.writeUInt32LE(json.length, 12);
	json.copy(prefix, 16);
	writeFileSync(archivePath, Buffer.concat([prefix, ...payload]));
	return archivePath;
}

const verify = (packagedAppAsarPath) =>
	verifyPackagedResources({ ...configuration, packagedAppAsarPath });

test("accepts a complete archive and ignores deployment URLs outside configuration", (t) => {
	const archivePath = createArchive(t, {
		files: {
			"dist-app/docs.json": JSON.stringify({
				padding: " ".repeat(250),
				link: "https://documentation-example.convex.cloud",
				trailing: " ".repeat(250),
			}),
		},
	});
	assert.doesNotThrow(() => verify(archivePath));
});

test("requires the final archive even when staging output exists", (t) => {
	const archivePath = createArchive(t);
	const stagedPath = join(dirname(archivePath), ".package-app");
	mkdirSync(stagedPath);
	writeFileSync(join(stagedPath, "index.js"), mainSource);
	rmSync(archivePath);
	assert.throws(() => verify(archivePath), /ASAR is missing/);
});

test("reads configuration from the final unpacked mirror", (t) => {
	const archivePath = createArchive(t, {
		unpacked: [desktopPackageContract.mainEntry],
	});
	assert.doesNotThrow(() => verify(archivePath));
	writeFileSync(
		join(`${archivePath}.unpacked`, desktopPackageContract.mainEntry),
		mainSource.replace("release-fixture", "unexpected-fixture"),
	);
	assert.throws(() => verify(archivePath), /unexpected Convex deployment/);
});

test("rejects obsolete lifecycle code in the archive", (t) => {
	for (const marker of [
		"allowConcurrentRun",
		"allow_concurrent",
		"return_existing",
		"markAssistantRunRunning",
		"requeueClaimed",
		"queuedAssistantRun",
		"queued_assistant_run",
		'status:"discarded"',
	]) {
		const archivePath = createArchive(t, { extraSource: `\n${marker}` });
		assert.throws(
			() => verify(archivePath),
			/forbidden lifecycle fallback/,
			marker,
		);
	}
});

test("rejects missing security and runtime assets", (t) => {
	for (const [path, replacement, error] of [
		[
			desktopPackageContract.mainEntry,
			mainSource.replace("script-src 'self'", ""),
			/Content Security Policy/,
		],
		["dist-app/theme-init.js", null, /external theme initializer/],
		["node_modules/objc-js/package.json", null, /native dependency is missing/],
		[
			desktopPackageContract.runtimeTrace.requiredFiles[0],
			null,
			/asset-backed runtime file is missing/,
		],
	]) {
		const archivePath = createArchive(t, { files: { [path]: replacement } });
		assert.throws(() => verify(archivePath), error, path);
	}
});

test("rejects incorrect hosted configuration and embedded credentials", (t) => {
	for (const [source, error] of [
		[
			mainSource.replace("release-fixture", "unexpected-fixture"),
			/unexpected Convex deployment/,
		],
		[
			mainSource.replace("release-fixture", "development-fixture"),
			/forbidden Convex deployment/,
		],
		[
			mainSource.replace("https://release-fixture.convex.cloud", ""),
			/does not contain expected Convex deployment/,
		],
		[
			mainSource.replace("https://graneri.example", "https://other.example"),
			/does not contain expected hosted site URL/,
		],
		[`${mainSource}\ntest-server-secret`, /server-side OpenAI credential/],
		[`${mainSource}\nopenAIApiKey`, /forbidden OpenAI credential config/],
		[
			`${mainSource}\nGRANERI_HOSTED_OPENAI_API_KEY`,
			/forbidden OpenAI credential config/,
		],
	]) {
		const archivePath = createArchive(t, {
			files: { [desktopPackageContract.mainEntry]: source },
		});
		assert.throws(() => verify(archivePath), error);
	}
});

test("rejects unresolved runtime imports and accepts packaged dependencies", (t) => {
	const extraSource = '\nimport dependency from "runtime-dependency";';
	const missingArchive = createArchive(t, { extraSource });
	assert.throws(
		() => verify(missingArchive),
		/Missing packaged dependency: runtime-dependency/,
	);
	const completeArchive = createArchive(t, {
		extraSource,
		files: {
			"dist-electron/main/node_modules/runtime-dependency/index.js":
				"export default 1;",
		},
	});
	assert.doesNotThrow(() => verify(completeArchive));
});

test("rejects Convex server TypeScript imports", (t) => {
	const archivePath = createArchive(t, {
		extraSource: '\nimport "../../../convex/notes.ts";',
	});
	assert.throws(() => verify(archivePath), /imports Convex server TypeScript/);
});
