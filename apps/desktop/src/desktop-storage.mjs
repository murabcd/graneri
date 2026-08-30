import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { logError } from "./logger.mjs";

const transcriptDraftStorageVersion = 1;
const transcriptDraftMaxAgeMs = 72 * 60 * 60 * 1000;
const noteDraftStorageVersion = 1;
const noteDraftMaxAgeMs = 72 * 60 * 60 * 1000;
const getDraftPath = ({ draftsDirPath, noteKey }) =>
	join(
		draftsDirPath,
		`${Buffer.from(noteKey, "utf8").toString("base64url")}.json`,
	);

const ensureDraftsDir = async (draftsDirPath) => {
	await mkdir(draftsDirPath, { recursive: true });
};

const pruneDrafts = async ({ draftsDirPath, maxAgeMs, label }) => {
	try {
		await ensureDraftsDir(draftsDirPath);
		const entries = await readdir(draftsDirPath, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				if (!entry.isFile()) {
					return;
				}

				const filePath = join(draftsDirPath, entry.name);

				try {
					const fileStats = await stat(filePath);

					if (Date.now() - fileStats.mtimeMs > maxAgeMs) {
						await rm(filePath, { force: true });
					}
				} catch {
					await rm(filePath, { force: true });
				}
			}),
		);
	} catch (error) {
		logError({
			error: error,
			message: `Failed to prune ${label} drafts.`,
		});
	}
};

const loadDraft = async ({
	draftsDirPath,
	maxAgeMs,
	noteKey,
	storedKeyField,
	version,
	label,
}) => {
	await pruneDrafts({ draftsDirPath, maxAgeMs, label });

	const filePath = getDraftPath({ draftsDirPath, noteKey });

	try {
		const rawValue = await readFile(filePath, "utf8");
		const parsed = JSON.parse(rawValue);

		if (
			parsed?.version !== version ||
			parsed?.[storedKeyField] !== noteKey ||
			typeof parsed?.updatedAt !== "number" ||
			Date.now() - parsed.updatedAt > maxAgeMs
		) {
			await rm(filePath, { force: true });
			return { draft: null };
		}

		return { draft: parsed };
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return { draft: null };
		}

		await rm(filePath, { force: true }).catch(() => {});
		return { draft: null };
	}
};

const saveDraft = async ({
	draft,
	draftsDirPath,
	noteKey,
	storedKeyField,
	version,
	maxAgeMs,
	label,
}) => {
	await pruneDrafts({ draftsDirPath, maxAgeMs, label });
	await ensureDraftsDir(draftsDirPath);

	await writeFile(
		getDraftPath({ draftsDirPath, noteKey }),
		JSON.stringify(
			{
				...draft,
				version,
				[storedKeyField]: noteKey,
				updatedAt: Date.now(),
			},
			null,
			2,
		),
		"utf8",
	);

	return { ok: true };
};

const clearDraft = async ({ draftsDirPath, noteKey }) => {
	await rm(getDraftPath({ draftsDirPath, noteKey }), { force: true });
	return { ok: true };
};

export const createDesktopStorage = ({
	transcriptDraftsDirPath,
	noteDraftsDirPath,
}) => ({
	loadTranscriptDraft: (noteKey) =>
		loadDraft({
			draftsDirPath: transcriptDraftsDirPath,
			label: "transcript",
			maxAgeMs: transcriptDraftMaxAgeMs,
			noteKey,
			storedKeyField: "noteKey",
			version: transcriptDraftStorageVersion,
		}),
	saveTranscriptDraft: ({ noteKey, draft }) =>
		saveDraft({
			draft,
			draftsDirPath: transcriptDraftsDirPath,
			label: "transcript",
			maxAgeMs: transcriptDraftMaxAgeMs,
			noteKey,
			storedKeyField: "noteKey",
			version: transcriptDraftStorageVersion,
		}),
	clearTranscriptDraft: (noteKey) =>
		clearDraft({ draftsDirPath: transcriptDraftsDirPath, noteKey }),
	loadNoteDraft: (noteKey) =>
		loadDraft({
			draftsDirPath: noteDraftsDirPath,
			label: "note",
			maxAgeMs: noteDraftMaxAgeMs,
			noteKey,
			storedKeyField: "noteId",
			version: noteDraftStorageVersion,
		}),
	saveNoteDraft: ({ noteKey, draft }) =>
		saveDraft({
			draft,
			draftsDirPath: noteDraftsDirPath,
			label: "note",
			maxAgeMs: noteDraftMaxAgeMs,
			noteKey,
			storedKeyField: "noteId",
			version: noteDraftStorageVersion,
		}),
	clearNoteDraft: (noteKey) =>
		clearDraft({ draftsDirPath: noteDraftsDirPath, noteKey }),
});
