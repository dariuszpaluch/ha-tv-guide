import dataclasses
from datetime import datetime
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import MockHAClientWebSocket

from custom_components.tv_guide.const import DOMAIN
from tests.conftest import NOW, URL


async def call(ws: MockHAClientWebSocket, command: str, **fields: Any) -> dict[str, Any]:
    """Send one command and return the whole reply."""
    await ws.send_json_auto_id({"type": f"tv_guide/{command}", **fields})
    return await ws.receive_json()


async def test_now(ws, loaded_entry) -> None:
    msg = await call(ws, "now", channel_ids=["TVN", "Nope"])
    assert msg["result"]["TVN"]["title"] == "Fakty"
    assert msg["result"]["TVN"]["start"] == "2026-10-19T19:00:00+02:00"
    assert msg["result"]["Nope"] is None


async def test_schedule(ws, loaded_entry) -> None:
    msg = await call(ws, "schedule", channel_id="TVN", start="2026-10-19T17:30:00Z", end="2026-10-20T03:00:00Z")
    assert [p["title"] for p in msg["result"]] == ["Fakty", "Sport", "Info"]


async def test_schedule_bad_time(ws, loaded_entry) -> None:
    msg = await call(ws, "schedule", channel_id="TVN", start="yesterday", end="2026-10-20T03:00:00Z")
    assert msg["error"]["code"] == "invalid_format"


@pytest.mark.parametrize("start", ["2026-10-19T25:00:00+02:00", "2026-13-45T00:00:00Z", "2026-10-19T19:00:00+99:00"])
async def test_schedule_impossible_time(ws, loaded_entry, start) -> None:
    msg = await call(ws, "schedule", channel_id="TVN", start=start, end="2026-10-20T03:00:00Z")
    assert msg["error"]["code"] == "invalid_format"


async def test_schedule_time_without_offset(ws, loaded_entry) -> None:
    msg = await call(ws, "schedule", channel_id="TVN", start="2026-10-19T17:30:00", end="2026-10-20T03:00:00Z")
    assert msg["error"]["code"] == "invalid_format"


async def test_search_now_and_later(ws, loaded_entry) -> None:
    msg = await call(ws, "search", query="zycie", channel_ids=["TVN", "Polsat"], when="now")
    assert [p["title"] for p in msg["result"]] == ["Życie na fali"]

    msg = await call(ws, "search", query="fakty", channel_ids=["TVN"], when="later")
    assert len(msg["result"]) == 1
    assert msg["result"][0]["start"].startswith("2026-10-20")


async def test_search_limit(ws, loaded_entry) -> None:
    msg = await call(ws, "search", query="fa", channel_ids=["TVN", "Polsat"], when="later", limit=1)
    assert len(msg["result"]) == 1


async def test_search_limit_out_of_range(ws, loaded_entry) -> None:
    msg = await call(ws, "search", query="fakty", channel_ids=["TVN"], when="later", limit=101)
    assert msg["error"]["code"] == "invalid_format"


async def test_search_short_query_invalid(ws, loaded_entry) -> None:
    msg = await call(ws, "search", query=" a ", channel_ids=["TVN"], when="now")
    assert msg["error"]["code"] == "invalid_format"


async def test_search_bad_when(ws, loaded_entry) -> None:
    msg = await call(ws, "search", query="fakty", channel_ids=["TVN"], when="never")
    assert msg["error"]["code"] == "invalid_format"


async def test_airings(ws, loaded_entry) -> None:
    msg = await call(ws, "airings", programme_id="TVN|2026-10-19T17:00:00Z", channel_ids=["TVN", "Polsat"])
    assert [p["channel_id"] for p in msg["result"]] == ["TVN", "TVN", "Polsat"]


async def test_airings_unknown_programme(ws, loaded_entry) -> None:
    msg = await call(ws, "airings", programme_id="TVN|2000-01-01T00:00:00Z", channel_ids=["TVN"])
    assert msg["result"] == []


async def test_channels_sorted_by_name(ws, loaded_entry) -> None:
    msg = await call(ws, "channels")
    assert [c["id"] for c in msg["result"]] == ["Polsat", "TVN"]
    assert msg["result"][1] == {"id": "TVN", "name": "TVN", "icon": "http://img.example/tvn.png"}


async def test_channels_sorted_ignoring_case(hass, ws, loaded_entry) -> None:
    """A lower case name sorts with the others, not after all capitals."""
    coordinator = loaded_entry.runtime_data
    tvn = coordinator.data.channels["TVN"]
    coordinator.data.channels["TVN"] = dataclasses.replace(tvn, name="tvn")
    msg = await call(ws, "channels")
    assert [c["name"] for c in msg["result"]] == ["Polsat", "tvn"]
    coordinator.data.channels["Polsat"] = dataclasses.replace(coordinator.data.channels["Polsat"], name="Zebra")
    msg = await call(ws, "channels")
    assert [c["name"] for c in msg["result"]] == ["tvn", "Zebra"]


async def test_info(ws, loaded_entry) -> None:
    msg = await call(ws, "info")
    assert set(msg["result"]) == {"last_success", "update_interval"}
    assert msg["result"]["update_interval"] == 12
    # The test time zone of Home Assistant is not Warsaw, so compare the moment, not the text.
    assert datetime.fromisoformat(msg["result"]["last_success"]) == NOW


async def test_entry_id_selects_entry(ws, loaded_entry) -> None:
    msg = await call(ws, "info", entry_id=loaded_entry.entry_id)
    assert msg["result"]["update_interval"] == 12


async def test_not_found_without_entry(ws) -> None:
    msg = await call(ws, "info")
    assert msg["error"]["code"] == "not_found"


async def test_not_found_for_unknown_entry_id(ws, loaded_entry) -> None:
    msg = await call(ws, "info", entry_id="nope")
    assert msg["error"]["code"] == "not_found"


async def test_without_entry_id_the_first_loaded_entry_answers(hass, ws, aioclient_mock, guide_xml) -> None:
    disabled = MockConfigEntry(
        domain=DOMAIN,
        unique_id="http://other/guide.xml",
        data={"url": "http://other/guide.xml"},
        options={"channels": ["TVN"], "update_interval": 6},
        disabled_by=ConfigEntryDisabler.USER,
    )
    disabled.add_to_hass(hass)
    loaded = MockConfigEntry(
        domain=DOMAIN, unique_id=URL, data={"url": URL}, options={"channels": ["TVN"], "update_interval": 12}
    )
    loaded.add_to_hass(hass)
    aioclient_mock.get(URL, content=guide_xml)
    assert await hass.config_entries.async_setup(loaded.entry_id)
    await hass.async_block_till_done()
    assert hass.config_entries.async_entries(DOMAIN)[0] is disabled
    assert loaded.state is ConfigEntryState.LOADED

    msg = await call(ws, "info")
    assert msg["result"]["update_interval"] == 12

    msg = await call(ws, "info", entry_id=disabled.entry_id)
    assert msg["error"]["code"] == "not_loaded"


async def test_not_loaded_while_setup_retry(hass, ws, aioclient_mock, mock_entry) -> None:
    aioclient_mock.get(URL, status=503)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    assert mock_entry.state is ConfigEntryState.SETUP_RETRY
    msg = await call(ws, "info")
    assert msg["error"]["code"] == "not_loaded"
