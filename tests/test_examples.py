"""The example card config must stay valid, so people can paste it as it is."""

from pathlib import Path

import yaml

EXAMPLE = Path(__file__).parent.parent / "examples" / "card.yaml"
CHANNEL_KEYS = {"number", "name", "epg_id", "logo", "logo_tile"}


def test_example_card_config_is_valid() -> None:
    config = yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))
    assert config["type"] == "custom:tv-guide"
    assert set(config["switch_action"]) <= {"perform_action", "data"}
    channels = [channel for section in config["sections"] for channel in section["channels"]]
    assert channels
    for channel in channels:
        assert set(channel) <= CHANNEL_KEYS, channel
        assert isinstance(channel["number"], int), channel
        assert isinstance(channel["name"], str), channel
        assert isinstance(channel["epg_id"], str), channel
    numbers = [channel["number"] for channel in channels]
    assert len(numbers) == len(set(numbers)), "channel numbers must be unique"
    ids = [channel["epg_id"] for channel in channels]
    assert len(ids) == len(set(ids)), "guide ids must be unique"
