import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { artifactAuthoringInputSchema } from "../src/artifact-authoring-contract.mjs";

const outputUrl = new URL(
	"../../../apps/artifact-worker/src/artifact_operation.schema.json",
	import.meta.url,
);
const serializedSchema = `${JSON.stringify(
	z.toJSONSchema(artifactAuthoringInputSchema, {
		target: "draft-2020-12",
	}),
	null,
	2,
)}\n`;

if (process.argv.includes("--check")) {
	const current = await readFile(outputUrl, "utf8").catch(() => "");
	if (current !== serializedSchema) {
		throw new Error(
			`Artifact worker schema is stale. Run: node ${fileURLToPath(import.meta.url)}`,
		);
	}
} else {
	await writeFile(outputUrl, serializedSchema, "utf8");
}
