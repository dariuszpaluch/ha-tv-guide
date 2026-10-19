"""Resized poster cache, served by Home Assistant.

The card shows posters from many sources. Some are big, some are plain `http`.
Home Assistant downloads each poster once, makes two small JPEG files and serves
them from disk, so the browser never talks to the source.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Final, Literal, TypeGuard, get_args
from urllib.parse import urlsplit

from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util.hass_dict import HassKey
from PIL import Image

from .const import DOMAIN
from .model import Guide
from .source import SourceError, fetch_source

_LOGGER = logging.getLogger(__name__)

IMAGE_FOLDER = ".cache/tv_guide/images"  # relative to the config folder; HA backups skip `.cache/*`
MAX_IMAGE_BYTES = 10 * 1024 * 1024
DOWNLOAD_TIMEOUT = 20  # seconds
MAX_IMAGE_PIXELS = 30_000_000  # Pillow's own limit is about 178 million: too much memory for a small device
ALLOWED_FORMATS = ("JPEG", "PNG", "GIF", "WEBP")  # Pillow knows many more (such as EPS): the URL is foreign
MAX_PARALLEL_DOWNLOADS = 4  # downloads and decodes running at once
FAILURE_MEMORY = 5 * 60  # seconds a failed poster is not tried again
JPEG_QUALITY = 80
CACHE_CONTROL = "public, max-age=604800"
UNUSED_FILE_MAX_AGE = timedelta(days=7)
CLEANUP_INTERVAL = timedelta(days=1)

type ImageSize = Literal["thumb", "large"]
SIZE_WIDTHS: Final[dict[ImageSize, int]] = {"thumb": 336, "large": 1200}
IMAGE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

IMAGE_CACHE: HassKey[ImageCache] = HassKey(f"{DOMAIN}_image_cache")


class InvalidImageError(Exception):
    """The bytes are not an image that can be decoded, or the image is too big."""


def decode(data: bytes) -> Image.Image:
    """Decode an image and convert it to RGB, because JPEG has no alpha and no palette.

    Raises:
        InvalidImageError: the data is not a readable image, or it has too many pixels.
    """
    try:
        with Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS) as source:
            # The size is known from the header. Check it before the pixels are decoded.
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise InvalidImageError(f"Image of {source.width}x{source.height} pixels is too big")
            return source.convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as err:  # OSError: unknown format or truncated file
        raise InvalidImageError(str(err)) from err


def scale(image: Image.Image, width: int) -> bytes:
    """Return the image as JPEG (quality 80) that is `width` pixels wide.

    A smaller image keeps its size: scaling up only makes the file bigger.
    """
    if image.width > width:
        height = max(1, round(image.height * width / image.width))  # a very wide strip must not get height 0
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, "JPEG", quality=JPEG_QUALITY)
    return output.getvalue()


def resize(data: bytes, width: int) -> bytes:
    """Decode `data` and return it as a JPEG `width` pixels wide.

    Raises:
        InvalidImageError: see `decode`.
    """
    return scale(decode(data), width)


def is_image_size(value: str) -> TypeGuard[ImageSize]:
    """True when `value` is one of the poster sizes."""
    return value in get_args(ImageSize.__value__)


class ImageCache:
    """Poster files on disk: one `<id>_thumb.jpg` and one `<id>_large.jpg` per poster."""

    def __init__(self, hass: HomeAssistant, folder: Path) -> None:
        """Create the cache. The folder is made on the first write."""
        self._hass = hass
        self._folder = folder
        self._locks: dict[str, asyncio.Lock] = {}
        self._lock_users: Counter[str] = Counter()
        self._downloads = asyncio.Semaphore(MAX_PARALLEL_DOWNLOADS)
        self._failed: dict[str, float] = {}  # image id -> monotonic time of the failure
        # Building the map hashes every poster URL. The coordinator replaces the `Guide` on a refresh and
        # never changes the old one, so the map is valid while the object is the same.
        self._guide_maps: dict[str, tuple[Guide, dict[str, str]]] = {}

    async def async_get(self, image_id: str, size: ImageSize) -> Path | None:
        """Return the file of a poster, downloading it on the first request.

        Returns None when the id is not in a loaded guide, the source fails and there
        is no copy, or the image is broken. A hit also sets the file time to now, so
        `async_cleanup` keeps files in use. A poster that failed is not tried again for a few minutes.
        """
        url = self._source_url(image_id)
        if url is None or urlsplit(url).scheme not in ("http", "https"):
            return None
        path = self._path(image_id, size)
        if await self._hass.async_add_executor_job(_touch, path):
            return path
        if self._recently_failed(image_id):
            return None
        async with self._download_lock(image_id):
            # Another request may have made the files, or failed, while this one waited.
            if await self._hass.async_add_executor_job(_touch, path):
                return path
            if self._recently_failed(image_id):
                return None
            async with self._downloads:
                result = await self._download(image_id, url, path)
            if result is None:
                self._remember_failure(image_id)
            return result

    async def async_cleanup(self, max_age: timedelta) -> int:
        """Delete files not used for `max_age`. Return how many were deleted."""
        return await self._hass.async_add_executor_job(_delete_older_than, self._folder, max_age)

    def _source_url(self, image_id: str) -> str | None:
        """Source URL of a poster in any loaded guide, or None."""
        maps: dict[str, tuple[Guide, dict[str, str]]] = {}
        for entry in self._hass.config_entries.async_loaded_entries(DOMAIN):
            guide = entry.runtime_data.data
            known = self._guide_maps.get(entry.entry_id)
            maps[entry.entry_id] = known if known and known[0] is guide else (guide, guide.image_urls())
        self._guide_maps = maps  # also drops the maps of entries that are no longer loaded
        return next((urls[image_id] for _, urls in maps.values() if image_id in urls), None)

    def _recently_failed(self, image_id: str) -> bool:
        failed_at = self._failed.get(image_id)
        return failed_at is not None and time.monotonic() - failed_at < FAILURE_MEMORY

    def _remember_failure(self, image_id: str) -> None:
        now = time.monotonic()
        self._failed = {k: t for k, t in self._failed.items() if now - t < FAILURE_MEMORY}
        self._failed[image_id] = now

    def _path(self, image_id: str, size: ImageSize) -> Path:
        return self._folder / f"{image_id}_{size}.jpg"

    @asynccontextmanager
    async def _download_lock(self, image_id: str) -> AsyncIterator[None]:
        """One download per id at a time. The lock is removed when nobody uses it."""
        lock = self._locks.setdefault(image_id, asyncio.Lock())
        self._lock_users[image_id] += 1
        try:
            async with lock:
                yield
        finally:
            self._lock_users[image_id] -= 1
            if not self._lock_users[image_id]:
                del self._lock_users[image_id]
                del self._locks[image_id]

    async def _download(self, image_id: str, url: str, wanted: Path) -> Path | None:
        """Download the source, store both sizes and return the wanted file."""
        try:
            data = await fetch_source(
                async_get_clientsession(self._hass), url, timeout=DOWNLOAD_TIMEOUT, max_bytes=MAX_IMAGE_BYTES
            )
        except SourceError as err:
            _LOGGER.debug("Cannot download the poster: %s", err)
            return None
        try:
            await self._hass.async_add_executor_job(_store_sizes, self._folder, image_id, data)
        except InvalidImageError as err:
            _LOGGER.debug("Broken poster %s: %s", url, err)
            return None
        return wanted


def _touch(path: Path) -> bool:
    """Set the file time to now. Return False when the file does not exist."""
    try:
        os.utime(path)
    except FileNotFoundError:
        return False
    return True


def _store_sizes(folder: Path, image_id: str, data: bytes) -> None:
    """Make both sizes, then write them. Nothing is written when the image is broken."""
    image = decode(data)
    files = {f"{image_id}_{size}.jpg": scale(image, width) for size, width in SIZE_WIDTHS.items()}
    folder.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        _write_atomic(folder / name, content)


def _write_atomic(path: Path, content: bytes) -> None:
    """Write through a temporary file, so a crash never leaves a half-written JPEG under the real name."""
    temporary = path.with_name(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _delete_older_than(folder: Path, max_age: timedelta) -> int:
    """Delete the files of `folder` older than `max_age`. Leftover temporary files go the same way."""
    if not folder.is_dir():
        return 0
    limit = time.time() - max_age.total_seconds()
    deleted = 0
    for path in folder.iterdir():
        try:
            if path.is_file() and path.stat().st_mtime < limit:
                path.unlink()
                deleted += 1
        except FileNotFoundError:
            continue
    return deleted


class TvGuideImageView(HomeAssistantView):
    """Serve the resized posters of the loaded guides."""

    url = "/api/tv_guide/image/{image_id}/{size}"
    name = "api:tv_guide:image"
    # An <img> tag cannot send a login token, so the view is open. The cost of that
    # is small: it serves only posters whose URL is in a loaded guide (never an
    # address chosen by the caller), in two fixed sizes, and a download is capped at 10 MB.
    requires_auth = False

    async def get(self, request: web.Request, image_id: str, size: str) -> web.StreamResponse:
        """Return the poster file, or 400 for an unknown size, or 404."""
        if not IMAGE_ID_PATTERN.fullmatch(image_id):
            return web.Response(status=404)
        if not is_image_size(size):
            return web.Response(status=400)
        cache = request.app[KEY_HASS].data[IMAGE_CACHE]
        path = await cache.async_get(image_id, size)
        if path is None:
            return web.Response(status=404)
        return web.FileResponse(path, headers={"Cache-Control": CACHE_CONTROL})
