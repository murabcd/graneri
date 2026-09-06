import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listLocalSkills } from "../src/local-skills.mjs";
import { createLocalWorkspaceSession } from "../src/local-workspace-session.mjs";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
const fixture = async () => {
	const path = await realpath(await mkdtemp(join(tmpdir(), "graneri-skills-")));
	directories.push(path);
	const workspace = createLocalWorkspaceSession([{ name: "shared", path }]);
	const save = async (name: string, content: string) => {
		const folder = join(path, ".agents/skills", name);
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "SKILL.md"), content);
	};
	return { path, workspace, save };
};

describe("local skill discovery", () => {
	it("pages skill metadata and keeps complete instructions available through file reading", async () => {
		const f = await fixture();
		for (let index = 0; index < 23; index++) {
			await f.save(
				`skill-${String(index).padStart(2, "0")}`,
				`---\nname: skill-${index}\ndescription: >-\n  Work with data,\n  including графики.\n---\nRead ./reference.md before running the script.\n`,
			);
		}
		const first = await listLocalSkills({
			workspace: f.workspace,
			rootIndex: 0,
		});
		expect(first.skills).toHaveLength(20);
		expect(first.skills[0].description).toBe(
			"Work with data, including графики.",
		);
		const next = await listLocalSkills({
			workspace: f.workspace,
			rootIndex: 0,
			cursor: first.nextCursor,
		});
		expect(next.skills).toHaveLength(3);
		expect(next.nextCursor).toBeNull();
		expect(
			new Set([...first.skills, ...next.skills].map((skill) => skill.path))
				.size,
		).toBe(23);
		const file = await f.workspace.readFile({
			rootIndex: 0,
			relativePath: next.skills[0].path,
			offsetBytes: 0,
			lengthBytes: 8192,
		});
		expect(file.content).toContain("Read ./reference.md");
	});

	it("reports invalid and escaping manifests without hiding usable neighboring skills", async () => {
		const f = await fixture();
		await f.save(
			"good",
			"---\nname: good\ndescription: Useful work\n---\nInstructions",
		);
		await f.save(
			"bad",
			"---\nname: [bad]\ndescription: [invalid]\n---\nInstructions",
		);
		const outside = await fixture();
		await outside.save(
			"private",
			"---\nname: secret\ndescription: Private data\n---\nSecret",
		);
		await mkdir(join(f.path, ".agents/skills/escape"));
		await symlink(
			join(outside.path, ".agents/skills/private/SKILL.md"),
			join(f.path, ".agents/skills/escape/SKILL.md"),
		);
		const page = await listLocalSkills({
			workspace: f.workspace,
			rootIndex: 0,
		});
		expect(page.skills.map((skill) => skill.name)).toEqual(["good"]);
		expect(page.skippedFiles.map((file) => file.path)).toEqual([
			".agents/skills/bad/SKILL.md",
			".agents/skills/escape/SKILL.md",
		]);
		expect(JSON.stringify(page)).not.toContain("Private data");
	});

	it("distinguishes an empty installation from a removed root or stale page", async () => {
		const f = await fixture();
		expect(
			await listLocalSkills({ workspace: f.workspace, rootIndex: 0 }),
		).toMatchObject({ skills: [], nextCursor: null });
		for (let index = 0; index < 21; index++)
			await f.save(
				`skill-${index}`,
				`---\nname: skill-${index}\ndescription: Work\n---\nInstructions`,
			);
		const first = await listLocalSkills({
			workspace: f.workspace,
			rootIndex: 0,
		});
		await rm(join(f.path, ".agents"), { recursive: true });
		await expect(
			listLocalSkills({
				workspace: f.workspace,
				rootIndex: 0,
				cursor: first.nextCursor,
			}),
		).rejects.toThrow();
		await rm(f.path, { recursive: true });
		await expect(
			listLocalSkills({ workspace: f.workspace, rootIndex: 0 }),
		).rejects.toThrow();
	});
});
