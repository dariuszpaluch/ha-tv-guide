import io
import tracemalloc
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


def _big_guide(programmes: int = 20_000) -> bytes:
    """A generated guide of a few MB: 50 channels and many programmes."""
    rows = [f'<channel id="C{n}"><display-name>Channel {n}</display-name></channel>' for n in range(50)]
    rows += [
        f'<programme start="20261019{n % 24:02d}0000 +0000" stop="20261019{n % 24:02d}3000 +0000" channel="C{n % 50}">'
        f"<title>Programme {n}</title><desc>{'text ' * 40}</desc></programme>"
        for n in range(programmes)
    ]
    return ('<?xml version="1.0"?><tv>' + "".join(rows) + "</tv>").encode()


def _peak_memory(parse) -> tuple[int, int]:
    """Return the peak memory of `parse` and the size of the XML, in bytes."""
    data = _big_guide()
    stream = io.BytesIO(data)
    tracemalloc.start()
    try:
        parse(stream)
        return tracemalloc.get_traced_memory()[1], len(data)
    finally:
        tracemalloc.stop()


def test_parse_channels_memory_stays_small():
    """A whole XML tree is 3 times the XML size. The parser must stay far below that."""
    peak, size = _peak_memory(parse_channels)
    assert size > 4_000_000
    assert peak < size * 0.1


def test_parse_guide_memory_stays_small():
    peak, size = _peak_memory(lambda s: parse_guide(s, {"C1", "C2"}, NOW))
    assert size > 4_000_000
    assert peak < size * 0.1


def _guide_with_times(*times: tuple[str, str]) -> bytes:
    rows = "".join(
        f'<programme start="{start}" stop="{stop}" channel="TVN"><title>P{n}</title></programme>'
        for n, (start, stop) in enumerate(times)
    )
    return f'<tv><channel id="TVN"><display-name>TVN</display-name></channel>{rows}</tv>'.encode()


def test_parse_time_without_offset_is_utc():
    xml = _guide_with_times(("20261019190000", "20261019200000"))
    guide = parse_guide(io.BytesIO(xml), {"TVN"}, NOW)
    programme = guide.programmes["TVN"][0]
    assert programme.start.astimezone(UTC).isoformat() == "2026-10-19T19:00:00+00:00"
    assert programme.stop.astimezone(UTC).isoformat() == "2026-10-19T20:00:00+00:00"


def test_parse_skips_bad_time_and_warns_once(caplog):
    xml = _guide_with_times(
        ("20261019190000 +0000", "20261019200000 +0000"),
        ("not a time", "20261019210000 +0000"),
        ("20261019210000 +0000", ""),
        ("20261019220000 +0000", "20261019230000 +0000"),
    )
    with caplog.at_level("WARNING", logger="custom_components.tv_guide.parser"):
        guide = parse_guide(io.BytesIO(xml), {"TVN"}, NOW)
    assert [p.title for p in guide.programmes["TVN"]] == ["P0", "P3"]
    assert [r.getMessage() for r in caplog.records] == ["Skipped 2 programmes with a bad start or stop time"]
