import { type IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { vi } from "vitest";

export const createTestServerResponse = () => {
	const response = new ServerResponse(Readable.from([]) as IncomingMessage);
	const chunks: string[] = [];
	const end = vi.fn();
	const setHeader = vi.fn();

	response.end = end;
	response.flushHeaders = vi.fn();
	response.setHeader = setHeader;
	response.write = vi.fn((chunk: string) => {
		chunks.push(chunk);
		return true;
	});

	return { chunks, end, response, setHeader };
};
