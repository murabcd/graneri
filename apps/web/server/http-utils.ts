import type { IncomingMessage, ServerResponse } from "node:http";

export type JsonValue =
	| boolean
	| null
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue | undefined };

export const readJsonBody = async <TBody>(request: IncomingMessage) => {
	const chunks: Uint8Array[] = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}

	const rawBody = Buffer.concat(chunks).toString("utf8");

	if (!rawBody) {
		return {} as TBody;
	}

	return JSON.parse(rawBody) as TBody;
};

export const sendJson = (
	response: ServerResponse,
	statusCode: number,
	payload: JsonObject,
	headers?: Record<string, string> | null,
) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	for (const [header, value] of Object.entries(headers ?? {})) {
		response.setHeader(header, value);
	}
	response.end(JSON.stringify(payload));
};
