from __future__ import annotations

from pathlib import Path
from typing import Any

from .contracts import ArtifactWorkerRequest, UploadTarget
from .document_author import create_document, edit_document
from .network import download_source
from .pdf_author import edit_pdf
from .presentation_author import create_presentation, edit_presentation
from .process import convert_with_libreoffice
from .spreadsheet_author import create_spreadsheet, edit_spreadsheet
from .validation import validate_artifact, validate_source_artifact

EXPECTED_EXTENSIONS = {
    "docx": ".docx",
    "pdf": ".pdf",
    "pptx": ".pptx",
    "xlsx": ".xlsx",
}


def _safe_filename(filename: str) -> str:
    if filename in {".", ".."} or Path(filename).name != filename:
        raise ValueError("Artifact filenames must not contain a path.")
    if "\x00" in filename:
        raise ValueError("Artifact filenames must not contain null bytes.")
    return filename


def _validate_upload_target(target: UploadTarget) -> None:
    filename = _safe_filename(target.filename)
    extension = EXPECTED_EXTENSIONS[target.format]
    if Path(filename).suffix.lower() != extension:
        raise ValueError(f"Artifact filename must end with {extension}.")


def _single_source(
    request: ArtifactWorkerRequest,
    expected_format: str,
    working_directory: Path,
) -> Path:
    if len(request.sources) != 1:
        raise ValueError("This artifact edit requires exactly one source file.")
    source = request.sources[0]
    extension = EXPECTED_EXTENSIONS[expected_format]
    if Path(source.filename).suffix.lower() != extension:
        raise ValueError(f"Artifact source must be a {extension} file.")
    _safe_filename(source.filename)
    source_directory = working_directory / "source"
    source_directory.mkdir()
    path = source_directory / f"input{extension}"
    download_source(source, path)
    validate_source_artifact(path, expected_format)
    return path


def _document_outputs(
    request: ArtifactWorkerRequest,
    operation: dict[str, Any],
    base_docx: Path,
    working_directory: Path,
) -> dict[str, Path]:
    requested_outputs = operation["outputs"]
    if len(requested_outputs) != len(request.uploads):
        raise ValueError("Document output slots do not match the requested outputs.")
    by_filename: dict[str, Path] = {}
    converted_pdf: Path | None = None
    for output in requested_outputs:
        filename = _safe_filename(output["filename"])
        format_name = output["format"]
        target = next(
            (upload for upload in request.uploads if upload.filename == filename),
            None,
        )
        if target is None or target.format != format_name:
            raise ValueError(
                "Document output slot does not match its requested format."
            )
        if format_name == "docx":
            destination = working_directory / filename
            destination.write_bytes(base_docx.read_bytes())
        elif format_name == "pdf":
            if converted_pdf is None:
                converted_pdf = convert_with_libreoffice(
                    base_docx, working_directory, "pdf"
                )
            destination = working_directory / filename
            if converted_pdf != destination:
                destination.write_bytes(converted_pdf.read_bytes())
        else:
            raise ValueError(f"Unsupported document output: {format_name}")
        by_filename[filename] = destination
    return by_filename


def _author_in_directory(
    request: ArtifactWorkerRequest,
    working_directory: Path,
) -> dict[str, Path]:
    operation = request.operation
    kind = operation["kind"]
    for upload in request.uploads:
        _validate_upload_target(upload)

    if kind == "document_create":
        base_docx = working_directory / "authored-document.docx"
        create_document(operation["document"], base_docx)
        return _document_outputs(request, operation, base_docx, working_directory)
    if kind == "document_edit":
        source = _single_source(request, "docx", working_directory)
        base_docx = working_directory / "edited-document.docx"
        edit_document(source, operation["edits"], base_docx)
        return _document_outputs(request, operation, base_docx, working_directory)
    if kind == "document_export":
        if len(operation["outputs"]) != 1 or operation["outputs"][0]["format"] != "pdf":
            raise ValueError("Document export requires one PDF output.")
        source = _single_source(request, "docx", working_directory)
        return _document_outputs(request, operation, source, working_directory)
    if kind == "spreadsheet_create":
        target = request.uploads[0]
        if len(request.uploads) != 1 or target.format != "xlsx":
            raise ValueError("Spreadsheet creation requires one XLSX output.")
        destination = working_directory / _safe_filename(operation["filename"])
        if destination.name != target.filename:
            raise ValueError("Spreadsheet filename does not match its output slot.")
        create_spreadsheet(operation["sheets"], destination)
        return {target.filename: destination}
    if kind == "spreadsheet_edit":
        target = request.uploads[0]
        source = _single_source(request, "xlsx", working_directory)
        destination = working_directory / _safe_filename(operation["filename"])
        if (
            len(request.uploads) != 1
            or target.format != "xlsx"
            or destination.name != target.filename
        ):
            raise ValueError("Spreadsheet edit requires one matching XLSX output.")
        edit_spreadsheet(source, operation["edits"], destination)
        return {target.filename: destination}
    if kind == "presentation_create":
        target = request.uploads[0]
        destination = working_directory / _safe_filename(operation["filename"])
        if (
            len(request.uploads) != 1
            or target.format != "pptx"
            or destination.name != target.filename
        ):
            raise ValueError("Presentation creation requires one matching PPTX output.")
        create_presentation(operation["presentation"], destination)
        return {target.filename: destination}
    if kind == "presentation_edit":
        target = request.uploads[0]
        source = _single_source(request, "pptx", working_directory)
        destination = working_directory / _safe_filename(operation["filename"])
        if (
            len(request.uploads) != 1
            or target.format != "pptx"
            or destination.name != target.filename
        ):
            raise ValueError("Presentation edit requires one matching PPTX output.")
        edit_presentation(source, operation["edits"], destination)
        return {target.filename: destination}
    if kind == "pdf_edit":
        target = request.uploads[0]
        source = _single_source(request, "pdf", working_directory)
        destination = working_directory / _safe_filename(operation["filename"])
        if (
            len(request.uploads) != 1
            or target.format != "pdf"
            or destination.name != target.filename
        ):
            raise ValueError("PDF edit requires one matching PDF output.")
        edit_pdf(source, operation["edits"], destination)
        return {target.filename: destination}
    raise ValueError(f"Unsupported artifact operation: {kind}")


def author_artifacts(
    request: ArtifactWorkerRequest,
    working_directory: Path,
) -> dict[str, Path]:
    outputs = _author_in_directory(request, working_directory)
    for target in request.uploads:
        output = outputs.get(target.filename)
        if output is None:
            raise ValueError(f"Artifact output is missing: {target.filename}")
        validate_artifact(output, target.format)
    return outputs
