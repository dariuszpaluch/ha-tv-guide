"""Diagnostics help with bug reports, so they must show the state of the guide but never the login in the URL."""

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.diagnostics import get_diagnostics_for_config_entry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.tv_guide.const import DOMAIN
from custom_components.tv_guide.store import GuideStore
from tests.conftest import NOW

SECRET_URL = "https://iptv.example/xmltv.php?username=me&password=secret"


async def test_diagnostics(
    clock_at_now, hass: HomeAssistant, hass_client, aioclient_mock: AiohttpClientMocker, guide_xml: bytes
) -> None:
    # `clock_at_now` comes first: the test login token must be created after the clock is frozen.
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="iptv.example",
        unique_id=SECRET_URL,
        data={"url": SECRET_URL},
        options={"channels": ["TVN", "Polsat", "Gone"], "update_interval": 12},
    )
    entry.add_to_hass(hass)
    aioclient_mock.get(SECRET_URL, content=guide_xml)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED

    result = await get_diagnostics_for_config_entry(hass, hass_client, entry)
    # The download time is in the time zone of the test HA, the programme times in the offset of the guide.
    downloaded = dt_util.as_local(NOW).isoformat()

    assert "secret" not in str(result)
    assert "username" not in str(result)
    assert result == {
        "source": "https://iptv.example",
        "options": {"channels": ["TVN", "Polsat", "Gone"], "update_interval": 12},
        "last_update_success": True,
        "last_error": None,
        "last_success": downloaded,
        "guide": {
            "fetched_at": downloaded,
            "channels_in_source": 3,
            "selected_not_in_source": ["Gone"],
            "programmes": {"TVN": 7, "Polsat": 6, "Gone": 0},
            "first_start": "2026-10-19T19:00:00+02:00",
            "last_stop": "2026-10-25T03:00:00+01:00",
        },
    }


async def test_diagnostics_after_a_failed_download(
    clock_at_now, hass: HomeAssistant, hass_client, aioclient_mock: AiohttpClientMocker, guide
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=SECRET_URL,
        data={"url": SECRET_URL},
        options={"channels": ["TVN", "Polsat"], "update_interval": 12},
    )
    entry.add_to_hass(hass)
    await GuideStore(hass, entry.entry_id).async_save(guide)
    aioclient_mock.get(SECRET_URL, status=503)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)

    result = await get_diagnostics_for_config_entry(hass, hass_client, entry)

    assert result["last_update_success"] is False
    assert result["last_error"] == "UpdateFailed: Cannot update the guide: HTTP 503 from https://iptv.example"
    assert result["guide"]["programmes"] == {"TVN": 7, "Polsat": 6}
    assert "secret" not in str(result)
