from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings


class InvalidAccessToken(Exception):
    pass


class SupabaseAuthUnavailable(Exception):
    pass


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None = None
    access_token: str | None = None


class SupabaseAuthVerifier:
    """Validate access tokens with the project's Auth server, not client claims."""

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport
        self.timeout = httpx.Timeout(connect=5, read=10, write=5, pool=5)

    async def verify_access_token(self, access_token: str) -> AuthenticatedUser:
        if not self.settings.supabase_url or not self.settings.supabase_publishable_key:
            raise SupabaseAuthUnavailable("Supabase Auth is not configured on the server.")

        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                transport=self.transport,
            ) as client:
                response = await client.get(
                    f"{self.settings.supabase_url}/auth/v1/user",
                    headers={
                        "apikey": self.settings.supabase_publishable_key,
                        "Authorization": f"Bearer {access_token}",
                    },
                )
        except httpx.RequestError as exc:
            raise SupabaseAuthUnavailable("Could not reach Supabase Auth.") from exc

        if response.status_code in {401, 403}:
            raise InvalidAccessToken("Your session is invalid or has expired. Please sign in again.")
        if response.status_code >= 500 or response.status_code == 429:
            raise SupabaseAuthUnavailable("Supabase Auth is temporarily unavailable.")
        if not response.is_success:
            raise SupabaseAuthUnavailable(
                f"Supabase Auth returned HTTP {response.status_code}."
            )

        try:
            payload: Any = response.json()
        except ValueError as exc:
            raise SupabaseAuthUnavailable("Supabase Auth returned an invalid response.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
            raise InvalidAccessToken("Supabase Auth returned no verified user identity.")

        email = payload.get("email")
        return AuthenticatedUser(
            id=payload["id"],
            email=email if isinstance(email, str) else None,
            access_token=access_token,
        )
