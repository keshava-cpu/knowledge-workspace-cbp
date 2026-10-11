import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    docling_serve_url: str
    docling_api_key: str | None
    max_upload_bytes: int
    poll_interval_seconds: float
    job_timeout_seconds: float
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_persistence_enabled: bool = False
    temp_dir: Path | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            docling_serve_url=os.getenv(
                "DOCLING_SERVE_URL", "http://127.0.0.1:5001"
            ).rstrip("/"),
            docling_api_key=os.getenv("DOCLING_SERVE_API_KEY") or None,
            supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/") or None,
            supabase_publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY") or None,
            supabase_persistence_enabled=os.getenv(
                "SUPABASE_PERSISTENCE_ENABLED", "false"
            ).lower()
            in {"1", "true", "yes", "on"},
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024))),
            poll_interval_seconds=float(
                os.getenv("DOCLING_POLL_INTERVAL_SECONDS", "2")
            ),
            job_timeout_seconds=float(
                os.getenv("DOCLING_JOB_TIMEOUT_SECONDS", "1800")
            ),
            temp_dir=Path(os.environ["UPLOAD_TEMP_DIR"])
            if os.getenv("UPLOAD_TEMP_DIR")
            else None,
        )