from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from src.contracts import UploadTarget
from src.network import upload_artifact


class ArtifactNetworkTest(unittest.TestCase):
    def test_does_not_retry_an_ambiguous_output_upload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "report.pdf"
            artifact.write_bytes(b"artifact")
            target = UploadTarget(
                filename="report.pdf",
                format="pdf",
                media_type="application/pdf",
                upload_url="https://example.com/upload",
            )
            request = httpx.Request("POST", "https://example.com/upload")
            with patch(
                "src.network.httpx.request",
                side_effect=httpx.ConnectError("connection lost", request=request),
            ) as request_mock:
                with self.assertRaisesRegex(
                    RuntimeError, "Artifact network operation failed"
                ):
                    upload_artifact(target, artifact)

            request_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
