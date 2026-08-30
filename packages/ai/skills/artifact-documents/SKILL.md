---
name: artifact-documents
description: Create, edit, or export DOCX documents and flowing PDF documents with document-specific structure and output handling.
---

# Documents

Use the document operation that preserves the user's requested format and source:

- Create a complete, coherent document with `document_create`. `document.title` is rendered as the title, so do not repeat the same text as the first heading unless the user explicitly wants both.
- Edit an uploaded or previously generated DOCX with `document_edit`. Copy its filename, media type, and Graneri storage id exactly. Apply only the requested `append_blocks`, `replace_text`, or `set_title` operations; do not rebuild unchanged content.
- Convert an unchanged DOCX to PDF with `document_export`. If the user requests authored content as both DOCX and PDF, create both outputs in the same document operation.
- Choose A4 or Letter and portrait or landscape from the user's context. Use headings, short paragraphs, lists, page breaks, and tables intentionally. Every table row must contain exactly one value per header.
- Produce finished content rather than an outline or instructions for creating the document. Do not claim support for tracked changes, comments, forms, macros, or arbitrary layout edits.

The worker validates the final OOXML package and rendered output before the file is published.
