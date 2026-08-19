import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { MAX_LOCAL_FOLDER_ROOTS } from "./local-folder-tool-definitions.mjs";

const assertInsideRoot = ({ candidatePath, rootPath }) => {
	const rootRelativePath = relative(rootPath, candidatePath);
	if (
		rootRelativePath === ".." ||
		rootRelativePath.startsWith(`..${sep}`) ||
		isAbsolute(rootRelativePath)
	) {
		throw new Error("Path is outside the shared folder.");
	}
};

const validateRoots = (roots) => {
	if (!Array.isArray(roots) || roots.length === 0) {
		throw new Error("At least one shared local folder is required.");
	}
	if (roots.length > MAX_LOCAL_FOLDER_ROOTS) {
		throw new Error(
			`At most ${MAX_LOCAL_FOLDER_ROOTS} local folders can be shared with one chat.`,
		);
	}

	const seen = new Set();
	return roots.map((root) => {
		if (
			typeof root?.name !== "string" ||
			!root.name.trim() ||
			typeof root.path !== "string" ||
			!isAbsolute(root.path)
		) {
			throw new Error("Shared local folder metadata is invalid.");
		}
		if (seen.has(root.path)) {
			throw new Error("Shared local folders must be unique.");
		}

		seen.add(root.path);
		return Object.freeze({ ...root });
	});
};

const resolveExistingLocalPath = async ({ relativePath = ".", root }) => {
	const currentRootPath = await realpath(root.path);
	if (currentRootPath !== root.path) {
		throw new Error("Shared folder root is no longer canonical.");
	}

	const candidatePath = resolve(root.path, relativePath);
	assertInsideRoot({ candidatePath, rootPath: root.path });
	const canonicalPath = await realpath(candidatePath);
	assertInsideRoot({ candidatePath: canonicalPath, rootPath: root.path });
	return canonicalPath;
};

export const createLocalWorkspaceSession = (roots) => {
	const canonicalRoots = validateRoots(roots);

	const getRoot = (rootIndex) => {
		if (!Number.isInteger(rootIndex)) {
			throw new Error("Shared folder index must be an integer.");
		}
		const root = canonicalRoots[rootIndex];
		if (!root) {
			throw new Error("Unknown shared folder.");
		}
		return root;
	};

	const resolveExistingPath = async ({ relativePath = ".", rootIndex }) => {
		const root = getRoot(rootIndex);
		return {
			path: await resolveExistingLocalPath({ relativePath, root }),
			root,
		};
	};

	return Object.freeze({
		getRoot,
		resolveExistingPath,
		roots: Object.freeze(canonicalRoots),
	});
};
