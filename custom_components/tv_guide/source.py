"""Download the XMLTV source and open it as a stream."""

import gzip
import io
import lzma
import zipfile
from typing import IO

import aiohttp

MAX_SOURCE_BYTES = 64 * 1024 * 1024
CHUNK_BYTES = 64 * 1024

GZIP_MAGIC = b"\x1f\x8b"
XZ_MAGIC = b"\xfd7zXZ\x00"
ZIP_MAGIC = b"PK\x03\x04"


class SourceError(Exception):
    """The XMLTV source cannot be downloaded or opened."""


async def fetch_source(
    session: aiohttp.ClientSession,
    url: str,
    timeout: float = 120,
    max_bytes: int = MAX_SOURCE_BYTES,
) -> bytes:
    """Download `url` and return the raw bytes, still compressed.

    The size is checked while reading, so a huge or endless response never
    fills the memory.

    Raises:
        SourceError: HTTP status 400 or more, timeout, connection error,
            or more than `max_bytes`.
    """
    chunks: list[bytes] = []
    size = 0
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
            if response.status >= 400:
                raise SourceError(f"HTTP {response.status} from {url}")
            async for chunk in response.content.iter_chunked(CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise SourceError(f"The source is larger than {max_bytes} bytes")
                chunks.append(chunk)
    except TimeoutError as err:
        raise SourceError(f"Timeout while downloading {url}") from err
    except aiohttp.ClientError as err:
        raise SourceError(f"Cannot download {url}: {err}") from err
    return b"".join(chunks)


def open_source(raw: bytes) -> IO[bytes]:
    """Open the downloaded bytes as a stream of XML, decompressing on read.

    The XML can be about 100 MB, so nothing here decompresses it in one piece.
    Plain XML, gzip, xz and zip (one `.xml` member) are supported.

    Raises:
        SourceError: the zip is broken or has no, or several, `.xml` members.
    """
    if raw.startswith(GZIP_MAGIC):
        return gzip.GzipFile(fileobj=io.BytesIO(raw))
    if raw.startswith(XZ_MAGIC):
        return lzma.LZMAFile(io.BytesIO(raw))
    if raw.startswith(ZIP_MAGIC):
        return _open_zip_member(raw)
    return io.BytesIO(raw)


def _open_zip_member(raw: bytes) -> IO[bytes]:
    """Open the only `.xml` member of a zip.

    The member stream keeps the `ZipFile` alive, so it stays readable after
    this function returns.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as err:
        raise SourceError(f"Broken zip file: {err}") from err
    names = [name for name in archive.namelist() if name.lower().endswith(".xml")]
    if len(names) != 1:
        raise SourceError(f"The zip must have exactly one .xml file, found {len(names)}")
    return archive.open(names[0])
