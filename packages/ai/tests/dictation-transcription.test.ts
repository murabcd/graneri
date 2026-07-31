import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createDictationAudioTranscriber,
	type DictationAudioTranscriber,
} from "../src/dictation-transcription.mjs";

const fetchMock = vi.fn<typeof fetch>();

const createJsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
		status,
	});

describe("dictation transcription", () => {
	let transcribeDictationAudio: DictationAudioTranscriber;

	beforeEach(() => {
		fetchMock.mockReset();
		transcribeDictationAudio = createDictationAudioTranscriber({
			apiKey: "test-api-key",
			fetch: fetchMock,
		});
	});

	it("uses GPT Transcribe and returns detected languages", async () => {
		const audio = new Uint8Array([1, 2, 3]);
		fetchMock.mockResolvedValue(
			createJsonResponse({
				languages: [{ code: "en" }, { code: "ru" }],
				text: "  Hello world  ",
				usage: { seconds: 1.25, type: "duration" },
			}),
		);

		await expect(
			transcribeDictationAudio({
				audio,
				safetyIdentifier: "user-hash",
			}),
		).resolves.toEqual({
			durationInSeconds: 1.25,
			languages: ["en", "ru"],
			text: "Hello world",
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
		expect(init).toMatchObject({
			method: "POST",
			headers: {
				Authorization: "Bearer test-api-key",
				"OpenAI-Safety-Identifier": "user-hash",
			},
		});
		const formData = init?.body;
		expect(formData).toBeInstanceOf(FormData);
		if (!(formData instanceof FormData)) {
			throw new Error("Expected a multipart request body.");
		}
		expect(formData.get("model")).toBe("gpt-transcribe");
		expect(formData.get("response_format")).toBe("json");
		const file = formData.get("file");
		expect(file).toBeInstanceOf(File);
		if (!(file instanceof File)) {
			throw new Error("Expected an audio file.");
		}
		expect(file.name).toBe("dictation.wav");
		expect(file.type).toBe("audio/wav");
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
	});

	it("returns canonical empty metadata when detection is unavailable", async () => {
		fetchMock.mockResolvedValue(
			createJsonResponse({
				languages: [],
				text: "Hello",
				usage: {
					input_tokens: 1,
					output_tokens: 1,
					total_tokens: 2,
					type: "tokens",
				},
			}),
		);

		await expect(
			transcribeDictationAudio({
				audio: new Uint8Array([1]),
				safetyIdentifier: "user-hash",
			}),
		).resolves.toEqual({
			durationInSeconds: null,
			languages: [],
			text: "Hello",
		});
	});

	it("rejects responses without the GPT Transcribe language contract", async () => {
		fetchMock.mockResolvedValue(createJsonResponse({ text: "Hello" }));

		await expect(
			transcribeDictationAudio({
				audio: new Uint8Array([1]),
				safetyIdentifier: "user-hash",
			}),
		).rejects.toThrow("Transcription response is missing detected languages.");
	});

	it("rejects failed OpenAI responses", async () => {
		fetchMock.mockResolvedValue(
			createJsonResponse({ error: { message: "Unavailable" } }, 503),
		);

		await expect(
			transcribeDictationAudio({
				audio: new Uint8Array([1]),
				safetyIdentifier: "user-hash",
			}),
		).rejects.toThrow("OpenAI transcription request failed with status 503.");
	});

	it("rejects invalid input before calling OpenAI", async () => {
		await expect(
			transcribeDictationAudio({
				audio: new Uint8Array(),
				safetyIdentifier: "user-hash",
			}),
		).rejects.toThrow("Audio is required.");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
