import { afterEach, describe, expect, it, vi } from "vitest";
import { connectRealtimeTranscriptionTransport } from "../src/lib/capture/realtime-transcription-transport";

vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: vi.fn(async () => "test-convex-token"),
}));

const createMockStream = () => {
	// SAFETY: The transport only reads MediaStreamTrack identity and never calls
	// browser-native track methods in this contract test.
	const track = { stop: vi.fn() } as MediaStreamTrack;
	const stream = { getTracks: () => [track] } satisfies Pick<
		MediaStream,
		"getTracks"
	>;

	// SAFETY: getTracks is the complete MediaStream surface used by the transport.
	return stream as MediaStream;
};

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

class MockDataChannel {
	addEventListener = vi.fn();
}

class MockPeerConnection {
	connectionState: RTCPeerConnectionState = "new";
	private readonly listeners = new Set<() => void>();
	private readonly dataChannel = new MockDataChannel();

	addTrack = vi.fn();
	createDataChannel = vi.fn(() => this.dataChannel);
	createOffer = vi.fn(async () => ({
		sdp: "offer-sdp",
		type: "offer" as const,
	}));
	setLocalDescription = vi.fn(async () => {});
	setRemoteDescription = vi.fn(
		async (_description: { sdp: string; type: "answer" }) => {
			this.connectionState = "connected";
			for (const listener of this.listeners) {
				listener();
			}
		},
	);
	close = vi.fn(() => {
		this.connectionState = "closed";
		for (const listener of this.listeners) {
			listener();
		}
	});

	addEventListener(event: string, listener: () => void) {
		if (event === "connectionstatechange") {
			this.listeners.add(listener);
		}
	}

	removeEventListener(event: string, listener: () => void) {
		if (event === "connectionstatechange") {
			this.listeners.delete(listener);
		}
	}
}

const connectWithMockPeer = () =>
	connectRealtimeTranscriptionTransport({
		createPeerConnection: () => new MockPeerConnection(),
		lang: "en",
		logger: {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
		},
		onEvent: vi.fn(),
		onInterrupted: vi.fn(),
		source: "systemAudio",
		speaker: "them",
		stream: createMockStream(),
	});

describe("connectRealtimeTranscriptionTransport", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
		globalThis.window = originalWindow;
		vi.restoreAllMocks();
	});

	it("forwards the transcription source when creating a realtime session", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ clientSecret: "secret" }), {
					headers: {
						"Content-Type": "application/json",
					},
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response("answer-sdp", {
					status: 200,
				}),
			);

		globalThis.fetch = fetchMock as typeof fetch;
		globalThis.window = globalThis as typeof globalThis & Window;

		const transport = await connectWithMockPeer();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/realtime-transcription-session",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-convex-token",
				}),
				method: "POST",
			}),
		);
		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")),
		).toEqual({
			lang: "en",
			source: "systemAudio",
			speaker: "them",
			transport: "webrtc",
		});

		await transport.close();
	});

	it("recovers from a transient session-service outage on the first click", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: "Service unavailable." }), {
					status: 503,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ clientSecret: "secret" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response("answer-sdp", { status: 200 }));
		globalThis.fetch = fetchMock as typeof fetch;
		globalThis.window = globalThis as typeof globalThis & Window;

		const transport = await connectWithMockPeer();
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"/api/realtime-transcription-session",
		);
		expect(fetchMock.mock.calls[1]?.[0]).toBe(
			"/api/realtime-transcription-session",
		);
		await transport.close();
	});

	it("does not retry an authentication failure", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "Authentication is invalid." }), {
				status: 401,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;
		globalThis.window = globalThis as typeof globalThis & Window;

		await expect(connectWithMockPeer()).rejects.toThrow(
			"Authentication is invalid.",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("stops after three unavailable session responses", async () => {
		const fetchMock = vi.fn().mockImplementation(
			async () =>
				new Response(JSON.stringify({ error: "Service unavailable." }), {
					status: 503,
				}),
		);
		globalThis.fetch = fetchMock as typeof fetch;
		globalThis.window = globalThis as typeof globalThis & Window;

		await expect(connectWithMockPeer()).rejects.toThrow("Service unavailable.");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
