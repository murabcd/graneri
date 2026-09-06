import { validateJSONRPCMessage } from "@ai-sdk/mcp";

const maxMessageBytes = 1_000_000;

export const createLocalMcpTransport = ({
	launchProcess,
	server,
	timeoutMs,
}) => {
	const controller = new AbortController();
	let child;
	let finished;
	let started = false;
	let buffer = Buffer.alloc(0);
	let stderr = "";
	const fail = (error) => {
		controller.abort();
		buffer = Buffer.alloc(0);
		transport.onerror?.(error);
	};
	const transport = {
		start: async () => {
			if (started) throw new Error("Local MCP transport already started.");
			started = true;
			child = await launchProcess({
				...server,
				timeoutMs,
				signal: controller.signal,
			});
			child.stdin.on("error", fail);
			child.stderr.on("data", (bytes) => {
				stderr = (stderr + bytes.toString("utf8")).slice(-4000);
			});
			child.stdout.on("data", (bytes) => {
				if (controller.signal.aborted) return;
				try {
					buffer = Buffer.concat([buffer, bytes]);
					for (
						let end = buffer.indexOf(10);
						end !== -1;
						end = buffer.indexOf(10)
					) {
						if (end > maxMessageBytes)
							throw new Error("Local MCP message exceeds 1 MB.");
						const message = validateJSONRPCMessage(
							JSON.parse(buffer.subarray(0, end).toString("utf8")),
						);
						buffer = buffer.subarray(end + 1);
						transport.onmessage?.(message);
					}
					if (buffer.length > maxMessageBytes)
						throw new Error("Local MCP message exceeds 1 MB.");
				} catch (error) {
					fail(error);
				}
			});
			finished = child.completed
				.then(
					(result) => {
						if (!controller.signal.aborted && result.status !== "completed")
							transport.onerror?.(
								new Error(
									`Local MCP process ${result.status}. ${stderr}`.trim(),
								),
							);
					},
					(error) => transport.onerror?.(error),
				)
				.finally(() => transport.onclose?.());
		},
		send: (message) =>
			new Promise((resolve, reject) => {
				if (!child || controller.signal.aborted) {
					reject(new Error("Local MCP transport is closed."));
					return;
				}
				const text = `${JSON.stringify(message)}\n`;
				if (Buffer.byteLength(text) > maxMessageBytes) {
					reject(new Error("Local MCP request exceeds 1 MB."));
					return;
				}
				child.stdin.write(text, (error) => (error ? reject(error) : resolve()));
			}),
		close: async () => {
			controller.abort();
			await finished;
			buffer = Buffer.alloc(0);
		},
	};
	return transport;
};
