"""Shared test data. Later tasks add to this file; do not define a second copy."""

import io
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from PIL import Image
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
from pytest_homeassistant_custom_component.typing import MockHAClientWebSocket, WebSocketGenerator

from custom_components.tv_guide.const import DOMAIN
from custom_components.tv_guide.model import Guide
from custom_components.tv_guide.parser import parse_guide

WAW = ZoneInfo("Europe/Warsaw")
NOW = datetime(2026, 10, 19, 19, 20, tzinfo=WAW)
URL = "http://src/guide.xml"


@pytest.fixture(autouse=True)
def _enable(enable_custom_integrations: None) -> None:
    """Let Home Assistant load the integration from `custom_components`."""


@pytest.fixture(autouse=True)
def _no_frontend() -> Iterator[None]:
    """The manifest depends on `frontend`. Skip its setup: the `hass_frontend` package is not installed."""
    with patch("homeassistant.components.frontend.async_setup", return_value=True):
        yield


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Use a temporary config folder: the poster cache writes below it."""
    return hass_tmp_config_dir


@pytest.fixture
def poster_bytes() -> bytes:
    """A 1920x1080 JPEG poster, built on the fly."""
    buffer = io.BytesIO()
    Image.new("RGB", (1920, 1080), (200, 30, 30)).save(buffer, "JPEG")
    return buffer.getvalue()


@pytest.fixture
def guide_xml() -> bytes:
    """Bytes of the XMLTV fixture file."""
    return (Path(__file__).parent / "fixtures" / "guide.xml").read_bytes()


@pytest.fixture
def guide(guide_xml: bytes) -> Guide:
    """The fixture guide parsed for TVN and Polsat at `NOW`."""
    return parse_guide(io.BytesIO(guide_xml), {"TVN", "Polsat"}, NOW)


@pytest.fixture
def mock_entry(hass: HomeAssistant) -> MockConfigEntry:
    """A config entry for TVN and Polsat, added to `hass` but not set up."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=URL,
        data={"url": URL},
        options={"channels": ["TVN", "Polsat"], "update_interval": 12},
    )
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
async def loaded_entry(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, guide_xml: bytes, mock_entry: MockConfigEntry
) -> MockConfigEntry:
    """`mock_entry` set up against the fixture source."""
    aioclient_mock.get(URL, content=guide_xml)
    assert await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()
    assert mock_entry.state is ConfigEntryState.LOADED
    return mock_entry


@pytest.fixture
def clock_at_now(freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    """Freeze the clock at `NOW`."""
    freezer.move_to(NOW)
    return freezer


@pytest.fixture
async def ws(
    hass: HomeAssistant, clock_at_now: FrozenDateTimeFactory, hass_ws_client: WebSocketGenerator
) -> MockHAClientWebSocket:
    """A WebSocket client with the commands registered and the clock at `NOW`.

    The clock must stop before `hass_ws_client` runs: it signs an access token with the
    current time, and a token issued "in the future" is rejected.
    Home Assistant sets the integration up only when an entry exists, so the fixture does it
    explicitly: the "no entry" tests need the commands without any entry.
    """
    assert await async_setup_component(hass, DOMAIN, {})
    return await hass_ws_client(hass)
