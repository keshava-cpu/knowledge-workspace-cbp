# Knowledge Workspace

A React, TypeScript and Vite research workspace with a FastAPI document-ingestion service. Supabase Auth is the single identity provider for email/password and Google OAuth. PDF extraction is delegated to the official Docling Serve HTTP API.

## Requirements

- Node.js and npm
- Python 3.12 or newer
- Docker Desktop with its engine running, or a Docling Serve v1 instance
- A Supabase project for authentication

## Local setup

Install frontend packages and create the local environment files:

```powershell
npm install
Copy-Item .env.example .env.local
Copy-Item backend/.env.example backend/.env
```

Create and activate the backend environment:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/Activate.ps1
python -m pip install -r backend/requirements-dev.txt
```

Set the Supabase Project URL and publishable key in both local env files. Keep the values out of Git. `VITE_SUPABASE_PUBLISHABLE_KEY` is visible to the browser by design; it is not a secret key. Do not use or expose a Supabase secret/service-role key in Vite.

Root `.env.local`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
```

`backend/.env`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_PERSISTENCE_ENABLED=true
DOCLING_SERVE_URL=http://127.0.0.1:5001
```

The backend verifies each bearer token by requesting the authenticated user from Supabase Auth. It does not trust a frontend-supplied user ID. No service-role key is needed.

## Database migrations

The repository includes `supabase/config.toml` and versioned migrations under `supabase/migrations/`. They create the private PDF bucket, user-owned document metadata, processing jobs, persisted Docling extraction results, cancellation support, and secure self-service account deletion. RLS scopes table and Storage access to the authenticated user's ID.

Review the migration locally without changing the remote project:

```powershell
npx supabase migration list
npx supabase db lint --local
```

For a new remote project, sign in and link it before applying migrations. Do not run `db pull` unless the remote project already contains schema changes that are not in this repository:

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

The current migration chain includes the initial storage schema, the `cancelled` processing status, and the `delete_my_account()` RPC used by Settings. Use `npx supabase migration list --linked` to compare local and remote history.

`db push` is the deployment step. The linked project has the current migration chain applied. The migration creates the Storage bucket, so no separate bucket is required in the Dashboard. Keep it private and use object paths in the form `<auth-user-id>/<document-id>.pdf`.

Set `SUPABASE_PERSISTENCE_ENABLED=true` to use the integrated user-token-backed PostgREST and Storage store. When it is false, the backend intentionally uses the in-memory test/development store. Do not use a service-role key for user requests or to bypass these RLS policies. The backend variables are:

- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_PROXY_TARGET`
- Backend: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PERSISTENCE_ENABLED`, `DOCLING_SERVE_URL`, optional `DOCLING_SERVE_API_KEY`, `MAX_UPLOAD_BYTES`, `DOCLING_POLL_INTERVAL_SECONDS`, `DOCLING_JOB_TIMEOUT_SECONDS`, and optional `UPLOAD_TEMP_DIR`

## Google Cloud and Supabase setup

No project IDs, OAuth credentials or secrets are included in this repository. Complete these manual steps using your own accounts.

1. In Google Cloud Console, create or select a project. Open Google Auth Platform and configure Branding and Audience. Choose the appropriate audience (Internal for a managed organization, External otherwise); while in Testing, add each Google account that will test sign-in.
2. Under Data Access, allow only the sign-in scopes `openid`, `email` and `profile`. Supabase requires identity/profile scopes; this app does not request Google API access beyond authentication.
3. Under Clients, create an OAuth client ID with application type **Web application**.
4. Add the actual frontend origin under **Authorized JavaScript origins**. For local development, use the exact origin printed by Vite; for this workspace it is currently `http://localhost:5175` because ports `5173` and `5174` are occupied. Add the real production origin after deployment, such as `https://app.example.com`.
5. In Supabase Dashboard, open Authentication > Providers > Google. Enable Google and enter the Web client ID and client secret from Google Cloud.
6. Copy the exact callback URL shown in that Supabase provider screen into Google Cloud under **Authorized redirect URIs**. It commonly looks like `https://<project-ref>.supabase.co/auth/v1/callback`, but use the dashboard value. This is Google’s redirect URI; it is **not** the app’s `/auth/callback` URL.
7. In Supabase Dashboard, open Authentication > URL Configuration. Set **Site URL** to the intended production frontend origin (during local-only setup, use the local origin). Add the app callback URLs to the redirect allow list:
   - `http://localhost:5175/auth/callback` for the current Vite server.
   - If Vite selects another port, add `http://localhost:<actual-vite-port>/auth/callback` instead.
   - `https://<actual-production-host>/auth/callback` after deployment.
