from __future__ import annotations

import hmac
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, Header, HTTPException, status

from .authoring import author_artifacts
from .contracts import ArtifactWorkerRequest, UploadedArtifact, WorkerAccepted
from .network import complete_job, fail_job, upload_artifact
from .process import ArtifactProcessError

app = FastAPI(docs_url=None, redoc_url=None, title="Graneri Artifact Worker")


def _failure_message(error: Exception) -> str:
    if isinstance(error, (ArtifactProcessError, ValueError)):
        return f"Artifact authoring failed: {error}"
    return "Artifact authoring failed before completion."


def _worker_secret() -> str:
    secret = os.environ.get("ARTIFACT_WORKER_SECRET", "").strip()
    if len(secret) < 32:
        raise RuntimeError(
            "ARTIFACT_WORKER_SECRET must contain at least 32 characters."
        )
    return secret


def _authorize(authorization: str | None) -> str:
    expected = f"Bearer {_worker_secret()}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )
    return expected.removeprefix("Bearer ")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/author", response_model=WorkerAccepted)
def author(
    request: ArtifactWorkerRequest,
    authorization: str | None = Header(default=None),
) -> WorkerAccepted:
    worker_secret = _authorize(authorization)
    uploaded: list[UploadedArtifact] = []
    try:
        with TemporaryDirectory(prefix="graneri-artifact-") as directory:
            outputs = author_artifacts(request, Path(directory))
            for target in request.uploads:
                uploaded.append(upload_artifact(target, outputs[target.filename]))
            complete_job(
                str(request.callback_url),
                request.callback_token,
                request.job_id,
                uploaded,
                worker_secret,
            )
            return WorkerAccepted(job_id=request.job_id, output_count=len(uploaded))
    except Exception as error:
        fail_job(
            str(request.callback_url),
            request.callback_token,
            _failure_message(error),
            request.job_id,
            uploaded,
            worker_secret,
        )
        raise
