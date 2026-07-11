"use node";

import { ConvexError, v } from "convex/values";
import { transcribeDictationAudio } from "../packages/ai/src/dictation-transcription.mjs";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const transcriptionResultValidator = v.object({
	durationInSeconds: v.union(v.number(), v.null()),
	language: v.union(v.string(), v.null()),
	text: v.string(),
});

const isWavAudio = (audio: Uint8Array) =>
	audio.byteLength >= 12 &&
	String.fromCharCode(...audio.subarray(0, 4)) === "RIFF" &&
	String.fromCharCode(...audio.subarray(8, 12)) === "WAVE";

export const transcribe = action({
	args: {
		uploadId: v.id("dictationUploads"),
	},
	returns: transcriptionResultValidator,
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new ConvexError({
				code: "UNAUTHENTICATED",
				message: "You must be signed in to use dictation.",
			});
		}

		const storageId = await ctx.runMutation(internal.dictationUploads.claim, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			uploadId: args.uploadId,
		});

		try {
			const audio = await ctx.storage.get(storageId);
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
			});

			return {
				durationInSeconds: result.durationInSeconds ?? null,
				language: result.language ?? null,
				text: result.text,
			};
		} finally {
			await ctx.runMutation(internal.dictationUploads.complete, {
				uploadId: args.uploadId,
			});
		}
	},
});
