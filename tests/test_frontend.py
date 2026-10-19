"""The integration serves the built card and tells the HA frontend to load it."""

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

import custom_components.tv_guide as tv_guide
from custom_components.tv_guide.const import DOMAIN

CARD_PATH = "/tv_guide_frontend/tv-guide.js"
CARD_URL = f"{CARD_PATH}?v=0.1.0"
FRONTEND_FOLDER = Path(tv_guide.__file__).parent / "frontend"


@pytest.fixture
def dummy_card() -> Iterator[Path]:
    """Write a dummy card into the integration folder, which has no build in tests. Remove it afterwards."""
    folder_existed = FRONTEND_FOLDER.exists()
    FRONTEND_FOLDER.mkdir(exist_ok=True)
    card = FRONTEND_FOLDER / "tv-guide.js"
    card.write_text("console.log('tv-guide');")
    yield card
    card.unlink()
    if not folder_existed:
        FRONTEND_FOLDER.rmdir()


async def test_card_js_served(hass: HomeAssistant, hass_client: ClientSessionGenerator, dummy_card: Path) -> None:
    """The card file is served below `/tv_guide_frontend`."""
    assert await async_setup_component(hass, DOMAIN, {})
    client = await hass_client()

    response = await client.get(CARD_PATH)

    assert response.status == 200
    assert await response.text() == "console.log('tv-guide');"


async def test_extra_js_url_added(hass: HomeAssistant, dummy_card: Path) -> None:
    """The URL carries the manifest version, so a new release busts the browser cache."""
    assert await async_setup_component(hass, DOMAIN, {})

    assert CARD_URL in hass.data[DATA_EXTRA_MODULE_URL].urls


async def test_missing_build_is_skipped(hass: HomeAssistant, caplog: pytest.LogCaptureFixture) -> None:
    """Without a build the setup still works: nothing is served and no URL is added."""
    assert not FRONTEND_FOLDER.exists()

    with caplog.at_level(logging.WARNING):
        assert await async_setup_component(hass, DOMAIN, {})

    assert CARD_URL not in hass.data[DATA_EXTRA_MODULE_URL].urls
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "card" in r.getMessage()]
    assert len(warnings) == 1
