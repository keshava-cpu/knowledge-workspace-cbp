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
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_max_tokens: int = 256
    embedding_batch_size: int = 32
    # ── Optional FreeLLMAPI gateway ──────────────────────────────────────────
    # Run your local gateway at http://127.0.0.1:3001 (or another host).
    # Never expose these values in VITE_* env vars or the frontend bundle.
    # The gateway is NOT reachable from a separately-hosted backend via
    # localhost — document this limitation clearly to avoid confusion.
    freellmapi_base_url: str | None = None
    freellmapi_api_key: str | None = None
    freellmapi_chat_model: str = "gpt-4o-mini"
    freellmapi_enabled: bool = False
    # ── Optional external GPU providers (disabled by default) ────────────────
    huggingface_space_url: str | None = None
    huggingface_api_key: str | None = None
    lightning_ai_api_key: str | None = None
    lightning_ai_endpoint: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        freellmapi_base_url = os.getenv("FREELLMAPI_BASE_URL", "").strip() or None
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
            embedding_model=os.getenv(
                "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
            ),
            embedding_max_tokens=int(os.getenv("EMBEDDING_MAX_TOKENS", "256")),
            embedding_batch_size=int(os.getenv("EMBEDDING_BATCH_SIZE", "32")),
            freellmapi_base_url=freellmapi_base_url,
            freellmapi_api_key=os.getenv("FREELLMAPI_API_KEY") or None,
            freellmapi_chat_model=os.getenv("FREELLMAPI_CHAT_MODEL", "gpt-4o-mini"),
            freellmapi_enabled=bool(freellmapi_base_url)
            and os.getenv("FREELLMAPI_ENABLED", "false").lower() in {"1", "true", "yes", "on"},
            huggingface_space_url=os.getenv("HF_SPACE_URL") or None,
            huggingface_api_key=os.getenv("HF_API_KEY") or None,
            lightning_ai_api_key=os.getenv("LIGHTNING_AI_API_KEY") or None,
            lightning_ai_endpoint=os.getenv("LIGHTNING_AI_ENDPOINT") or None,
        )