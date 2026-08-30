from __future__ import annotations

import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory


class ArtifactProcessError(RuntimeError):
    pass


def _run_trusted_command(
    command: list[str], timeout_seconds: int = 90
) -> subprocess.CompletedProcess[str]:
    try:
        # Every caller constructs a fixed argv for an installed binary. User content is
        # passed only as a schema-validated path argument; no shell is involved.
        return subprocess.run(  # noqa: S603
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise ArtifactProcessError(f"Artifact process failed: {command[0]}") from error


def convert_with_libreoffice(
    source: Path, destination_dir: Path, output_format: str
) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="lo-profile-") as profile_directory:
        _run_trusted_command(
            [
                "soffice",
                "--headless",
                f"-env:UserInstallation=file://{profile_directory}",
                "--convert-to",
                output_format,
                "--outdir",
                str(destination_dir),
                str(source),
            ]
        )
    converted = destination_dir / f"{source.stem}.{output_format}"
    if not converted.is_file() or converted.stat().st_size == 0:
        raise ArtifactProcessError("LibreOffice did not produce the requested output.")
    return converted


def render_pdf(source: Path, destination_prefix: Path) -> None:
    _run_trusted_command(
        [
            "pdftoppm",
            "-png",
            "-r",
            "120",
            str(source),
            str(destination_prefix),
        ]
    )
