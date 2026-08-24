export type ModelFileMedia =
	| { kind: "text"; mediaType: "text/plain; charset=utf-8" }
	| { kind: "image"; mediaType: string }
	| {
			format: "pdf" | "docx" | "xlsx" | "pptx";
			kind: "document";
			mediaType: string;
	  }
	| { kind: "archive" | "binary"; mediaType: string };

export declare const MAX_MODEL_FILE_BYTES: number;
export declare const MODEL_FILE_INPUT_ACCEPT: string;
export declare const detectModelFileMedia: (
	bytes: Uint8Array,
) => ModelFileMedia;
export declare const assertModelFileMedia: (
	bytes: Uint8Array,
) => Exclude<ModelFileMedia, { kind: "archive" | "binary" }>;
export declare const isModelFilePartMediaType: (
	mediaType: unknown,
) => mediaType is string;
export declare const decodeModelUtf8Range: (
	bytes: Uint8Array,
	options: { allowTrailingPartial: boolean },
) => { byteLength: number; text: string };