8. Put the Project URL and publishable key in `.env.local` and `backend/.env` as shown above. Never put the Google client secret in either file; Supabase stores and uses it as the OAuth broker.
9. Restart Vite after changing `.env.local`, then open the actual printed origin. Start sign-in from `/login`, complete consent with an allowed test account, and verify return to the protected destination. Supabase redirects back to the SPA callback, where the PKCE session is restored by `supabase-js`.

Keep the two redirects distinct:

- **Google Cloud authorized redirect URI:** Supabase Auth callback, copied from the Supabase Google provider page.
- **Supabase redirect URL allow list:** the frontend’s `/auth/callback` URL on each allowed local/production origin.

The application uses Supabase’s PKCE OAuth flow and requests no extra Google scopes. It does not call `linkIdentity()` or perform application-level account merging. Supabase documents automatic identity linking for matching email addresses; review its [identity-linking rules](https://supabase.com/docs/guides/auth/auth-identity-linking), including email uniqueness and verification behavior, and test account conflicts with your project’s settings before production. This is Supabase-managed behavior, not a merge implemented by this app.

## Start services

Start Docling Serve locally with Docker (optional if an instance already exists):

```powershell
docker compose -f backend/docker-compose.yml up -d
```

Start FastAPI and Vite in separate terminals from the repository root:

```powershell
npm run backend:dev
```

```powershell
npm run dev
```

Vite proxies same-origin `/api` calls to FastAPI. FastAPI verifies the Supabase access token against `GET {SUPABASE_URL}/auth/v1/user` using the backend publishable key. If Supabase Auth is not configured or is unreachable, protected backend endpoints fail closed with a clear `503` response. Invalid or missing bearer tokens receive `401`.

## Verification

Automated checks:

```powershell
npm run lint
npm run build
npm run format:check
npm run backend:test
```

Backend tests cover token requirement and verification boundary, auth-service failure, document/job owner isolation, PDF validation, Docling error handling, conversion status and extraction mapping. The Google OAuth callback/session and logout still require a configured Supabase project and Google test account for a live browser sign-in.

**Live Google OAuth status: unverified.** This checkout has no configured Supabase URL, publishable key, Google client ID or client secret. Do not interpret passing builds or mocked auth tests as a successful Google login. After setup, test Google consent/cancel, callback restoration, email/password sign-in, protected-route redirect, sign-out, and a second user's inability to read the first user's documents/jobs.

## API and persistence limits

- `POST /api/documents`, `GET /api/documents`, `GET /api/documents/{id}` and `GET /api/jobs/{id}` require a Supabase access token.
- FastAPI derives the owner ID from the user record returned by Supabase Auth. Request parameters and frontend profile data are never used as the owner identity.
- With `SUPABASE_PERSISTENCE_ENABLED=true`, documents, jobs, extraction results, and PDF objects are persisted through the user-scoped Supabase APIs. With it false, the backend uses process memory and temporary files.
- The extracted reader displays Docling’s Markdown/structured text, not a rendered PDF. Semantic search, embeddings, an LLM assistant and handwritten OCR are out of scope.

## Common setup errors

- `redirect_uri_mismatch`: Google’s authorized redirect URI must be the exact Supabase Auth callback shown in the Google provider settings, not the frontend callback.
- `redirect_to is not allowed`: add the exact current frontend origin plus `/auth/callback` to Supabase’s redirect allow list. Match the Vite port, scheme and hostname.
- Google app unavailable during Testing: add the testing account to the Google Auth Platform Audience test-user list, or publish/configure the consent screen as appropriate.
- Provider disabled or OAuth configuration error: enable Google in Supabase Authentication > Providers and verify the Web client ID/secret there.
- Missing authentication configuration: confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in root `.env.local`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `backend/.env`, then restart both processes. Do not print/paste secrets into source code.
- Callback session not restored: confirm the Vite app callback URL is in Supabase’s redirect allow list and that the PKCE callback stays in the same browser profile that initiated sign-in.

## Official references

- [Supabase Google OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
- [Supabase JavaScript Auth reference](https://supabase.com/docs/reference/javascript/auth)
- [Docling Serve](https://github.com/docling-project/docling-serve)
- [Docling REST API](https://docling-project.github.io/docling/usage/api_server/rest_api/)
