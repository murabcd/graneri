import type { Tool, ToolExecutionOptions } from "ai";
import type {
	ArtifactAuthoringInput,
	ArtifactToolOutput,
} from "./artifact-authoring-contract.mjs";

export type AuthorArtifact = (args: {
	idempotencyKey: ToolExecutionOptions<never>["toolCallId"];
	input: ArtifactAuthoringInput;
}) => Promise<ArtifactToolOutput>;

export declare const createArtifactAuthoringTool: (args: {
	authorArtifact: AuthorArtifact;
}) => Tool;
