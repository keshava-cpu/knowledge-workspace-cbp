import asyncio
import json
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings
from app.models import ExtractedBlock, ExtractedContent


class DoclingServeError(Exception):
    pass


class DoclingServeClient:
    def __init__(
        self,
        settings: Settings,
        sync_transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.sync_transport = sync_transport
        self.timeout = httpx.Timeout(connect=10, read=60, write=120, pool=10)

    def _headers(self) -> dict[str, str]:
        if self.settings.docling_api_key:
            return {"X-Api-Key": self.settings.docling_api_key}
        return {}

    @staticmethod
    def _decode_response(response: httpx.Response) -> dict[str, Any]:
        if response.is_error:
            detail = ""
            try:
                payload = response.json()
                detail_value = payload.get("detail") if isinstance(payload, dict) else None
                if isinstance(detail_value, str):
                    detail = f" {detail_value}"
            except ValueError:
                pass
            raise DoclingServeError(
                f"Docling Serve returned HTTP {response.status_code}.{detail}"
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise DoclingServeError("Docling Serve returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise DoclingServeError("Docling Serve returned an unexpected response.")
        return payload

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method,
                    f"{self.settings.docling_serve_url}{path}",
                    headers=self._headers(),
                    **kwargs,
                )
        except httpx.TimeoutException as exc:
            raise DoclingServeError("Docling Serve request timed out.") from exc
        except httpx.RequestError as exc:
            raise DoclingServeError("Docling Serve is unavailable.") from exc
        return self._decode_response(response)

    def _request_sync(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            with httpx.Client(
                timeout=self.timeout,
                transport=self.sync_transport,
            ) as client:
                response = client.request(
                    method,
                    f"{self.settings.docling_serve_url}{path}",
                    headers=self._headers(),
                    **kwargs,
                )
        except httpx.TimeoutException as exc:
            raise DoclingServeError("Docling Serve request timed out.") from exc
        except httpx.RequestError as exc:
            raise DoclingServeError("Docling Serve is unavailable.") from exc
        return self._decode_response(response)

    def _submit_file_sync(self, path: Path, filename: str) -> dict[str, Any]:
        with path.open("rb") as pdf:
            multipart_fields = [
                ("files", (filename, pdf, "application/pdf")),
                ("to_formats", (None, "md")),
                ("to_formats", (None, "json")),
            ]
            return self._request_sync(
                "POST",
                "/v1/convert/file/async",
                files=multipart_fields,
            )

    async def submit_file(self, path: Path, filename: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._submit_file_sync, path, filename)

    async def get_status(self, task_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/v1/status/poll/{task_id}")

    async def get_result(self, task_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/v1/result/{task_id}")


def _page_numbers(node: dict[str, Any]) -> list[int]:
    pages: set[int] = set()
    for provenance in node.get("prov", []):
        if isinstance(provenance, dict):
            page_number = provenance.get("page_no")
            if isinstance(page_number, int):
                pages.add(page_number)
    return sorted(pages)


def _extract_blocks(document_json: Any) -> list[ExtractedBlock]:
    if not isinstance(document_json, dict):
        return []

    collections = (
        "texts",
        "tables",
        "pictures",
        "groups",
        "key_value_items",
        "formulas",
    )
    nodes_by_ref: dict[str, dict[str, Any]] = {}
    fallback_nodes: list[dict[str, Any]] = []
    for collection in collections:
        nodes = document_json.get(collection, [])
        if not isinstance(nodes, list):
            continue
        for node in nodes:
            if not isinstance(node, dict):
                continue
            fallback_nodes.append(node)
            reference = node.get("self_ref")
            if isinstance(reference, str):
                nodes_by_ref[reference] = node

    blocks: list[ExtractedBlock] = []
    seen: set[str] = set()

    def visit(reference_or_node: Any) -> None:
        if not isinstance(reference_or_node, dict):
            return
        reference = reference_or_node.get("$ref") or reference_or_node.get("self_ref")
        if isinstance(reference, str):
            if reference in seen:
                return
            seen.add(reference)
        node = nodes_by_ref.get(reference, reference_or_node)
        text = node.get("text")
        if isinstance(text, str) and text.strip():
            label = str(node.get("label", "text")).lower()
            kind = "heading" if label in {"title", "section_header", "heading"} else label
            blocks.append(
                ExtractedBlock(
                    kind=kind,
                    text=text.strip(),
                    page_numbers=_page_numbers(node),
                    location_metadata=[
                        provenance
                        for provenance in node.get("prov", [])
                        if isinstance(provenance, dict)
                    ],
                )
            )
            return
        children = node.get("children", [])
        if isinstance(children, list):
            for child in children:
                visit(child)

    body = document_json.get("body")
    if isinstance(body, dict) and isinstance(body.get("children"), list):
        for child in body["children"]:
            visit(child)
    if not blocks:
        for node in fallback_nodes:
            visit(node)
    return blocks


def parse_conversion_result(payload: dict[str, Any]) -> tuple[ExtractedContent, int | None]:
    converted_document = payload.get("document")
    if not isinstance(converted_document, dict):
        raise DoclingServeError("Docling Serve returned no converted document.")

    markdown = converted_document.get("md_content")
    markdown = markdown if isinstance(markdown, str) else ""
    structured_json: Any = converted_document.get("json_content")
    if isinstance(structured_json, str):
        try:
            structured_json = json.loads(structured_json)
        except json.JSONDecodeError:
            structured_json = None

    blocks = _extract_blocks(structured_json)
    if not markdown and not blocks:
        raise DoclingServeError("Docling Serve returned no extracted text.")

    pages = structured_json.get("pages") if isinstance(structured_json, dict) else None
    page_count = len(pages) if isinstance(pages, (dict, list)) and pages else None
    if page_count is None:
        referenced_pages = [page for block in blocks for page in block.page_numbers]
        page_count = max(referenced_pages) if referenced_pages else None

    content = ExtractedContent(
        markdown=markdown,
        structured_json=structured_json,
        blocks=blocks,
    )
    return content, page_count