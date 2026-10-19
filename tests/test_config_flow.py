import gzip
from datetime import timedelta

from homeassistant.config_entries import ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType

from custom_components.tv_guide.const import DOMAIN
from tests.conftest import URL


async def _start_user_flow(hass, url: str = URL):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    return await hass.config_entries.flow.async_configure(result["flow_id"], {"url": url})


async def test_flow_user_then_channels(hass, aioclient_mock, guide_xml) -> None:
    aioclient_mock.get(URL, content=guide_xml)
    result = await _start_user_flow(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "channels"
    options = result["data_schema"].schema["channels"].config["options"]
    assert options == [
        # The card config needs the guide id, so the label shows it when it is not the name.
        {"value": "Other", "label": "Other channel (id: Other)"},
        {"value": "Polsat", "label": "Polsat"},
        {"value": "TVN", "label": "TVN"},
    ]

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"channels": ["TVN", "Polsat"]})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {"url": URL}
    assert result["options"] == {"channels": ["TVN", "Polsat"], "update_interval": 12}


async def test_flow_needs_a_channel(hass, aioclient_mock, guide_xml) -> None:
    aioclient_mock.get(URL, content=guide_xml)
    result = await _start_user_flow(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"channels": []})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "channels"
    assert result["errors"] == {"channels": "no_channels"}


async def test_flow_errors(hass, aioclient_mock) -> None:
    aioclient_mock.get(URL, status=404)
    result = await _start_user_flow(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    assert result["errors"] == {"base": "cannot_connect"}

    aioclient_mock.clear_requests()
    aioclient_mock.get(URL, content=b"<tv><programme")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": URL})
    assert result["step_id"] == "user"
    assert result["errors"] == {"base": "invalid_guide"}


async def test_flow_broken_gzip_is_invalid_guide(hass, aioclient_mock, guide_xml) -> None:
    aioclient_mock.get(URL, content=gzip.compress(guide_xml)[:100])
    result = await _start_user_flow(hass)
    assert result["errors"] == {"base": "invalid_guide"}


async def test_flow_same_url_aborts(hass, loaded_entry, aioclient_mock) -> None:
    result = await _start_user_flow(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_options_flow_changes_channels(hass, loaded_entry, aioclient_mock) -> None:
    calls = aioclient_mock.call_count
    result = await hass.config_entries.options.async_init(loaded_entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"
    # The choices come from the stored guide, without a download.
    assert aioclient_mock.call_count == calls
    options = result["data_schema"].schema["channels"].config["options"]
    assert {o["value"] for o in options} == {"TVN", "Polsat", "Other"}
    assert {o["label"] for o in options} == {"TVN", "Polsat", "Other channel (id: Other)"}

    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"channels": ["TVN"], "update_interval": 6}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    assert loaded_entry.state is ConfigEntryState.LOADED
    assert loaded_entry.options == {"channels": ["TVN"], "update_interval": 6}
    coordinator = loaded_entry.runtime_data
    assert set(coordinator.data.channels) == {"TVN"}
    assert coordinator.update_interval == timedelta(hours=6)


async def test_options_flow_aborts_when_not_loaded(hass, mock_entry) -> None:
    result = await hass.config_entries.options.async_init(mock_entry.entry_id)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "not_loaded"
