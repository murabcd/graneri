from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, cast

from jsonschema import Draft202012Validator
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, JsonValue, model_validator

ARTIFACT_MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
OPERATION_SCHEMA_PATH = Path(__file__).with_name("artifact_operation.schema.json")
OPERATION_VALIDATOR = Draft202012Validator(
    json.loads(OPERATION_SCHEMA_PATH.read_text(encoding="utf-8"))
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SourceDownload(StrictModel):
    download_url: HttpUrl = Field(alias="downloadUrl")
    filename: str = Field(min_length=1, max_length=240)
    media_type: str = Field(min_length=1, max_length=200, alias="mediaType")
    storage_id: str = Field(min_length=1, max_length=200, alias="storageId")


class UploadTarget(StrictModel):
    filename: str = Field(min_length=1, max_length=240)
    format: Literal["docx", "pdf", "pptx", "xlsx"]
    media_type: str = Field(min_length=1, max_length=200, alias="mediaType")
    upload_url: HttpUrl = Field(alias="uploadUrl")

    @model_validator(mode="after")
    def validate_media_type(self) -> UploadTarget:
        if self.media_type != ARTIFACT_MEDIA_TYPES[self.format]:
            raise ValueError("Output media type does not match its format.")
        return self


class ArtifactWorkerRequest(StrictModel):
    callback_token: str = Field(min_length=32, max_length=256, alias="callbackToken")
    callback_url: HttpUrl = Field(alias="callbackUrl")
    job_id: str = Field(min_length=1, max_length=200, alias="jobId")
    operation: dict[str, JsonValue]
    sources: list[SourceDownload] = Field(max_length=4)
    uploads: list[UploadTarget] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def validate_request_contract(self) -> ArtifactWorkerRequest:
        OPERATION_VALIDATOR.validate(self.operation)
        filenames = [upload.filename for upload in self.uploads]
        if len(filenames) != len(set(filenames)):
            raise ValueError("Output filenames must be unique.")
        storage_ids = [source.storage_id for source in self.sources]
        if len(storage_ids) != len(set(storage_ids)):
            raise ValueError("Source storage ids must be unique.")

        operation_source_value = self.operation.get("source")
        if operation_source_value is None:
            if self.sources:
                raise ValueError("Create operations must not include source downloads.")
            return self
        operation_source = cast(dict[str, JsonValue], operation_source_value)
        if len(self.sources) != 1:
            raise ValueError("Edit operations require exactly one source download.")
        source = self.sources[0]
        if (
            operation_source["filename"] != source.filename
            or operation_source["mediaType"] != source.media_type
            or operation_source["storageId"] != source.storage_id
        ):
            raise ValueError("Source download does not match the edit operation.")
        return self


class UploadedArtifact(StrictModel):
    filename: str
    media_type: str = Field(alias="mediaType")
    sha256: str
    size_bytes: int = Field(ge=0, alias="sizeBytes")
    storage_id: str = Field(alias="storageId")


class ArtifactWorkerCallback(StrictModel):
    callback_token: str = Field(alias="callbackToken")
    job_id: str = Field(alias="jobId")
    outputs: list[UploadedArtifact] = Field(min_length=1, max_length=4)
    status: Literal["completed"] = "completed"


class ArtifactWorkerFailureCallback(StrictModel):
    callback_token: str = Field(alias="callbackToken")
    error_text: str = Field(min_length=1, max_length=500, alias="errorText")
    job_id: str = Field(alias="jobId")
    outputs: list[UploadedArtifact] = Field(max_length=4)
    status: Literal["failed"] = "failed"


class WorkerAccepted(StrictModel):
    job_id: str = Field(alias="jobId")
    output_count: int = Field(ge=1, le=4, alias="outputCount")
