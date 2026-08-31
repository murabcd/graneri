import { ConvexError } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	MAX_NOTE_ATTACHMENTS,
	type NoteAttachmentAttributes,
	syncNoteAttachmentDocumentReferences,
} from "./noteAttachmentReferences";
import { syncNoteImageReferences } from "./noteImageReferences";

const MAX_IMAGES_PER_NOTE = 50;
const BLOCK_NODE_TYPES = new Set([
	"blockquote",
	"bulletList",
	"codeBlock",
	"heading",
	"horizontalRule",
	"image",
	"noteFile",
	"orderedList",
	"paragraph",
	"table",
	"taskList",
]);
const NOTE_NODE_TYPES = new Set([
	...BLOCK_NODE_TYPES,
	"doc",
	"hardBreak",
	"listItem",
	"tableCell",
	"tableHeader",
	"tableRow",
	"taskItem",
	"text",
]);
const NOTE_MARK_TYPES = new Set([
	"bold",
	"code",
	"italic",
	"link",
	"noteComment",
	"strike",
	"underline",
]);

const noteDocumentMarkSchema = z
	.object({
		type: z.string().min(1),
		attrs: z.record(z.string(), z.json()).optional(),
	})
	.strict();

type NoteDocumentAttribute =
	| null
	| boolean
	| number
	| string
	| NoteDocumentAttribute[]
	| { [key: string]: NoteDocumentAttribute };

type NoteDocumentNode = {
	type: string;
	attrs?: Record<string, NoteDocumentAttribute>;
	content?: NoteDocumentNode[];
	marks?: z.infer<typeof noteDocumentMarkSchema>[];
	text?: string;
};

const noteDocumentNodeSchema: z.ZodType<NoteDocumentNode> = z.lazy(() =>
	z
		.object({
			type: z.string().min(1),
			attrs: z.record(z.string(), z.json()).optional(),
			content: z.array(noteDocumentNodeSchema).optional(),
			marks: z.array(noteDocumentMarkSchema).optional(),
			text: z.string().optional(),
		})
		.strict(),
);

type NoteImageReference = {
	noteImageId: string;
	src: string;
};

type NoteCommentAnchor = {
	threadId: string;
	excerpt: string;
};

export type ParsedNoteDocument = {
	content: string;
	images: NoteImageReference[];
	attachments: NoteAttachmentAttributes[];
	commentAnchors: NoteCommentAnchor[];
};

export const getPersistedNoteDocument = async (
	ctx: QueryCtx | MutationCtx,
	noteId: Id<"notes">,
) =>
	await ctx.db
		.query("noteDocuments")
		.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
		.unique();

export const writePersistedNoteDocument = async ({
	ctx,
	note,
	document,
	searchableText,
	now,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	document: ParsedNoteDocument;
	searchableText: string;
	now: number;
}) => {
	const existing = await getPersistedNoteDocument(ctx, note._id);
	if (existing) {
		await ctx.db.patch(existing._id, {
			content: document.content,
			searchableText,
			updatedAt: now,
		});
		return existing._id;
	}

	return await ctx.db.insert("noteDocuments", {
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		workspaceId: note.workspaceId,
		noteId: note._id,
		content: document.content,
		searchableText,
		createdAt: note.createdAt,
		updatedAt: now,
	});
};

export const commitCurrentNoteDocument = async ({
	ctx,
	note,
	document,
	searchableText,
	now,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	document: ParsedNoteDocument;
	searchableText: string;
	now: number;
}) => {
	await writePersistedNoteDocument({
		ctx,
		note,
		document,
		searchableText,
		now,
	});
	await syncNoteDocumentState({
		ctx,
		note,
		revisionId: null,
		document,
	});
};

export const removePersistedNoteDocument = async (
	ctx: MutationCtx,
	noteId: Id<"notes">,
) => {
	const document = await getPersistedNoteDocument(ctx, noteId);
	if (document) {
		await ctx.db.delete(document._id);
	}
};

const invalidNoteDocument = (message: string): never => {
	throw new ConvexError({
		code: "INVALID_NOTE_DOCUMENT",
		message,
	});
};

