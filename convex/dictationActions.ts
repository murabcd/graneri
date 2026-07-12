"use node";

import { transcribeDictationAudio } from "@workspace/ai/dictation-transcription";
import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";

const transcriptionResultValidator = v.object({
	durationInSeconds: v.union(v.number(), v.null()),
	language: v.union(v.string(), v.null()),
	text: v.string(),
});

const isWavAudio = (audio: Uint8Array) =>
	audio.byteLength >= 12 &&
	String.fromCharCode(...audio.subarray(0, 4)) === "RIFF" &&
	String.fromCharCode(...audio.subarray(8, 12)) === "WAVE";

export const transcribeStoredAudio = internalAction({
	args: {
		safetyIdentifier: v.string(),
		storageId: v.id("_storage"),
	},
	returns: transcriptionResultValidator,
	handler: async (ctx, args) => {
		const audio = await ctx.storage.get(args.storageId);
		if (!audio) {
			throw new ConvexError({
				code: "DICTATION_AUDIO_MISSING",
				message: "Dictation audio is missing.",
			});
		}

		const audioBytes = new Uint8Array(await audio.arrayBuffer());
		if (!isWavAudio(audioBytes)) {
			throw new ConvexError({
				code: "DICTATION_AUDIO_TYPE_INVALID",
				message: "Dictation audio must be a WAV file.",
			});
		}

		const result = await transcribeDictationAudio({
			audio: audioBytes,
			safetyIdentifier: args.safetyIdentifier,
		});

		return {
			durationInSeconds: result.durationInSeconds ?? null,
			language: result.language ?? null,
			text: result.text,
		};
	},
});
