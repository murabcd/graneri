import { join } from "node:path";
import { parseDocument } from "yaml";
import {
	localSkillMetadataSchema,
	MAX_LOCAL_SKILL_PAGE_ENTRIES,
} from "./local-skill-contract.mjs";

const skillDirectory = ".agents/skills";
const parseMetadata = (content) => {
	const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
		content,
	);
	if (!frontmatter)
		throw new Error("SKILL.md needs YAML frontmatter within its first 8 KB.");
	const document = parseDocument(frontmatter[1]);
	if (document.errors.length > 0)
		throw new Error("SKILL.md contains invalid YAML frontmatter.");
	return localSkillMetadataSchema.parse(document.toJS({ maxAliasCount: 20 }));
};

export const listLocalSkills = async ({ workspace, rootIndex, cursor }) => {
	const { root } = await workspace.resolveExistingPath({ rootIndex });
	let page;
	try {
		page = await workspace.listDirectory({
			rootIndex,
			relativePath: skillDirectory,
			cursor,
			maxEntries: MAX_LOCAL_SKILL_PAGE_ENTRIES,
		});
	} catch (error) {
		if (error.code !== "ENOENT" || error.path === root.path || cursor)
			throw error;
		return {
			skills: [],
			skippedFiles: [],
			nextCursor: null,
			visitedEntries: 0,
			excludedEntries: 0,
		};
	}
	const skills = [],
		skippedFiles = [];
	for (const entry of page.entries) {
		if (entry.type !== "directory") continue;
		const path = join(skillDirectory, entry.name, "SKILL.md");
		try {
			const file = await workspace.readTextFile({
				rootIndex,
				relativePath: path,
				offsetBytes: 0,
				lengthBytes: 8192,
			});
			skills.push({ ...parseMetadata(file.content), path });
		} catch (error) {
			skippedFiles.push({ path, reason: error.message.slice(0, 512) });
		}
	}
	return {
		skills,
		skippedFiles,
		nextCursor: page.nextCursor,
		visitedEntries: page.visitedEntries,
		excludedEntries: page.excludedEntries,
	};
};
