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
	scope: z.string().max(160).nullable(),
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

export const createMeetingSpeakerTimeline = () => {
	let samples = [];

	const recordRoster = (rawEvent) => {
		const event = nativeRosterEventSchema.parse(rawEvent);
		const remoteParticipants = event.participants.filter(
			(participant) => !participant.isSelf,
		);
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
		} else if (
			remoteParticipants.length === 1 &&
			remoteParticipants[0].name?.trim()
		) {
			status = "candidate";
			name = remoteParticipants[0].name.trim();
		}
		samples.push({ at: event.timestamp, name, scope: event.scope, status });
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
			relevant.some((sample) => sample.status === "blind") ||
			new Set(relevant.map((sample) => sample.scope)).size !== 1 ||
			relevant[0].scope === null
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
		const attributedSamples = relevant.filter(
			(sample) => sample.status === "named" || sample.status === "candidate",
		);
		if (new Set(attributedSamples.map((sample) => sample.name)).size !== 1) {
			return null;
		}
		if (namedSamples.length >= 2) {
			return namedSamples[0].name;
		}
		const candidateSamples = relevant.filter(
			(sample) => sample.status === "candidate",
		);
		if (
			candidateSamples.length < 2 ||
			candidateSamples.length !== relevant.length
		) {
			return null;
		}
		return candidateSamples[0].name;
	};

	return {
		clear: () => {
			samples = [];
		},
		recordRoster,
		resolveName,
	};
};

export const createChromeMeetingSpeakerAttribution = ({ runtimeDir }) => {
	const timeline = createMeetingSpeakerTimeline();
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
			executableName: "graneri-chrome-meeting-speaker-helper",
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
				label: "chrome-meeting-speaker-helper",
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
						message: "[transcription] Chrome meeting speaker helper exited",
					});
				},
				startupTimeoutMessage:
					"Timed out while starting the Chrome meeting speaker monitor.",
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
				message:
					"[transcription] Chrome meeting speaker monitor failed to start",
			});
			return false;
		}
	};

	return { resolveName: timeline.resolveName, start, stop };
};