const readPositiveIntegerAttribute = (
	node: NoteDocumentNode,
	attribute: "colspan" | "rowspan",
) => {
	const value = node.attrs?.[attribute] ?? 1;
	if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
		return value;
	}
	return invalidNoteDocument(`Table ${attribute} must be a positive integer.`);
};

const validateTable = (table: NoteDocumentNode) => {
	const rows = table.content;
	if (!rows?.length || rows.some((row) => row.type !== "tableRow")) {
		return invalidNoteDocument("Tables must contain at least one table row.");
	}

	const spanEndByColumn: number[] = [];
	let tableWidth: number | null = null;

	for (const [rowIndex, row] of rows.entries()) {
		const cells = row.content;
		if (
			!cells?.length ||
			cells.some(
				(cell) => cell.type !== "tableCell" && cell.type !== "tableHeader",
			)
		) {
			return invalidNoteDocument(
				"Table rows must contain at least one table cell or header.",
			);
		}

		const occupiedColumns = spanEndByColumn.map(
			(spanEnd) => spanEnd > rowIndex,
		);
		let columnIndex = 0;

		for (const cell of cells) {
			while (occupiedColumns[columnIndex]) {
				columnIndex += 1;
			}

			const colspan = readPositiveIntegerAttribute(cell, "colspan");
			const rowspan = readPositiveIntegerAttribute(cell, "rowspan");
			if (rowIndex + rowspan > rows.length) {
				invalidNoteDocument(
					"A table cell rowspan cannot extend past the table.",
				);
			}

			for (let offset = 0; offset < colspan; offset += 1) {
				const occupiedColumn = columnIndex + offset;
				if (occupiedColumns[occupiedColumn]) {
					invalidNoteDocument("Table cells cannot overlap.");
				}
				occupiedColumns[occupiedColumn] = true;
				spanEndByColumn[occupiedColumn] = rowIndex + rowspan;
			}
			columnIndex += colspan;
		}

		const rowWidth = occupiedColumns.lastIndexOf(true) + 1;
		if (
			rowWidth < 1 ||
			occupiedColumns.slice(0, rowWidth).some((occupied) => !occupied)
		) {
			invalidNoteDocument("Table rows cannot contain gaps.");
		}
		if (tableWidth === null) {
			tableWidth = rowWidth;
		} else if (rowWidth !== tableWidth) {
			invalidNoteDocument("Every table row must cover the same width.");
		}
	}
};

const validateNodeContent = (node: NoteDocumentNode) => {
	const children = node.content ?? [];
	if (!NOTE_NODE_TYPES.has(node.type)) {
		invalidNoteDocument(`Unsupported note node type: ${node.type}.`);
	}
	if (["doc", "blockquote", "tableCell", "tableHeader"].includes(node.type)) {
		if (
			!children.length ||
			children.some((child) => !BLOCK_NODE_TYPES.has(child.type))
		) {
			invalidNoteDocument(`${node.type} must contain note blocks.`);
		}
		return;
	}
	if (node.type === "paragraph" || node.type === "heading") {
		if (
			children.some(
				(child) => child.type !== "text" && child.type !== "hardBreak",
			)
		) {
			invalidNoteDocument(`${node.type} can only contain inline content.`);
		}
		return;
	}
	if (node.type === "codeBlock") {
		if (children.some((child) => child.type !== "text")) {
			invalidNoteDocument("Code blocks can only contain text.");
		}
		return;
	}
	if (node.type === "bulletList" || node.type === "orderedList") {
		if (
			!children.length ||
			children.some((child) => child.type !== "listItem")
		) {
			invalidNoteDocument(`${node.type} must contain list items.`);
		}
		return;
	}
	if (node.type === "taskList") {
		if (
			!children.length ||
			children.some((child) => child.type !== "taskItem")
		) {
			invalidNoteDocument("Task lists must contain task items.");
		}
		return;
	}
	if (node.type === "listItem") {
		if (
			children[0]?.type !== "paragraph" ||
			children.slice(1).some((child) => !BLOCK_NODE_TYPES.has(child.type))
		) {
			invalidNoteDocument("List items must start with a paragraph.");
		}
		return;
	}
	if (node.type === "taskItem") {
		if (
			children[0]?.type !== "paragraph" ||
			children.slice(1).some((child) => !BLOCK_NODE_TYPES.has(child.type))
		) {
			invalidNoteDocument("Task items must start with a paragraph.");
		}
		return;
	}
	if (
		["hardBreak", "horizontalRule", "image", "noteFile", "text"].includes(
			node.type,
		) &&
		children.length
	) {
		invalidNoteDocument(`${node.type} cannot contain child nodes.`);
	}
};

