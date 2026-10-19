"""Tests for the poster cache and the image view."""

import asyncio
import dataclasses
import io
import os
import time
from datetime import timedelta
from pathlib import Path

import aiohttp
import pytest
from PIL import Image

from custom_components.tv_guide.images import (
    FAILURE_MEMORY,
    IMAGE_CACHE,
    IMAGE_FOLDER,
    MAX_PARALLEL_DOWNLOADS,
    ImageCache,
    _store_sizes,
    decode,
    resize,
)
from custom_components.tv_guide.model import Guide, image_id

POSTER_URL = "https://img.example/fakty.jpg"
THUMB_PATH = f"/api/tv_guide/image/{image_id(POSTER_URL)}/thumb"
LARGE_PATH = f"/api/tv_guide/image/{image_id(POSTER_URL)}/large"
DAY = 24 * 60 * 60


def jpeg(width: int, height: int) -> bytes:
    """A plain JPEG of the given size."""
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (10, 120, 200)).save(buffer, "JPEG")
    return buffer.getvalue()


def stored_files(hass) -> list[Path]:
    """Files in the poster folder."""
    folder = Path(hass.config.path(IMAGE_FOLDER))
    return sorted(folder.glob("*")) if folder.exists() else []


def test_resize_width(poster_bytes):
    assert Image.open(io.BytesIO(resize(poster_bytes, 336))).size == (336, 189)


def test_resize_never_upscales():
    assert Image.open(io.BytesIO(resize(jpeg(200, 100), 1200))).size == (200, 100)


def test_resize_png_with_alpha_becomes_jpeg():
    buffer = io.BytesIO()
    Image.new("RGBA", (400, 200), (255, 0, 0, 128)).save(buffer, "PNG")
    result = Image.open(io.BytesIO(resize(buffer.getvalue(), 100)))
    assert (result.format, result.mode, result.size) == ("JPEG", "RGB", (100, 50))


async def test_first_request_downloads_and_stores(
    hass, hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes
):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()

    response = await client.get(THUMB_PATH)

    assert response.status == 200
    assert response.headers["Content-Type"] == "image/jpeg"
    assert response.headers["Cache-Control"] == "public, max-age=604800"
    assert Image.open(io.BytesIO(await response.read())).size == (336, 189)
    # Both sizes are made on the first download.
    assert [f.name for f in stored_files(hass)] == [
        f"{image_id(POSTER_URL)}_large.jpg",
        f"{image_id(POSTER_URL)}_thumb.jpg",
    ]


