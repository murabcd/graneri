import type { ToolExecutionOptions, ToolSet } from "ai";
import type {
	ArtifactAuthoringInput,
	ArtifactToolOutput,
} from "./artifact-authoring-contract.mjs";

export type AuthorArtifact = (args: {
	idempotencyKey: ToolExecutionOptions<never>["toolCallId"];
	input: ArtifactAuthoringInput;
}) => Promise<ArtifactToolOutput>;

export declare const createArtifactAuthoringTools: (args: {
	authorArtifact: AuthorArtifact;
}) => ToolSet;
