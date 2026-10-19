"""Config flow: ask for the XMLTV URL, then for the channels. The options flow edits both later."""

from collections.abc import Mapping
from typing import Any

import probatio
from homeassistant.config_entries import ConfigEntryState, ConfigFlow, ConfigFlowResult, OptionsFlowWithReload
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
from yarl import URL

from .const import DEFAULT_UPDATE_INTERVAL, DOMAIN
from .coordinator import SOURCE_READ_ERRORS, TvGuideConfigEntry, read_source
from .model import Channel
from .parser import parse_channels
from .source import SourceError, fetch_source

CONF_URL = "url"
CONF_CHANNELS = "channels"
CONF_UPDATE_INTERVAL = "update_interval"
MIN_UPDATE_INTERVAL = 1
MAX_UPDATE_INTERVAL = 48


def _channel_selector(names: Mapping[str, str]) -> SelectSelector:
    """Multiple choice of channels, sorted by name."""
    options = [SelectOptionDict(value=cid, label=name) for cid, name in names.items()]
    options.sort(key=lambda option: option["label"].casefold())
    return SelectSelector(SelectSelectorConfig(options=options, multiple=True))


class TvGuideConfigFlow(ConfigFlow, domain=DOMAIN):
    """Config flow of the TV guide."""

    VERSION = 1

    def __init__(self) -> None:
        """Start without a URL."""
        self._url = ""
        self._names: dict[str, str] = {}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: TvGuideConfigEntry) -> TvGuideOptionsFlow:
        """Create the options flow."""
        return TvGuideOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for the URL and check that the source can be read."""
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL]
            await self.async_set_unique_id(url)
            self._abort_if_unique_id_configured()
            errors, channels = await self._async_read_channels(url)
            if not errors:
                self._url = url
                self._names = {channel.id: channel.name for channel in channels}
                return await self.async_step_channels()
        schema = probatio.Schema(
            {probatio.Required(CONF_URL): TextSelector(TextSelectorConfig(type=TextSelectorType.URL))}
        )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(schema, user_input),
            errors=errors,
        )

    async def async_step_channels(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask which channels to keep. At least one is needed."""
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input[CONF_CHANNELS]:
                return self.async_create_entry(
                    title=URL(self._url).host or "TV guide",
                    data={CONF_URL: self._url},
                    options={CONF_CHANNELS: user_input[CONF_CHANNELS], CONF_UPDATE_INTERVAL: DEFAULT_UPDATE_INTERVAL},
                )
            errors[CONF_CHANNELS] = "no_channels"
        schema = probatio.Schema({probatio.Required(CONF_CHANNELS): _channel_selector(self._names)})
        return self.async_show_form(step_id="channels", data_schema=schema, errors=errors)

    async def _async_read_channels(self, url: str) -> tuple[dict[str, str], list[Channel]]:
        """Download the source and list its channels. Return form errors and the channels."""
        try:
            raw = await fetch_source(async_get_clientsession(self.hass), url)
        except SourceError:
            return {"base": "cannot_connect"}, []
        try:
            channels = await self.hass.async_add_executor_job(read_source, raw, parse_channels)
        except SOURCE_READ_ERRORS:
            return {"base": "invalid_guide"}, []
        return {}, channels


class TvGuideOptionsFlow(OptionsFlowWithReload):
    """Change the channels and the update interval. The entry reloads when they change."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show the channel list of the stored guide, without a download."""
        entry: TvGuideConfigEntry = self.config_entry
        if entry.state is not ConfigEntryState.LOADED:
            return self.async_abort(reason="not_loaded")
        if user_input is not None:
            if user_input[CONF_CHANNELS]:
                return self.async_create_entry(
                    data={
                        CONF_CHANNELS: user_input[CONF_CHANNELS],
                        CONF_UPDATE_INTERVAL: int(user_input[CONF_UPDATE_INTERVAL]),
                    }
                )
        names = entry.runtime_data.data.available_channels
        selected = [cid for cid in entry.options[CONF_CHANNELS] if cid in names]
        schema = probatio.Schema(
            {
                probatio.Required(CONF_CHANNELS, default=selected): _channel_selector(names),
                probatio.Required(CONF_UPDATE_INTERVAL, default=entry.options[CONF_UPDATE_INTERVAL]): NumberSelector(
                    NumberSelectorConfig(
                        min=MIN_UPDATE_INTERVAL,
                        max=MAX_UPDATE_INTERVAL,
                        step=1,
                        unit_of_measurement="h",
                        mode=NumberSelectorMode.BOX,
                    )
                ),
            }
        )
        errors = {CONF_CHANNELS: "no_channels"} if user_input is not None else {}
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
