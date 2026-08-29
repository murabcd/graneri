import assert from "node:assert/strict";
import test from "node:test";
import { pickDesktopLocalFolder } from "../src/desktop-local-folder-picker.mjs";

test("opens a single-directory picker and registers the selected folder", async () => {
	const calls = [];
	const folder = {
		id: "folder-graneri",
		name: "graneri",
		path: "/Users/test/Documents/graneri",
	};

	const result = await pickDesktopLocalFolder({
		shareLocalFolders: async (paths) => {
			calls.push({ paths });
			return { folders: [folder] };
		},
		showOpenDialog: async (options) => {
			calls.push({ options });
			return { canceled: false, filePaths: [folder.path] };
		},
	});

	assert.deepEqual(calls, [
		{
			options: {
				buttonLabel: "Choose",
				properties: ["openDirectory", "createDirectory"],
				title: "Choose local folder",
			},
		},
		{ paths: [folder.path] },
	]);
	assert.deepEqual(result, { canceled: false, folder });
});

test("leaves the shared-folder session unchanged when selection is canceled", async () => {
	let shareCallCount = 0;

	const result = await pickDesktopLocalFolder({
		shareLocalFolders: async () => {
			shareCallCount += 1;
			return { folders: [] };
		},
		showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
	});

	assert.deepEqual(result, { canceled: true });
	assert.equal(shareCallCount, 0);
});