const collectDocumentState = ({
	node,
	parentType,
	images,
	attachments,
	commentAnchors,
}: {
	node: NoteDocumentNode;
	parentType: string | null;
	images: Map<string, string>;
	attachments: Map<string, NoteAttachmentAttributes>;
	commentAnchors: Map<string, string>;
}) => {
	validateNodeContent(node);

	if (node.type === "text") {
		if (!node.text) {
			invalidNoteDocument("Text nodes must contain text.");
		}
	} else if (node.text !== undefined) {
		invalidNoteDocument("Only text nodes can contain text.");
	}

	if (node.type === "table") {
		validateTable(node);
	} else if (node.type === "tableRow" && parentType !== "table") {
		invalidNoteDocument("Table rows must belong to a table.");
	} else if (
		(node.type === "tableCell" || node.type === "tableHeader") &&
		parentType !== "tableRow"
	) {
		invalidNoteDocument("Table cells must belong to a table row.");
	}

	if (node.type === "image") {
		const noteImageId = node.attrs?.noteImageId;
		const src = node.attrs?.src;
		if (
			typeof noteImageId !== "string" ||
			!noteImageId.trim() ||
			typeof src !== "string" ||
			!src.trim()
		) {
			throw new ConvexError({
				code: "INVALID_NOTE_IMAGE",
				message: "Note images must be uploaded before they are saved.",
			});
		}
		const existingSrc = images.get(noteImageId);
		if (existingSrc && existingSrc !== src) {
			throw new ConvexError({
				code: "INVALID_NOTE_IMAGE",
				message: "A note image cannot use multiple sources.",
			});
		}
		images.set(noteImageId, src);
	}

	if (node.type === "noteFile") {
		const noteAttachmentId = node.attrs?.noteAttachmentId;
		const filename = node.attrs?.filename;
		const mediaType = node.attrs?.mediaType;
		const sizeBytes = node.attrs?.sizeBytes;
		if (
			typeof noteAttachmentId !== "string" ||
			!noteAttachmentId.trim() ||
			typeof filename !== "string" ||
			!filename.trim() ||
			typeof mediaType !== "string" ||
			!mediaType.trim() ||
			typeof sizeBytes !== "number" ||
			!Number.isInteger(sizeBytes) ||
			sizeBytes < 0
		) {
			throw new ConvexError({
				code: "INVALID_NOTE_ATTACHMENT",
				message: "Note files must identify an uploaded attachment.",
			});
		}
		const attributes = {
			noteAttachmentId,
			filename,
			mediaType,
			sizeBytes,
		};
		const existing = attachments.get(noteAttachmentId);
		if (
			existing &&
			(existing.filename !== attributes.filename ||
				existing.mediaType !== attributes.mediaType ||
				existing.sizeBytes !== attributes.sizeBytes)
		) {
			throw new ConvexError({
				code: "INVALID_NOTE_ATTACHMENT",
				message: "A note file cannot use conflicting metadata.",
			});
		}
		attachments.set(noteAttachmentId, attributes);
	}

	if (node.text) {
		for (const mark of node.marks ?? []) {
			if (!NOTE_MARK_TYPES.has(mark.type)) {
				invalidNoteDocument(`Unsupported note mark type: ${mark.type}.`);
			}
			if (mark.type !== "noteComment") {
				continue;
			}
			const threadId = mark.attrs?.threadId;
			if (typeof threadId !== "string") {
				return invalidNoteDocument(
					"Comment marks must identify a comment thread.",
				);
			}
			if (!threadId.trim()) {
				return invalidNoteDocument(
					"Comment marks must identify a comment thread.",
				);
			}
			const normalizedThreadId = threadId;
			commentAnchors.set(
				normalizedThreadId,
				`${commentAnchors.get(normalizedThreadId) ?? ""}${node.text}`,
			);
		}
	}

	for (const child of node.content ?? []) {
		collectDocumentState({
			node: child,
			parentType: node.type,
			images,
			attachments,
			commentAnchors,
		});
	}
};

