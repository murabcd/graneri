from __future__ import annotations

import hashlib
from pathlib import Path
from time import sleep

import httpx

from .contracts import (
    ArtifactWorkerCallback,
    ArtifactWorkerFailureCallback,
    SourceDownload,
    UploadedArtifact,
    UploadTarget,
)

REQUEST_TIMEOUT_SECONDS = 120.0
NETWORK_ATTEMPTS = 3
MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
RETRYABLE_STATUS_CODES = {408, 425, 429}


def _is_retryable_http_error(error: httpx.HTTPError) -> bool:
    return not isinstance(error, httpx.HTTPStatusError) or (
        error.response.status_code in RETRYABLE_STATUS_CODES
        or error.response.status_code >= 500
    )


def _request_with_retry(
    method: str,
    url: str,
    *,
    attempts: int = NETWORK_ATTEMPTS,
    **kwargs: object,
) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = httpx.request(
                method,
                url,
                follow_redirects=True,
                timeout=REQUEST_TIMEOUT_SECONDS,
                **kwargs,
            )
            response.raise_for_status()
            return response
        except (httpx.HTTPError, OSError) as error:
            last_error = error
            if (
                isinstance(error, OSError) or _is_retryable_http_error(error)
            ) and attempt + 1 < attempts:
                sleep(0.4 * (2**attempt))
                continue
            break
    raise RuntimeError("Artifact network operation failed.") from last_error


def download_source(source: SourceDownload, destination: Path) -> None:
    last_error: Exception | None = None
    for attempt in range(NETWORK_ATTEMPTS):
        try:
            with httpx.stream(
                "GET",
                str(source.download_url),
                follow_redirects=True,
                timeout=REQUEST_TIMEOUT_SECONDS,
            ) as response:
                response.raise_for_status()
                declared_size = response.headers.get("Content-Length")
                if declared_size and int(declared_size) > MAX_ARTIFACT_BYTES:
                    raise ValueError("Artifact source exceeds the 50 MiB limit.")
                size = 0
                with destination.open("wb") as output:
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > MAX_ARTIFACT_BYTES:
                            raise ValueError(
                                "Artifact source exceeds the 50 MiB limit."
                            )
                        output.write(chunk)
            return
        except ValueError:
            destination.unlink(missing_ok=True)
            raise
        except (httpx.HTTPError, OSError) as error:
            destination.unlink(missing_ok=True)
            last_error = error
            if (
                isinstance(error, OSError) or _is_retryable_http_error(error)
            ) and attempt + 1 < NETWORK_ATTEMPTS:
                sleep(0.4 * (2**attempt))
                continue
            break
    raise RuntimeError("Artifact download failed after retries.") from last_error


def upload_artifact(target: UploadTarget, path: Path) -> UploadedArtifact:
    content = path.read_bytes()
    if len(content) > MAX_ARTIFACT_BYTES:
        raise ValueError("Artifact output exceeds the 50 MiB limit.")
    response = _request_with_retry(
        "POST",
        str(target.upload_url),
        attempts=1,
        content=content,
        headers={"Content-Type": target.media_type},
    )
    payload = response.json()
    storage_id = payload.get("storageId")
    if not isinstance(storage_id, str) or not storage_id:
        raise RuntimeError("Artifact upload did not return a storage id.")
    return UploadedArtifact(
        filename=target.filename,
        media_type=target.media_type,
        sha256=hashlib.sha256(content).hexdigest(),
        size_bytes=len(content),
        storage_id=storage_id,
    )


def complete_job(
    callback_url: str,
    callback_token: str,
    job_id: str,
    outputs: list[UploadedArtifact],
    worker_secret: str,
) -> None:
    callback = ArtifactWorkerCallback(
        callback_token=callback_token,
        job_id=job_id,
        outputs=outputs,
    )
    _request_with_retry(
        "POST",
        callback_url,
        content=callback.model_dump_json(by_alias=True).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {worker_secret}",
            "Content-Type": "application/json",
        },
    )


def fail_job(
    callback_url: str,
    callback_token: str,
    error_text: str,
    job_id: str,
    outputs: list[UploadedArtifact],
    worker_secret: str,
) -> None:
    callback = ArtifactWorkerFailureCallback(
        callback_token=callback_token,
        error_text=error_text[:500],
        job_id=job_id,
        outputs=outputs,
    )
    _request_with_retry(
        "POST",
        callback_url,
        content=callback.model_dump_json(by_alias=True).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {worker_secret}",
            "Content-Type": "application/json",
        },
    )
