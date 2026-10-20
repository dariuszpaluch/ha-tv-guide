"""Every translation of the setup screens must match the English one, so no screen shows a raw key."""

import json
import re
from pathlib import Path
from typing import Any

import pytest

FOLDER = Path(__file__).parent.parent / "custom_components" / "tv_guide" / "translations"
PLACEHOLDER = re.compile(r"\{(\w+)\}")
LANGUAGES = sorted(path.name for path in FOLDER.glob("*.json") if path.name != "qqq.json")


def _read(name: str) -> dict[str, Any]:
    """Read one translation file."""
    return json.loads((FOLDER / name).read_text(encoding="utf-8"))


def _flatten(data: dict[str, Any], prefix: str = "") -> dict[str, str]:
    """Turn nested keys into paths such as `config.step.user.title`."""
    flat: dict[str, str] = {}
    for key, value in data.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            flat.update(_flatten(value, f"{path}."))
        else:
            flat[path] = value
    return flat


ENGLISH = _flatten(_read("en.json"))


def test_english_and_polish_exist() -> None:
    assert {"en.json", "pl.json"} <= set(LANGUAGES)


def test_strings_json_is_not_used() -> None:
    """A custom integration reads only `translations/`. A `strings.json` would be a copy to keep in sync."""
    assert not (FOLDER.parent / "strings.json").exists()


@pytest.mark.parametrize("name", LANGUAGES)
def test_same_keys_as_english(name: str) -> None:
    assert sorted(_flatten(_read(name))) == sorted(ENGLISH)


@pytest.mark.parametrize("name", LANGUAGES)
def test_same_placeholders_as_english(name: str) -> None:
    translation = _flatten(_read(name))
    for key, text in ENGLISH.items():
        assert sorted(PLACEHOLDER.findall(translation[key])) == sorted(PLACEHOLDER.findall(text)), key


def test_notes_for_translators_cover_every_key() -> None:
    notes = _flatten(_read("qqq.json"))
    assert sorted(notes) == sorted(ENGLISH)
    assert all(isinstance(note, str) and note for note in notes.values())


def test_every_field_has_help() -> None:
    """Each field of a setup screen has a `data_description`, shown under the field."""
    english = _read("en.json")
    for section in ("config", "options"):
        for step in english[section]["step"].values():
            assert sorted(step.get("data_description", {})) == sorted(step["data"])
