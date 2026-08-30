import type { Tool, ToolExecutionOptions, UIMessage } from "ai";
import type {
	ArtifactAuthoringInput,
	ArtifactToolOutput,
} from "./artifact-authoring-contract.mjs";

export type AuthorArtifact = (args: {
	idempotencyKey: ToolExecutionOptions<never>["toolCallId"];
	input: ArtifactAuthoringInput;
}) => Promise<ArtifactToolOutput>;

export declare const shouldEnableArtifactAuthoring: (
	message: UIMessage | null | undefined,
) => boolean;
export declare const buildArtifactAuthoringInstruction: (
	message: UIMessage | undefined,
) => string;
export declare const createArtifactAuthoringTool: (args: {
	authorArtifact: AuthorArtifact;
}) => Tool;
