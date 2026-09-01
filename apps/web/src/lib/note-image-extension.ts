import {
	getRenderedAttributes,
	mergeAttributes,
	ResizableNodeView,
	type ResizableNodeViewOptions,
} from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { NodeSelection } from "@tiptap/pm/state";

export const NOTE_IMAGE_ALIGNMENTS = ["left", "center", "right"] as const;

export type NoteImageAlignment = (typeof NOTE_IMAGE_ALIGNMENTS)[number];

type NoteImageCaptionUpdate = Partial<{
	caption: string;
	captionVisible: boolean;
}>;

const isNoteImageAlignment = (value: unknown): value is NoteImageAlignment =>
	typeof value === "string" &&
	NOTE_IMAGE_ALIGNMENTS.some((alignment) => alignment === value);

const setOptionalAttribute = (
	element: HTMLElement,
	name: string,
	value: unknown,
) => {
	if (typeof value === "string" && value.length > 0) {
		element.setAttribute(name, value);
		return;
	}

	element.removeAttribute(name);
};

export const NoteImage = Image.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			noteImageId: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-note-image-id"),
				renderHTML: (attributes) =>
					typeof attributes.noteImageId === "string" && attributes.noteImageId
						? { "data-note-image-id": attributes.noteImageId }
						: {},
			},
			align: {
				default: "left",
				parseHTML: (element) => {
					const value = element.getAttribute("data-align");
					return isNoteImageAlignment(value) ? value : "left";
				},
				renderHTML: (attributes) => ({
					"data-align": isNoteImageAlignment(attributes.align)
						? attributes.align
						: "left",
				}),
			},
			caption: {
				default: "",
				parseHTML: (element) => element.getAttribute("data-caption") ?? "",
				renderHTML: (attributes) =>
					typeof attributes.caption === "string" && attributes.caption
						? { "data-caption": attributes.caption }
						: {},
			},
			captionVisible: {
				default: false,
				parseHTML: (element) =>
					element.getAttribute("data-caption-visible") === "true",
				renderHTML: (attributes) =>
					attributes.captionVisible ? { "data-caption-visible": "true" } : {},
			},
		};
	},
	parseHTML() {
		return [{ tag: "img[data-note-image-id][src]" }];
	},
	addNodeView() {
		if (typeof document === "undefined") {
			return null;
		}

		return ({ node, getPos, HTMLAttributes, editor }) => {
			const figure = document.createElement("figure");
			figure.className = "note-image-node";
			figure.contentEditable = "false";

			const image = document.createElement("img");
			image.draggable = false;
			const mergedAttributes = mergeAttributes(
				this.options.HTMLAttributes,
				HTMLAttributes,
			);
			for (const [name, value] of Object.entries(mergedAttributes)) {
				if (value != null && !["src", "width", "height"].includes(name)) {
					image.setAttribute(name, String(value));
				}
			}

			const caption = document.createElement("input");
			caption.className = "note-image-caption";
			caption.type = "text";
			caption.placeholder = "Add a caption...";
			caption.setAttribute("aria-label", "Image caption");

			let currentNode = node;
			let previousHTMLAttributes = { ...HTMLAttributes };

			const updateNodeAttributes = (attributes: NoteImageCaptionUpdate) => {
				const position = getPos();
				if (position === undefined) {
					return;
				}

				const liveNode = editor.state.doc.nodeAt(position);
				if (!liveNode || liveNode.type.name !== this.name) {
					return;
				}

				const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
					...liveNode.attrs,
					...attributes,
				});
				editor.view.dispatch(transaction);
			};

			const syncNode = (updatedNode: typeof node) => {
				currentNode = updatedNode;
				const extensionAttributes = editor.extensionManager.attributes.filter(
					(attribute) => attribute.type === updatedNode.type.name,
				);
				const nextHTMLAttributes = getRenderedAttributes(
					updatedNode,
					extensionAttributes,
				);

				for (const name of Object.keys(previousHTMLAttributes)) {
					if (
						!["src", "width", "height"].includes(name) &&
						!(name in nextHTMLAttributes)
					) {
						image.removeAttribute(name);
					}
				}
				for (const [name, value] of Object.entries(nextHTMLAttributes)) {
					if (["src", "width", "height"].includes(name)) {
						continue;
					}
					if (value == null) {
						image.removeAttribute(name);
					} else {
						image.setAttribute(name, String(value));
					}
				}

				setOptionalAttribute(image, "src", updatedNode.attrs.src);
				setOptionalAttribute(image, "alt", updatedNode.attrs.alt);
				setOptionalAttribute(image, "title", updatedNode.attrs.title);
				if (typeof updatedNode.attrs.width === "number") {
					image.style.width = `${updatedNode.attrs.width}px`;
				} else {
					image.style.removeProperty("width");
				}
				if (typeof updatedNode.attrs.height === "number") {
					image.style.height = `${updatedNode.attrs.height}px`;
				} else {
					image.style.removeProperty("height");
				}

				figure.dataset.align = isNoteImageAlignment(updatedNode.attrs.align)
					? updatedNode.attrs.align
					: "left";
				const nextCaption =
					typeof updatedNode.attrs.caption === "string"
						? updatedNode.attrs.caption
						: "";
				if (caption.value !== nextCaption) {
					caption.value = nextCaption;
				}
				caption.hidden =
					!updatedNode.attrs.captionVisible ||
					(!editor.isEditable && nextCaption.trim().length === 0);
				caption.readOnly = !editor.isEditable;
				previousHTMLAttributes = nextHTMLAttributes;
			};

			const onUpdate: ResizableNodeViewOptions["onUpdate"] = (updatedNode) => {
				if (updatedNode.type !== currentNode.type) {
					return false;
				}
				syncNode(updatedNode);
				return true;
			};

			const resizableNodeView = editor.isEditable
				? new ResizableNodeView({
						element: image,
						editor,
						node,
						getPos,
						onResize: (width) => {
							image.style.width = `${width}px`;
							image.style.removeProperty("height");
						},
						onCommit: (width) => {
							const position = getPos();
							if (position === undefined) {
								return;
							}
							const liveNode = editor.state.doc.nodeAt(position);
							if (!liveNode || liveNode.type.name !== this.name) {
								return;
							}
							const transaction = editor.state.tr.setNodeMarkup(
								position,
								undefined,
								{
									...liveNode.attrs,
									width,
									height: null,
								},
							);
							transaction.setSelection(
								NodeSelection.create(transaction.doc, position),
							);
							editor.view.dispatch(transaction);
						},
						onUpdate,
						options: {
							directions: ["left", "right"],
							min: { width: 120, height: 80 },
							preserveAspectRatio: true,
							className: {
								container: "note-image-resize-container",
								wrapper: "note-image-resize-wrapper",
								handle: "note-image-resize-handle",
								resizing: "is-resizing",
							},
						},
					})
				: null;

			figure.append(resizableNodeView?.dom ?? image, caption);
			syncNode(node);

			const handleCaptionInput = () => {
				updateNodeAttributes({ caption: caption.value });
			};
			const handleCaptionBlur = () => {
				if (caption.value.trim().length === 0) {
					updateNodeAttributes({ caption: "", captionVisible: false });
				}
			};
			const handleCaptionKeyDown = (event: KeyboardEvent) => {
				if (event.key !== "Escape") {
					return;
				}
				event.preventDefault();
				caption.blur();
				const position = getPos();
				if (position !== undefined) {
					editor.commands.setNodeSelection(position);
					editor.commands.focus();
				}
			};
			caption.addEventListener("input", handleCaptionInput);
			caption.addEventListener("blur", handleCaptionBlur);
			caption.addEventListener("keydown", handleCaptionKeyDown);

			return {
				dom: figure,
				update: (updatedNode, decorations, innerDecorations) =>
					resizableNodeView
						? resizableNodeView.update(
								updatedNode,
								decorations,
								innerDecorations,
							)
						: onUpdate(updatedNode, decorations, innerDecorations),
				selectNode: () => figure.classList.add("ProseMirror-selectednode"),
				deselectNode: () => figure.classList.remove("ProseMirror-selectednode"),
				stopEvent: (event) => event.target === caption,
				ignoreMutation: () => true,
				destroy: () => {
					caption.removeEventListener("input", handleCaptionInput);
					caption.removeEventListener("blur", handleCaptionBlur);
					caption.removeEventListener("keydown", handleCaptionKeyDown);
					resizableNodeView?.destroy();
				},
			};
		};
	},
}).configure({
	allowBase64: false,
	HTMLAttributes: {
		decoding: "async",
		loading: "lazy",
	},
	inline: false,
});
