# Artifact authoring

Artifact authoring turns one assistant tool operation into one or more immutable, exact-download files while keeping storage ownership, execution, validation, and retries behind a small server-owned interface.

## Public assistant contract

`author_artifact` is the only model-facing tool for DOCX, PDF, XLSX, and PPTX creation, editing, and DOCX-to-PDF export.

[artifact-authoring-contract.mjs](../packages/ai/src/artifact-authoring-contract.mjs) owns its bounded discriminated input, canonical MIME types, source references, and multi-output result. [artifact-authoring-tool.mjs](../packages/ai/src/artifact-authoring-tool.mjs) owns request detection and the instruction that requires structured content or explicit edit operations instead of generated code.

One call may return multiple final artifacts when they represent the same authoring operation, such as a DOCX plus its PDF export. Each artifact is shown and downloaded independently; download never performs a conversion. Uploaded files and previous assistant artifacts use the same Convex storage id reference. Every edit writes a new output and never mutates the source bytes.

## Durable ownership and execution

Convex owns authorization, durable idempotency, source access, short-lived upload URLs, final metadata, and chat lifetime references.

The assistant action creates or reuses a job keyed to the tool call, resolves only storage files already owned by the chat, and invokes the worker with URLs instead of transporting file bytes through function arguments. The authenticated worker callback is the normal terminal boundary; completion publishes validated metadata, while failure records the error and deletes any partial uploads. Definite request-layer rejection terminates the job directly, while an ambiguous transport or server failure waits for the durable callback instead of reporting a false failure. A retry reads the terminal job instead of producing another output.

The worker is a separate Vercel Fluid Compute container rooted at `apps/artifact-worker`. `Dockerfile.vercel` pins the Python runtime and application libraries and installs LibreOffice, Poppler, and fonts. The worker executes only Graneri-owned authoring modules. Model-written Python, JavaScript, shell, macros, and arbitrary commands are never accepted as inputs.

The container is a normal Vercel Function deployment, not Vercel Sandbox. Sites is unrelated and remains outside artifact authoring. Desktop `just-bash` remains the local virtual-shell capability described in [[desktop-ai]] and is neither an authoring engine nor a fallback. There is no desktop Office/Python path or compatibility adapter.

## Format modules

The worker separates document, spreadsheet, presentation, PDF, validation, process, and network ownership:

- `document_author.py` creates DOCX and applies bounded append, title, and text-replacement edits; `document_export` is the explicit no-edit LibreOffice path from an owned DOCX to one PDF.
- `spreadsheet_author.py` creates or edits XLSX with formulas preserved, styled headers, readable widths, frozen rows, filters, and bounded native charts; row appends extend existing end-of-data chart ranges.
- `presentation_author.py` creates or edits PPTX using stable layouts and density-based text sizing.
- `pdf_author.py` performs PDF page operations and appends newly authored pages without claiming arbitrary text reflow support.
- `validation.py` reopens every final artifact structurally, converts Office artifacts with LibreOffice, renders every PDF page or slide with Poppler, checks dimensions and blank renders, and rejects formula-error literals.
- `network.py` streams size-bounded storage downloads, retries safe downloads and idempotent terminal callbacks, and never retries an output upload after an ambiguous transport failure.

## Validation and visibility

Validation rejects malformed operations and broken or blank files before an artifact becomes visible in chat.

Input validation happens before execution in the shared tool schema and again at the authenticated worker boundary. The worker operation JSON Schema is generated from that Zod contract and `@workspace/ai` checks that the committed schema is current, so Python does not maintain a second operation definition. Downloaded sources receive a structural and workload preflight before an edit module opens them. Output filenames, extensions, formats, counts, OOXML package structure, page or slide counts, formulas, conversions, and rendered images are validated. Spreadsheet work is bounded to 20 sheets and 250,000 cells, presentations to 100 slides with layout-safe text density, and PDFs to 200 pages. Transient network operations receive bounded retries. Intermediate DOCX/PDF conversions, render images, profiles, logs, and failed attempts stay internal and are removed with the request workspace.

Only successfully uploaded and callback-confirmed files enter the tool output. [[convex/chatAttachmentReferences.ts]] retains their storage bytes through saved messages and branches and removes the bytes after the final owning chat reference retires. The UI consumes the shared multi-artifact result, previews images, and uses the canonical download helper to save exactly the selected file under its authored filename.

The repository CI builds the same pinned container, runs Ruff against the worker boundary and modules, and executes structural plus rendered DOCX/PDF/XLSX/PPTX tests inside that image. Vercel deployment uses `apps/artifact-worker` as a separate project root so the web application never installs LibreOffice or Python authoring libraries.

The dedicated worker project must accept server-to-server traffic without Vercel browser-login protection because Convex is its caller. `/author` remains closed by the shared `ARTIFACT_WORKER_SECRET`; the public `/health` route contains no user or deployment data.
