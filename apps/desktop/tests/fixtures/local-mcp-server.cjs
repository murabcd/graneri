const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync("server.pid", String(process.pid));
const mode = process.argv[2];
if (mode === "malformed") console.log("not json");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	if (request.id === undefined) return;
	let result;
	switch (request.method) {
		case "initialize":
			result = {
				protocolVersion: request.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "fixture", version: "1" },
			};
			break;
		case "tools/list":
			result = {
				tools: [
					{
						name: request.params?.cursor ? "second" : "echo",
						description: "Echo text",
						inputSchema: {
							type: "object",
							properties: { text: { type: "string" } },
							required: ["text"],
						},
					},
				],
				...(!request.params?.cursor && { nextCursor: "page-2" }),
			};
			break;
		case "tools/call":
			if (mode === "hang") return;
			fs.appendFileSync("calls", "once\n");
			if (mode === "crash") process.exit(1);
			result = {
				content: [
					{
						type: "text",
						text:
							mode === "flood"
								? "x".repeat(1_100_000)
								: mode === "large"
									? "x".repeat(130_000)
									: request.params.arguments.text,
					},
				],
				isError: false,
			};
			break;
		default:
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } })}\n`,
			);
			return;
	}
	process.stdout.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
	);
});
