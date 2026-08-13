import {
	JsonToSseTransformStream,
	UI_MESSAGE_STREAM_HEADERS,
	type UIMessageChunk,
} from "ai";

type UiMessageResponseEvent = "close" | "drain" | "error";

export type UiMessageServerResponse = {
	destroyed: boolean;
	writableEnded: boolean;
	end: () => unknown;
	hasHeader: (name: string) => boolean;
	off: (event: UiMessageResponseEvent, listener: () => void) => unknown;
	once: (event: UiMessageResponseEvent, listener: () => void) => unknown;
	setHeader: (
		name: string,
		value: number | string | readonly string[],
	) => unknown;
	write: (value: Uint8Array) => boolean;
};

const waitForResponseDrain = (response: UiMessageServerResponse) =>
	new Promise<boolean>((resolve) => {
		if (response.destroyed || response.writableEnded) {
			resolve(false);
			return;
		}
		const cleanup = () => {
			response.off("close", handleClose);
			response.off("drain", handleDrain);
			response.off("error", handleClose);
		};
		const handleClose = () => {
			cleanup();
			resolve(false);
		};
		const handleDrain = () => {
			cleanup();
			resolve(true);
		};

		response.once("close", handleClose);
		response.once("drain", handleDrain);
		response.once("error", handleClose);
	});

const applyUiMessageStreamHeaders = (response: UiMessageServerResponse) => {
	for (const [name, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
		if (!response.hasHeader(name)) {
			response.setHeader(name, value);
		}
	}
};

export const pipeUiMessageStreamToServerResponse = ({
	response,
	stream,
}: {
	response: UiMessageServerResponse;
	stream: ReadableStream<UIMessageChunk>;
}) => {
	applyUiMessageStreamHeaders(response);
	const byteStream = stream
		.pipeThrough(new JsonToSseTransformStream())
		.pipeThrough(new TextEncoderStream());
	const reader = byteStream.getReader();
	let responseClosed = false;
	const handleResponseClose = () => {
		responseClosed = true;
		void reader.cancel("HTTP response closed").catch(() => undefined);
	};
	response.once("close", handleResponseClose);
	response.once("error", handleResponseClose);

	return (async () => {
		try {
			while (!responseClosed) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (!response.write(value)) {
					if (responseClosed || response.destroyed) {
						break;
					}
					const shouldContinue = await waitForResponseDrain(response);
					if (!shouldContinue) {
						break;
					}
				}
			}
		} finally {
			response.off("close", handleResponseClose);
			response.off("error", handleResponseClose);
			if (!responseClosed && !response.writableEnded && !response.destroyed) {
				response.end();
			}
		}
	})().catch(() => {
		if (!response.writableEnded && !response.destroyed) {
			response.end();
		}
	});
};
