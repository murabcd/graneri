---
name: artifact-presentations
description: Create or edit PPTX presentations with slide-specific narrative, density, layout, and speaker-note decisions.
---

# Presentations

Create a presentation that works as a sequence of slides, not a document split into pages:

- Establish a clear narrative arc before emitting `presentation_create`. Use title and section slides for transitions, content slides for one idea, and two-column slides only for a genuine comparison or parallel structure.
- Keep titles concise and visible. Prefer a small number of specific bullets over paragraphs; move supporting explanation into speaker notes.
- Use `presentation_edit` for an uploaded or previously generated PPTX. Copy its filename, media type, and Graneri storage id exactly. Apply only the requested insert, text-replacement, or deletion operations and preserve untouched slides.
- Use footer text consistently when requested. Do not claim support for arbitrary element movement, animations, embedded media, theme replacement, or master-slide editing.

The worker enforces slide-density bounds, reopens the PPTX, renders every slide, and rejects broken or blank output before publication.
