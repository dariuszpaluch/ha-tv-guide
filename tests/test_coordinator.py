import gzip
import io
from datetime import timedelta

from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.tv_guide.coordinator import TvGuideCoordinator
from custom_components.tv_guide.model import Guide
from custom_components.tv_guide.parser import parse_guide
from custom_components.tv_guide.store import GuideStore
from tests.conftest import NOW, URL


async def test_update_saves_guide(hass, loaded_entry, hass_storage) -> None:
    coordinator = loaded_entry.runtime_data
    assert set(coordinator.data.channels) == {"TVN", "Polsat"}
    assert coordinator.last_success is not None
    assert f"tv_guide.{loaded_entry.entry_id}" in hass_storage


async def test_update_interval_from_options(hass, loaded_entry) -> None:
    assert loaded_entry.runtime_data.update_interval == timedelta(hours=12)


async def test_update_failure_keeps_guide(hass, loaded_entry, aioclient_mock) -> None:
    aioclient_mock.clear_requests()
    aioclient_mock.get(URL, status=503)
    await loaded_entry.runtime_data.async_refresh()
    assert loaded_entry.runtime_data.last_update_success is False
    assert "TVN" in loaded_entry.runtime_data.data.channels


async def test_update_invalid_xml_keeps_guide(hass, loaded_entry, aioclient_mock) -> None:
    aioclient_mock.clear_requests()
    aioclient_mock.get(URL, content=b"<tv><programme")
    await loaded_entry.runtime_data.async_refresh()
    assert loaded_entry.runtime_data.last_update_success is False
    assert "TVN" in loaded_entry.runtime_data.data.channels


async def test_update_broken_gzip_keeps_guide(hass, loaded_entry, aioclient_mock, guide_xml) -> None:
    # The error comes while the parser reads, not when the stream opens.
    aioclient_mock.clear_requests()
    aioclient_mock.get(URL, content=gzip.compress(guide_xml)[:100])
    await loaded_entry.runtime_data.async_refresh()
    assert loaded_entry.runtime_data.last_update_success is False
    assert "TVN" in loaded_entry.runtime_data.data.channels


async def test_periodic_update(hass, loaded_entry, aioclient_mock, freezer) -> None:
    # The coordinator has no entities, so the entry must keep a listener for the timer to run.
    calls = aioclient_mock.call_count
    freezer.tick(timedelta(hours=12, minutes=1))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert aioclient_mock.call_count == calls + 1


def _stored_for(guide_xml: bytes, *channel_ids: str) -> Guide:
    """The fixture source parsed for these channels only, as an older selection would have stored it."""
    return parse_guide(io.BytesIO(guide_xml), set(channel_ids), NOW)


async def test_stored_guide_is_cut_to_a_smaller_selection(hass, mock_entry, guide) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(guide)
    hass.config_entries.async_update_entry(mock_entry, options={**mock_entry.options, "channels": ["TVN"]})
    coordinator = TvGuideCoordinator(hass, mock_entry)
    assert await coordinator.async_load_stored() is True
    assert set(coordinator.data.channels) == {"TVN"}
    assert set(coordinator.data.programmes) == {"TVN"}
    assert coordinator.data.programmes["TVN"] == guide.programmes["TVN"]
    assert coordinator.last_success == guide.fetched_at


async def test_stored_guide_gets_an_empty_channel_for_a_new_selection(hass, mock_entry, guide_xml) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(_stored_for(guide_xml, "TVN"))
    coordinator = TvGuideCoordinator(hass, mock_entry)
    assert await coordinator.async_load_stored() is True
    assert set(coordinator.data.channels) == {"TVN", "Polsat"}
    assert coordinator.data.channels["Polsat"].name == "Polsat"
    assert coordinator.data.programmes["TVN"]
    assert coordinator.data.programmes["Polsat"] == []


async def test_stored_guide_is_not_used_without_a_common_channel(hass, mock_entry, guide_xml) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(_stored_for(guide_xml, "TVN"))
    hass.config_entries.async_update_entry(mock_entry, options={**mock_entry.options, "channels": ["Polsat"]})
    coordinator = TvGuideCoordinator(hass, mock_entry)
    assert await coordinator.async_load_stored() is False
    assert coordinator.data is None


async def test_added_channel_keeps_the_old_ones_while_the_source_is_down(
    hass, aioclient_mock, mock_entry, guide_xml
) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(_stored_for(guide_xml, "TVN"))
    aioclient_mock.get(URL, status=503)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert mock_entry.state is ConfigEntryState.LOADED
    data = mock_entry.runtime_data.data
    assert data.programmes["TVN"]
    assert data.programmes["Polsat"] == []


async def test_added_channel_gets_programmes_after_the_background_refresh(
    hass, aioclient_mock, mock_entry, guide_xml
) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(_stored_for(guide_xml, "TVN"))
    aioclient_mock.get(URL, content=guide_xml)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert mock_entry.runtime_data.data.programmes["Polsat"]


async def test_setup_waits_for_the_source_when_no_stored_channel_is_selected(
    hass, aioclient_mock, mock_entry, guide_xml
) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(_stored_for(guide_xml, "TVN"))
    hass.config_entries.async_update_entry(mock_entry, options={**mock_entry.options, "channels": ["Polsat"]})
    aioclient_mock.get(URL, status=503)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    assert mock_entry.state is ConfigEntryState.SETUP_RETRY


async def test_setup_retries_when_source_down(hass, aioclient_mock, mock_entry) -> None:
    aioclient_mock.get(URL, status=503)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    assert mock_entry.state is ConfigEntryState.SETUP_RETRY


async def test_setup_uses_stored_guide_when_source_down(hass, aioclient_mock, mock_entry, guide) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(guide)
    aioclient_mock.get(URL, status=503)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    assert mock_entry.state is ConfigEntryState.LOADED
    assert mock_entry.runtime_data.data == guide


async def test_stored_guide_is_refreshed_in_background(hass, aioclient_mock, mock_entry, guide, guide_xml) -> None:
    await GuideStore(hass, mock_entry.entry_id).async_save(guide)
    aioclient_mock.get(URL, content=guide_xml)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert aioclient_mock.call_count == 1
    assert mock_entry.runtime_data.last_update_success is True
    assert mock_entry.runtime_data.data.fetched_at != NOW