export const parseNoteDocument = (content: string): ParsedNoteDocument => {
	let rawDocument: unknown;
	try {
		rawDocument = JSON.parse(content) as unknown;
	} catch {
		invalidNoteDocument("Note content must be valid Tiptap JSON.");
	}

	const parsedDocument = noteDocumentNodeSchema.safeParse(rawDocument);
	if (!parsedDocument.success) {
		return invalidNoteDocument("Note content must be a Tiptap document.");
	}
	const document = parsedDocument.data;
	if (document.type !== "doc") {
		invalidNoteDocument("Note content must be a Tiptap document.");
	}
	if (!document.content?.length) {
		invalidNoteDocument("Note documents must contain at least one block.");
	}

	const images = new Map<string, string>();
	const attachments = new Map<string, NoteAttachmentAttributes>();
	const commentAnchors = new Map<string, string>();
	collectDocumentState({
		node: document,
		parentType: null,
		images,
		attachments,
		commentAnchors,
	});
	if (images.size > MAX_IMAGES_PER_NOTE) {
		throw new ConvexError({
			code: "TOO_MANY_NOTE_IMAGES",
			message: `A note can contain up to ${MAX_IMAGES_PER_NOTE} images.`,
		});
	}
	if (attachments.size > MAX_NOTE_ATTACHMENTS) {
		throw new ConvexError({
			code: "TOO_MANY_NOTE_ATTACHMENTS",
			message: `A note can contain up to ${MAX_NOTE_ATTACHMENTS} files.`,
		});
	}

	return {
		content: JSON.stringify(document),
		images: [...images].map(([noteImageId, src]) => ({ noteImageId, src })),
		attachments: [...attachments.values()],
		commentAnchors: [...commentAnchors].flatMap(([threadId, excerpt]) => {
			const trimmedExcerpt = excerpt.trim();
			return trimmedExcerpt ? [{ threadId, excerpt: trimmedExcerpt }] : [];
		}),
	};
};

export const appendNoteAttachments = (
	document: ParsedNoteDocument,
	attachments: NoteAttachmentAttributes[],
) => {
	if (attachments.length === 0) {
		return document;
	}
	const parsedDocument = noteDocumentNodeSchema.parse(
		JSON.parse(document.content) as unknown,
	);
	const content = [...(parsedDocument.content ?? [])];
	const trailingNode = content.at(-1);
	const trailingParagraph =
		trailingNode?.type === "paragraph" && !trailingNode.content?.length
			? content.pop()
			: { type: "paragraph" };
	content.push(
		...attachments.map((attributes) => ({
			type: "noteFile",
			attrs: attributes,
		})),
		trailingParagraph ?? { type: "paragraph" },
	);

	return parseNoteDocument(
		JSON.stringify({
			...parsedDocument,
			content,
		}),
	);
};

export const syncNoteDocumentState = async ({
	ctx,
	note,
	revisionId,
	document,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	revisionId: Id<"noteRevisions"> | null;
	document: ParsedNoteDocument;
}) => {
	await syncNoteImageReferences({
		ctx,
		note,
		revisionId,
		images: document.images,
	});
	await syncNoteAttachmentDocumentReferences({
		ctx,
		note,
		revisionId,
		attachments: document.attachments,
	});

	if (revisionId !== null) {
		return;
	}

	const activeAnchors = (
		await Promise.all(
			document.commentAnchors.map(async ({ threadId, excerpt }) => ({
				threadId: await ctx.db.normalizeId("noteCommentThreads", threadId),
				excerpt,
			})),
		)
	).flatMap(({ threadId, excerpt }) =>
		threadId ? [{ threadId, excerpt }] : [],
	);

	await ctx.runMutation(internal.noteComments.syncAnchorsForNote, {
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		workspaceId: note.workspaceId,
		noteId: note._id,
		activeAnchors,
	});
};
