from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from pypdf import PdfReader, PdfWriter

from .document_author import create_document
from .process import convert_with_libreoffice


def _append_document_pages(writer: PdfWriter, edit: dict[str, Any]) -> None:
    with TemporaryDirectory(prefix="pdf-append-") as directory:
        working_directory = Path(directory)
        docx_path = working_directory / "appendix.docx"
        create_document(
            {
                "blocks": edit["blocks"],
                "orientation": "portrait",
                "pageSize": "a4",
                "title": edit["title"],
            },
            docx_path,
        )
        pdf_path = convert_with_libreoffice(docx_path, working_directory, "pdf")
        for page in PdfReader(pdf_path).pages:
            writer.add_page(page)


def edit_pdf(source: Path, edits: list[dict[str, Any]], destination: Path) -> None:
    pages = list(PdfReader(source).pages)
    append_edits: list[dict[str, Any]] = []
    for edit in edits:
        edit_type = edit["type"]
        if edit_type == "append_pages":
            append_edits.append(edit)
        elif edit_type == "delete_pages":
            page_indexes = {number - 1 for number in edit["pageNumbers"]}
            if any(index < 0 or index >= len(pages) for index in page_indexes):
                raise ValueError("A PDF page selected for deletion does not exist.")
            pages = [
                page for index, page in enumerate(pages) if index not in page_indexes
            ]
        elif edit_type == "reorder_pages":
            page_indexes = [number - 1 for number in edit["pageNumbers"]]
            if sorted(page_indexes) != list(range(len(pages))):
                raise ValueError("PDF reorder_pages must list every page exactly once.")
            pages = [pages[index] for index in page_indexes]
        else:
            raise ValueError(f"Unsupported PDF edit: {edit_type}")

    writer = PdfWriter()
    for page in pages:
        writer.add_page(page)
    for append_edit in append_edits:
        _append_document_pages(writer, append_edit)
    if len(writer.pages) == 0:
        raise ValueError("A PDF must contain at least one page.")
    with destination.open("wb") as output:
        writer.write(output)
