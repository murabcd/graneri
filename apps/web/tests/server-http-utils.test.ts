import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readJsonBody, sendJson } from "../server/http-utils";

const createRequest = (body: string) =>
	Readable.from(body ? [Buffer.from(body)] : []) as IncomingMessage;

const createResponse = () => {
	const headers = new Map<string, string>();
	let body = "";
	const response = {
		statusCode: 0,
		setHeader: (name: string, value: string) => {
			headers.set(name, value);
		},
		end: (value: string) => {
			body = value;
		},
	} as unknown as ServerResponse;

	return {
		get body() {
			return body;
		},
		headers,
		response,
	};
};

describe("server HTTP utilities", () => {
	it("reads empty and JSON request bodies", async () => {
		await expect(readJsonBody(createRequest(""))).resolves.toEqual({});
		await expect(
			readJsonBody<{ value: string }>(createRequest('{"value":"ok"}')),
		).resolves.toEqual({ value: "ok" });
	});

	it("sends JSON responses with optional headers", () => {
		const result = createResponse();

		sendJson(result.response, 202, { ok: true }, { "X-Test": "yes" });

		expect(result.response.statusCode).toBe(202);
		expect(result.headers.get("Content-Type")).toBe("application/json");
		expect(result.headers.get("X-Test")).toBe("yes");
		expect(result.body).toBe('{"ok":true}');
	});
});