async def test_large_size(hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()

    response = await client.get(LARGE_PATH)

    assert response.status == 200
    assert Image.open(io.BytesIO(await response.read())).size == (1200, 675)


async def test_second_request_from_disk(hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 200
    assert (await client.get(THUMB_PATH)).status == 200

    assert aioclient_mock.call_count == 2  # the guide source and one poster download


async def test_serving_updates_mtime(hass, hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()
    await client.get(THUMB_PATH)
    (thumb,) = [f for f in stored_files(hass) if f.name.endswith("_thumb.jpg")]
    old = time.time() - 5 * DAY
    os.utime(thumb, (old, old))

    await client.get(THUMB_PATH)

    assert thumb.stat().st_mtime > old + DAY


async def test_unknown_id_404(hass, hass_client_no_auth, aioclient_mock, loaded_entry):
    client = await hass_client_no_auth()

    response = await client.get(f"/api/tv_guide/image/{'a' * 32}/thumb")

    assert response.status == 404
    assert stored_files(hass) == []


@pytest.mark.parametrize("bad_id", ["secrets", "..", "ABCDEF" + "0" * 26, "a" * 31, "a" * 33, "g" * 32])
async def test_bad_id_404(hass, hass_client_no_auth, loaded_entry, bad_id):
    client = await hass_client_no_auth()

    response = await client.get(f"/api/tv_guide/image/{bad_id}/thumb")

    assert response.status == 404
    assert stored_files(hass) == []


async def test_path_traversal_rejected(hass, hass_client_no_auth, loaded_entry):
    """Home Assistant's own middleware answers 400 for an encoded `/`; the view is never reached."""
    client = await hass_client_no_auth()

    response = await client.get("/api/tv_guide/image/..%2F..%2Fsecrets/thumb")

    assert response.status in (400, 404)
    assert stored_files(hass) == []


async def test_unknown_size_400(hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()

    response = await client.get(f"/api/tv_guide/image/{image_id(POSTER_URL)}/huge")

    assert response.status == 400


@pytest.mark.parametrize("content", [b"not an image", jpeg(300, 200)[:200]])
async def test_broken_image_404(hass, hass_client_no_auth, aioclient_mock, loaded_entry, content):
    aioclient_mock.get(POSTER_URL, content=content)
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404
    assert stored_files(hass) == []


@pytest.mark.parametrize("image_format", ["BMP", "TIFF"])
async def test_other_image_format_404(hass, hass_client_no_auth, aioclient_mock, loaded_entry, image_format):
    """Only JPEG, PNG, GIF and WEBP are opened. Pillow knows many more formats."""
    buffer = io.BytesIO()
    Image.new("RGB", (30, 20), (10, 120, 200)).save(buffer, image_format)
    aioclient_mock.get(POSTER_URL, content=buffer.getvalue())
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404
    assert stored_files(hass) == []


async def test_too_large_download_404(hass_client_no_auth, aioclient_mock, loaded_entry, monkeypatch):
    monkeypatch.setattr("custom_components.tv_guide.images.MAX_IMAGE_BYTES", 1024)
    aioclient_mock.get(POSTER_URL, content=b"x" * 2048)
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404


async def test_decompression_bomb_404(hass, hass_client_no_auth, aioclient_mock, loaded_entry, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    aioclient_mock.get(POSTER_URL, content=jpeg(300, 300))
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404
    assert stored_files(hass) == []


async def test_source_down_without_copy_404(hass_client_no_auth, aioclient_mock, loaded_entry):
    aioclient_mock.get(POSTER_URL, exc=aiohttp.ClientConnectionError)
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404


async def test_source_http_error_404(hass_client_no_auth, aioclient_mock, loaded_entry):
    aioclient_mock.get(POSTER_URL, status=503)
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404


async def test_source_down_with_copy_200(hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()
    assert (await client.get(THUMB_PATH)).status == 200
    aioclient_mock.clear_requests()
    aioclient_mock.get(POSTER_URL, exc=aiohttp.ClientConnectionError)

    assert (await client.get(THUMB_PATH)).status == 200


async def test_non_http_url_404(hass, hass_client_no_auth, loaded_entry, monkeypatch):
    """A `file://` source URL must never be fetched."""
    url = "file:///etc/passwd"
    monkeypatch.setattr(Guide, "image_urls", lambda _self: {image_id(url): url})
    client = await hass_client_no_auth()

    assert (await client.get(f"/api/tv_guide/image/{image_id(url)}/thumb")).status == 404


async def test_concurrent_requests_download_once(hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()
    before = aioclient_mock.call_count

    responses = await asyncio.gather(*(client.get(THUMB_PATH) for _ in range(5)))

    assert [r.status for r in responses] == [200] * 5
    assert aioclient_mock.call_count - before == 1


async def test_locks_are_removed_after_use(hass, hass_client_no_auth, aioclient_mock, loaded_entry, poster_bytes):
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()
    await client.get(THUMB_PATH)

    cache = hass.data[IMAGE_CACHE]
    assert cache._locks == {}


async def test_cleanup_removes_old_files(hass, tmp_path):
    cache = ImageCache(hass, tmp_path)
    old, recent = tmp_path / "old.jpg", tmp_path / "recent.jpg"
    old.write_bytes(b"x")
    recent.write_bytes(b"x")
    now = time.time()
    os.utime(old, (now - 8 * DAY, now - 8 * DAY))
    os.utime(recent, (now - 1 * DAY, now - 1 * DAY))

    assert await cache.async_cleanup(timedelta(days=7)) == 1

    assert not old.exists()
    assert recent.exists()


async def test_cleanup_without_folder(hass, tmp_path):
    assert await ImageCache(hass, tmp_path / "missing").async_cleanup(timedelta(days=7)) == 0


async def test_guide_map_built_once_per_guide(
    hass, hass_client_no_auth, aioclient_mock, loaded_entry, monkeypatch, poster_bytes
):
    calls: list[Guide] = []
    original = Guide.image_urls

    def counting(self: Guide) -> dict[str, str]:
        calls.append(self)
        return original(self)

    monkeypatch.setattr(Guide, "image_urls", counting)
    aioclient_mock.get(POSTER_URL, content=poster_bytes)
    client = await hass_client_no_auth()

    for path in (THUMB_PATH, THUMB_PATH, LARGE_PATH):
        assert (await client.get(path)).status == 200
    assert len(calls) == 1

    # A refresh swaps in a new Guide object: the map is built again, once.
    coordinator = loaded_entry.runtime_data
    coordinator.async_set_updated_data(dataclasses.replace(coordinator.data))
    assert (await client.get(THUMB_PATH)).status == 200
    assert (await client.get(THUMB_PATH)).status == 200
    assert len(calls) == 2


async def test_failed_poster_not_tried_again(hass_client_no_auth, aioclient_mock, loaded_entry, freezer):
    aioclient_mock.get(POSTER_URL, content=b"not an image")
    client = await hass_client_no_auth()
    assert (await client.get(THUMB_PATH)).status == 404
    after_first = aioclient_mock.call_count

    assert (await client.get(THUMB_PATH)).status == 404
    assert (await client.get(LARGE_PATH)).status == 404
    assert aioclient_mock.call_count == after_first

    # After the memory time the poster is tried again.
    freezer.tick(FAILURE_MEMORY + 1)
    assert (await client.get(THUMB_PATH)).status == 404
    assert aioclient_mock.call_count == after_first + 1


async def test_concurrent_requests_for_failing_poster_download_once(hass_client_no_auth, aioclient_mock, loaded_entry):
    aioclient_mock.get(POSTER_URL, status=503)
    client = await hass_client_no_auth()
    before = aioclient_mock.call_count

    responses = await asyncio.gather(*(client.get(THUMB_PATH) for _ in range(5)))

    assert [r.status for r in responses] == [404] * 5
    assert aioclient_mock.call_count - before == 1


async def test_downloads_run_at_most_four_at_once(hass, loaded_entry, monkeypatch):
    cache = hass.data[IMAGE_CACHE]
    running = peak = 0

    async def slow_download(image_id, url, wanted):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1

    monkeypatch.setattr(cache, "_download", slow_download)
    urls = {f"{i:032x}": f"https://img.example/{i}.jpg" for i in range(10)}
    monkeypatch.setattr(Guide, "image_urls", lambda _self: urls)

    await asyncio.gather(*(cache.async_get(image_id, "thumb") for image_id in urls))

    assert peak == MAX_PARALLEL_DOWNLOADS


async def test_very_wide_image_gets_height_of_one_pixel(hass_client_no_auth, aioclient_mock, loaded_entry):
    aioclient_mock.get(POSTER_URL, content=jpeg(5000, 5))
    client = await hass_client_no_auth()

    response = await client.get(THUMB_PATH)

    assert response.status == 200
    assert Image.open(io.BytesIO(await response.read())).size == (336, 1)


def test_resize_wide_strip():
    assert Image.open(io.BytesIO(resize(jpeg(5000, 5), 336))).size == (336, 1)


async def test_image_over_pixel_limit_404(hass, hass_client_no_auth, aioclient_mock, loaded_entry, monkeypatch):
    monkeypatch.setattr("custom_components.tv_guide.images.MAX_IMAGE_PIXELS", 10_000)
    aioclient_mock.get(POSTER_URL, content=jpeg(200, 100))  # 20 000 pixels
    client = await hass_client_no_auth()

    assert (await client.get(THUMB_PATH)).status == 404
    assert stored_files(hass) == []


def test_store_decodes_once(tmp_path, poster_bytes, monkeypatch):
    calls = 0
    original = decode

    def counting(data: bytes):
        nonlocal calls
        calls += 1
        return original(data)

    monkeypatch.setattr("custom_components.tv_guide.images.decode", counting)

    _store_sizes(tmp_path, "a" * 32, poster_bytes)

    assert calls == 1
    assert len(list(tmp_path.glob("*.jpg"))) == 2
