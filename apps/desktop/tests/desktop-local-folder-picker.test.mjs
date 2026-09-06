import assert from "node:assert/strict";
import test from "node:test";
import { pickDesktopLocalFolder } from "../src/desktop-local-folder-picker.mjs";

test("opens a single-directory picker and authorizes a capability session", async () => {
	const calls = [];
	const session = {
		id: "folder-graneri",
		label: "graneri",
	};
	const path = "/Users/test/Documents/graneri";

	const result = await pickDesktopLocalFolder({
		authorizeFolder: async (request) => {
			calls.push({ request });
			return { session };
		},
		scope: "chat:one",
		showOpenDialog: async (options) => {
			calls.push({ options });
			return { canceled: false, filePaths: [path] };
		},
	});

	assert.deepEqual(calls, [
		{
			options: {
				buttonLabel: "Choose",
				message:
					"Graneri can read, create, and modify files in the folder you share.",
				properties: ["openDirectory", "createDirectory"],
				title: "Choose local folder",
			},
		},
		{ request: { path, scope: "chat:one" } },
	]);
	assert.deepEqual(result, { canceled: false, session });
});

test("leaves the shared-folder session unchanged when selection is canceled", async () => {
	let authorizeCallCount = 0;

	const result = await pickDesktopLocalFolder({
		authorizeFolder: async () => {
			authorizeCallCount += 1;
			return { session: { id: "unused", label: "unused" } };
		},
		scope: "chat:one",
		showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
	});

	assert.deepEqual(result, { canceled: true });
	assert.equal(authorizeCallCount, 0);
});
