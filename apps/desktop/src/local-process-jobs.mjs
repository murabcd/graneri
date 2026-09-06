import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
	localProcessOutputSchema,
	localProcessStatusSchema,
} from "@workspace/ai/local-execution-contract";
import { z } from "zod";
import { writeJsonAtomically } from "./atomic-json-file.mjs";

const retainedOutputBytes = 1_000_000;
const pageOutputBytes = 20_000;
const retainedOutputEvents = 512;
// A control byte can expand to six bytes in JSON, plus bounded event metadata.
const storedOutputBytes =
	retainedOutputBytes * 6 + retainedOutputEvents * 100 + 1000;
const storedProcessSchema = z.strictObject({
	processId: z.uuid(),
	startedAt: z.number().int().nonnegative(),
	finishedAt: z.number().int().nonnegative().nullable(),
	status: localProcessStatusSchema,
	exitCode: z.number().int().nullable(),
	nextCursor: z.number().int().nonnegative(),
	events: z
		.array(
			z.strictObject({
				cursor: z.number().int().nonnegative(),
				stream: z.enum(["stdout", "stderr"]),
				text: z.string().max(4096),
			}),
		)
		.max(retainedOutputEvents),
});

const waitForProcess = (finished, milliseconds) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, milliseconds);
		const finish = () => {
			clearTimeout(timer);
			resolve();
		};
		finished.then(finish, finish);
	});

const appendOutput = (record, stream, text) => {
	const bytes = Buffer.from(text);
	for (let offset = 0; offset < bytes.length; ) {
		let end = Math.min(offset + 4096, bytes.length);
		while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
		record.events.push({
			cursor: record.nextCursor++,
			stream,
			text: bytes.subarray(offset, end).toString("utf8"),
		});
		offset = end;
	}
	let size = record.events.reduce(
		(total, event) => total + Buffer.byteLength(event.text),
		0,
	);
	while (
		size > retainedOutputBytes ||
		record.events.length > retainedOutputEvents
	)
		size -= Buffer.byteLength(record.events.shift().text);
};

const processOutput = (record, cursor) => {
	if (cursor > record.nextCursor)
		throw new Error("Process output cursor is ahead of its output.");
	let stdout = "",
		stderr = "",
		size = 0;
	let nextCursor = Math.max(
		cursor,
		record.events[0]?.cursor ?? record.nextCursor,
	);
	for (const event of record.events) {
		if (event.cursor < nextCursor) continue;
		const bytes = Buffer.byteLength(event.text);
		if (size + bytes > pageOutputBytes) break;
		if (event.stream === "stdout") stdout += event.text;
		else stderr += event.text;
		size += bytes;
		nextCursor = event.cursor + 1;
	}
	return localProcessOutputSchema.parse({
		processId: record.processId,
		status: record.status,
		exitCode: record.exitCode,
		stdout,
		stderr,
		nextCursor,
		hasMore: nextCursor < record.nextCursor,
		truncated:
			cursor < (record.events[0]?.cursor ?? record.nextCursor) ||
			record.status === "output_limit",
		elapsedMs: (record.finishedAt ?? Date.now()) - record.startedAt,
	});
};

export const createLocalProcessJobs = ({
	executionsDirPath,
	launchProcess,
}) => {
	if (typeof launchProcess !== "function")
		throw new Error("A native process launcher is required.");
	const active = new Map();
	const pathFor = (sessionId, processId) =>
		join(
			executionsDirPath,
			sessionId,
			"processes",
			`${z.uuid().parse(processId)}.json`,
		);
	const persist = (sessionId, record) =>
		writeJsonAtomically(pathFor(sessionId, record.processId), record);
	const load = async (sessionId, processId) => {
		const entry = active.get(processId);
		if (entry?.sessionId === sessionId) return entry.record;
		const path = pathFor(sessionId, processId);
		if ((await stat(path)).size > storedOutputBytes)
			throw new Error("Stored process output exceeds its limit.");
		const record = storedProcessSchema.parse(
			JSON.parse(await readFile(path, "utf8")),
		);
		if (record.status === "running") {
			record.status = "interrupted";
			record.finishedAt = Date.now();
			await persist(sessionId, record);
		}
		return record;
	};

	return {
		start: async ({ sessionId, yieldTimeMs, ...input }) => {
			const record = {
				processId: randomUUID(),
				startedAt: Date.now(),
				finishedAt: null,
				status: "running",
				exitCode: null,
				nextCursor: 0,
				events: [],
			};
			const controller = new AbortController();
			const entry = {
				sessionId,
				record,
				controller,
				process: null,
				finished: null,
			};
			active.set(record.processId, entry);
			entry.finished = (async () => {
				try {
					await persist(sessionId, record);
					entry.process = await launchProcess({
						...input,
						signal: controller.signal,
					});
					for (const stream of ["stdout", "stderr"]) {
						const decoder = new StringDecoder("utf8");
						entry.process[stream].on("data", (bytes) =>
							appendOutput(record, stream, decoder.write(bytes)),
						);
						entry.process[stream].once("end", () =>
							appendOutput(record, stream, decoder.end()),
						);
					}
					entry.process.stdin.on("error", () => {}); // write callbacks report closed-input errors to the caller.
					const result = await entry.process.completed;
					record.exitCode = result.exitCode;
					record.status = result.status;
				} catch (error) {
					record.status = controller.signal.aborted ? "cancelled" : "failed";
					appendOutput(record, "stderr", error.message);
				} finally {
					record.finishedAt = Date.now();
					try {
						await persist(sessionId, record);
					} catch (error) {
						record.status = "failed";
						appendOutput(
							record,
							"stderr",
							`Could not persist process result: ${error.message}`,
						);
					}
					active.delete(record.processId);
				}
			})();
			await waitForProcess(entry.finished, yieldTimeMs);
			return processOutput(record, 0);
		},
		interact: async ({ sessionId, processId, action, cursor, yieldTimeMs }) => {
			const record = await load(sessionId, processId);
			const entry = active.get(processId);
			if (action.operation === "write") {
				if (
					entry?.sessionId !== sessionId ||
					!entry.process ||
					record.status !== "running"
				)
					throw new Error("The process is not accepting input.");
				await new Promise((resolve, reject) =>
					entry.process.stdin.write(action.input, (error) =>
						error ? reject(error) : resolve(),
					),
				);
				if (action.closeInput) entry.process.stdin.end();
			}
			if (entry?.sessionId === sessionId) {
				if (action.operation === "terminate") entry.controller.abort();
				await waitForProcess(entry.finished, yieldTimeMs);
			}
			return processOutput(record, cursor);
		},
		stopSession: async (sessionId) => {
			const entries = [...active.values()].filter(
				(entry) => entry.sessionId === sessionId,
			);
			for (const entry of entries) entry.controller.abort();
			await Promise.all(entries.map((entry) => entry.finished));
		},
	};
};
