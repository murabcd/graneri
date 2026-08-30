---
name: artifact-pdf
description: Create flowing PDFs through document authoring, export DOCX files to PDF, or apply supported page-level edits to existing PDFs.
---

# PDF

Choose the PDF path from the requested outcome:

- For a newly authored flowing PDF, use `document_create` with a PDF output. Return both DOCX and PDF only when the user asks for both.
- For an unchanged DOCX conversion, use `document_export`; do not invent an edit.
- For an uploaded or previously generated PDF, use `pdf_edit`. Copy its filename, media type, and Graneri storage id exactly. Supported edits are page deletion, explicit page reordering, and appending newly authored pages.
- Treat `reorder_pages.pageNumbers` as the complete desired page order. Do not claim support for arbitrary in-place PDF text replacement, redaction, annotations, forms, signatures, OCR, or flattening.
- Use document blocks to structure appended pages and keep the requested output filename ending in `.pdf`.

The worker validates page counts and dimensions and renders every page before publishing the PDF.
