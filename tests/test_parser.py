import io
from datetime import UTC

import pytest

from custom_components.tv_guide.parser import ParseError, parse_channels, parse_guide
from tests.conftest import NOW


def test_parse_channels_lists_all(guide_xml):
    assert [(c.id, c.name) for c in parse_channels(io.BytesIO(guide_xml))] == [
        ("TVN", "TVN"),
        ("Polsat", "Polsat"),
        ("Other", "Other channel"),
    ]


def test_parse_keeps_selected_channels(guide):
    assert set(guide.channels) == {"TVN", "Polsat"}
    assert set(guide.programmes) == {"TVN", "Polsat"}
    assert guide.available_channels == {"TVN": "TVN", "Polsat": "Polsat", "Other": "Other channel"}


def test_parse_drops_old_untitled_and_duplicate_start(guide):
    assert [p.title for p in guide.programmes["TVN"]] == ["Fakty", "Sport", "Info", "Fakty", "Info", "Uwaga", "Fakty"]
    assert [p.title for p in guide.programmes["Polsat"]] == [
        "Życie na fali",
        "Mecz (finał) *",
        "Fakty",
        "Fakty po południu",
        "Nocne kino",
        "Po kinie",
    ]


def test_parse_fields(guide):
    fakty = guide.programmes["TVN"][0]
    assert (fakty.episode, fakty.categories, fakty.rating) == ("E519", ("program informacyjny",), "12")
    assert fakty.image_url == "https://img.example/fakty.jpg"
    zycie = guide.programmes["Polsat"][0]
    assert (zycie.year, zycie.countries, zycie.rating, zycie.star_rating) == ("2016", ("Maroko", "USA"), None, "6/10")
    assert zycie.description == "Opis & więcej"


def test_parse_dst_offsets(guide):
    night = guide.programmes["Polsat"][-2:]
    assert [p.start.astimezone(UTC).isoformat() for p in night] == [
        "2026-10-25T00:30:00+00:00",
        "2026-10-25T01:15:00+00:00",
    ]
    assert len({p.id for p in night}) == 2


def test_parse_invalid_xml_raises():
    with pytest.raises(ParseError):
        parse_guide(io.BytesIO(b"<tv><programme"), set(), NOW)
