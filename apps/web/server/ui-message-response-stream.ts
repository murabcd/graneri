import type { ServerResponse } from "node:http";
import {
	JsonToSseTransformStream,
	UI_MESSAGE_STREAM_HEADERS,
	type UIMessageChunk,
} from "ai";

const waitForResponseDrain = (response: ServerResponse) =>
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

const applyUiMessageStreamHeaders = (response: ServerResponse) => {
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
	response: ServerResponse;
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
