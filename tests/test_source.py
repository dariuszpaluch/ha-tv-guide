"""Tests for downloading the XMLTV source and opening it as a stream."""

import gc
import gzip
import io
import lzma
import zipfile

import aiohttp
import pytest
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from custom_components.tv_guide.source import SourceError, fetch_source, open_source, safe_url
from tests.conftest import URL


def zip_one_xml(data: bytes) -> bytes:
    """Build a zip with one member, `guide.xml`."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("guide.xml", data)
    return buffer.getvalue()


def zip_members(members: dict[str, bytes]) -> bytes:
    """Build a zip with the given members."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


async def test_fetch_returns_bytes(aioclient_mock, hass):
    aioclient_mock.get(URL, content=b"<tv/>")
    assert await fetch_source(async_get_clientsession(hass), URL) == b"<tv/>"


async def test_fetch_http_error_raises(aioclient_mock, hass):
    aioclient_mock.get(URL, status=503)
    with pytest.raises(SourceError):
        await fetch_source(async_get_clientsession(hass), URL)


async def test_fetch_too_large_raises(aioclient_mock, hass):
    aioclient_mock.get(URL, content=b"x" * 2048)
    with pytest.raises(SourceError):
        await fetch_source(async_get_clientsession(hass), URL, max_bytes=1024)


@pytest.mark.parametrize("error", [aiohttp.ClientConnectionError, TimeoutError])
async def test_fetch_connection_error_and_timeout_raise(aioclient_mock, hass, error):
    aioclient_mock.get(URL, exc=error)
    with pytest.raises(SourceError):
        await fetch_source(async_get_clientsession(hass), URL)


SECRET_URL = "https://user:pass@iptv.example:8080/xmltv/key123/guide.xml?username=me&password=secret"


def test_safe_url_keeps_only_the_server() -> None:
    """IPTV providers put the login in the path, the query or the user part. Logs must not show it."""
    assert safe_url(SECRET_URL) == "https://iptv.example:8080"
    assert safe_url("http://epg.example/pl.gz") == "http://epg.example"
    assert safe_url("not a url") == "the source"


@pytest.mark.parametrize(
    ("mock", "text"),
    [
        ({"status": 404}, "HTTP 404 from https://iptv.example:8080"),
        ({"exc": TimeoutError}, "Timeout while downloading from https://iptv.example:8080"),
        (
            {"exc": aiohttp.ClientConnectionError(f"Cannot reach {SECRET_URL}")},
            "Cannot download from https://iptv.example",
        ),
    ],
)
async def test_fetch_errors_hide_the_login(aioclient_mock, hass, mock, text) -> None:
    aioclient_mock.get(SECRET_URL, **mock)
    with pytest.raises(SourceError) as error:
        await fetch_source(async_get_clientsession(hass), SECRET_URL)
    assert text in str(error.value)
    for secret in ("key123", "secret", "user:pass", "username"):
        assert secret not in str(error.value)


@pytest.mark.parametrize("pack", [gzip.compress, lzma.compress, zip_one_xml, lambda b: b])
def test_open_source_formats(pack):
    assert open_source(pack(b"<tv/>")).read() == b"<tv/>"


def test_open_source_streams():
    stream = open_source(gzip.compress(b"<tv>" + b" " * 10_000_000 + b"</tv>"))
    assert not isinstance(stream, (bytes, io.BytesIO))
    assert len(stream.read(1024)) == 1024


def test_zip_stream_stays_readable_after_open_source_returns():
    stream = open_source(zip_one_xml(b"<tv>" + b" " * 1_000_000 + b"</tv>"))
    gc.collect()
    assert stream.read(4) == b"<tv>"
    assert stream.read().endswith(b"</tv>")


def test_zip_ignores_non_xml_members():
    raw = zip_members({"readme.txt": b"hi", "guide.xml": b"<tv/>"})
    assert open_source(raw).read() == b"<tv/>"


@pytest.mark.parametrize(
    "members",
    [{"readme.txt": b"hi"}, {"a.xml": b"<tv/>", "b.xml": b"<tv/>"}],
    ids=["no-xml", "two-xml"],
)
def test_zip_needs_exactly_one_xml_member(members):
    with pytest.raises(SourceError):
        open_source(zip_members(members))


def test_broken_zip_raises():
    with pytest.raises(SourceError):
        open_source(b"PK\x03\x04 broken")


def test_broken_gzip_raises_on_read():
    with pytest.raises((SourceError, OSError, EOFError)):
        open_source(b"\x1f\x8b broken").read()
