import { z } from "zod";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";
import {
	startLineEventHelperSession,
	stopLineEventHelperSession,
} from "./line-event-helper-session.mjs";
import { logError } from "./logger.mjs";

const nativeRosterEventSchema = z.object({
	type: z.enum(["ready", "roster-changed"]),
	timestamp: z.number().int().nonnegative(),
	blindReason: z.string().max(64).optional(),
	participants: z
		.array(
			z.object({
				name: z.string().max(120).nullable(),
				active: z.boolean(),
				isSelf: z.boolean(),
			}),
		)
		.max(200),
});

const sampleRetentionMs = 90_000;
const maxSampleGapMs = 1_500;

export const createMeetSpeakerTimeline = () => {
	let samples = [];

	const recordRoster = (rawEvent) => {
		const event = nativeRosterEventSchema.parse(rawEvent);
		const activeParticipants = event.participants.filter(
			(participant) => participant.active,
		);
		const activeRemote = activeParticipants.filter(
			(participant) => !participant.isSelf,
		);
		let status = "none";
		let name = null;
		if (
			event.blindReason ||
			activeParticipants.some((participant) => participant.isSelf) ||
			activeRemote.length > 1 ||
			(activeRemote.length === 1 && !activeRemote[0].name?.trim())
		) {
			status = "blind";
		} else if (activeRemote.length === 1) {
			status = "named";
			name = activeRemote[0].name.trim();
		}
		samples.push({ at: event.timestamp, name, status });
		const earliestRetainedAt = event.timestamp - sampleRetentionMs;
		while (samples.length > 0 && samples[0].at < earliestRetainedAt) {
			samples.shift();
		}
	};

	const resolveName = ({ startedAt, endedAt }) => {
		if (
			!Number.isFinite(startedAt) ||
			!Number.isFinite(endedAt) ||
			endedAt < startedAt
		) {
			return null;
		}
		const relevant = samples.filter(
			(sample) => sample.at >= startedAt - 250 && sample.at <= endedAt + 250,
		);
		if (
			relevant.length < 2 ||
			relevant.some((sample) => sample.status === "blind")
		) {
			return null;
		}
		if (
			relevant[0].at > startedAt + maxSampleGapMs ||
			relevant.at(-1).at < endedAt - maxSampleGapMs ||
			relevant.some(
				(sample, index) =>
					index > 0 && sample.at - relevant[index - 1].at > maxSampleGapMs,
			)
		) {
			return null;
		}
		const namedSamples = relevant.filter((sample) => sample.status === "named");
		if (
			namedSamples.length < 2 ||
			new Set(namedSamples.map((sample) => sample.name)).size !== 1
		) {
			return null;
		}
		return namedSamples[0].name;
	};

	return {
		clear: () => {
			samples = [];
		},
		recordRoster,
		resolveName,
	};
};

export const createMeetChromeSpeakerAttribution = ({ runtimeDir }) => {
	const timeline = createMeetSpeakerTimeline();
	let session = null;
	let generation = 0;

	const stop = async () => {
		generation += 1;
		const currentSession = session;
		session = null;
		timeline.clear();
		await stopLineEventHelperSession(currentSession);
	};

	const start = async () => {
		if (process.platform !== "darwin") {
			return false;
		}
		const currentGeneration = ++generation;
		const previousSession = session;
		session = null;
		timeline.clear();
		await stopLineEventHelperSession(previousSession);
		if (generation !== currentGeneration) {
			return false;
		}
		const helperPath = resolveDesktopRuntimeExecutablePath({
			executableName: "graneri-meet-chrome-speaker-helper",
			runtimeDir,
		});
		if (!helperPath) {
			return false;
		}
		try {
			const startedSession = await startLineEventHelperSession({
				helperPath,
				isExpectedEvent: (event) =>
					event?.type === "ready" || event?.type === "roster-changed",
				label: "meet-chrome-speaker-helper",
				onEvent: ({ event, resolveReady, session: eventSession }) => {
					if (generation !== currentGeneration || session !== eventSession) {
						return;
					}
					timeline.recordRoster(event);
					if (event.type === "ready") {
						resolveReady();
					}
				},
				onSessionStarted: (startedSession) => {
					session = startedSession;
				},
				onStartFailure: (failedSession) => {
					if (session === failedSession) {
						session = null;
					}
				},
				onUnexpectedExit: ({ code, session: exitedSession, signal }) => {
					if (session !== exitedSession) {
						return;
					}
					session = null;
					timeline.clear();
					logError({
						error: { code, signal },
						message: "[transcription] Meet speaker helper exited",
					});
				},
				startupTimeoutMessage:
					"Timed out while starting the Meet speaker monitor.",
			});
			if (generation !== currentGeneration) {
				await stopLineEventHelperSession(startedSession);
				return false;
			}
			return true;
		} catch (error) {
			if (generation !== currentGeneration) {
				return false;
			}
			timeline.clear();
			logError({
				error,
				message: "[transcription] Meet speaker monitor failed to start",
			});
			return false;
		}
	};

	return { resolveName: timeline.resolveName, start, stop };
};
