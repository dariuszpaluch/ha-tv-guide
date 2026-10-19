from datetime import datetime, timedelta

from custom_components.tv_guide.search import (
    airings,
    normalize,
    now_on_air,
    schedule,
    search_later,
    search_now,
)
from tests.conftest import NOW, WAW


def test_normalize():
    assert normalize("  ŻYCIE Łódź ") == "zycie lodz"


def test_now_on_air(guide):
    result = now_on_air(guide, ["TVN", "Polsat"], NOW)
    assert (result["TVN"].title, result["Polsat"].title) == ("Fakty", "Życie na fali")


def test_now_unknown_channel(guide):
    assert now_on_air(guide, ["Nope"], NOW) == {"Nope": None}


def test_now_nothing_on_air(guide):
    assert now_on_air(guide, ["TVN"], datetime(2026, 10, 19, 12, tzinfo=WAW)) == {"TVN": None}


def test_schedule_overlap(guide):
    day = schedule(guide, "TVN", datetime(2026, 10, 19, 19, 30, tzinfo=WAW), datetime(2026, 10, 20, 5, tzinfo=WAW))
    assert [p.title for p in day] == ["Fakty", "Sport", "Info"]


def test_schedule_dst_night(guide):
    day = schedule(guide, "Polsat", datetime(2026, 10, 24, 5, tzinfo=WAW), datetime(2026, 10, 25, 5, tzinfo=WAW))
    assert [p.title for p in day] == ["Nocne kino", "Po kinie"]


def test_schedule_unknown_channel(guide):
    assert schedule(guide, "Nope", NOW, NOW + timedelta(days=1)) == []


def test_search_ignores_case_and_diacritics(guide):
    for query in ["życie", "zycie", "ŻYCIE", "  Życie "]:
        assert [p.title for p in search_now(guide, query, ["TVN", "Polsat"], NOW)] == ["Życie na fali"]


def test_search_special_characters(guide):
    assert [p.title for p in search_later(guide, "(finał) *", ["Polsat"], NOW, 40)] == ["Mecz (finał) *"]


def test_search_now_follows_channel_order(guide):
    result = search_now(guide, "a", ["Polsat", "TVN"], NOW)
    assert [p.channel_id for p in result] == ["Polsat", "TVN"]


def test_search_later_one_per_channel_and_title(guide):
    result = search_later(guide, "fakty", ["TVN"], NOW, 40)
    assert [(p.title, p.start.day) for p in result] == [("Fakty", 20)]


def test_search_later_soonest_first_and_limit(guide):
    result = search_later(guide, "a", ["TVN", "Polsat"], NOW, 2)
    assert [(p.channel_id, p.title) for p in result] == [("Polsat", "Mecz (finał) *"), ("Polsat", "Fakty")]


def test_search_unknown_channel(guide):
    assert search_now(guide, "a", ["Nope"], NOW) == []
    assert search_later(guide, "a", ["Nope"], NOW, 40) == []


def test_airings_same_channel_first(guide):
    result = airings(guide, "TVN|2026-10-19T17:00:00Z", ["TVN", "Polsat"], NOW, 20)
    assert [(p.channel_id, p.start.day, p.start.hour) for p in result] == [
        ("TVN", 20, 19),
        ("TVN", 21, 19),
        ("Polsat", 20, 7),
    ]


def test_airings_exact_title_only(guide):
    titles = {p.title for p in airings(guide, "TVN|2026-10-19T17:00:00Z", ["TVN", "Polsat"], NOW, 20)}
    assert titles == {"Fakty"}


def test_airings_only_listed_channels_and_limit(guide):
    assert [p.channel_id for p in airings(guide, "TVN|2026-10-19T17:00:00Z", ["TVN"], NOW, 20)] == ["TVN", "TVN"]
    assert len(airings(guide, "TVN|2026-10-19T17:00:00Z", ["TVN", "Polsat"], NOW, 1)) == 1


def test_airings_own_channel_without_listing_it(guide):
    result = airings(guide, "TVN|2026-10-19T17:00:00Z", ["Polsat"], NOW, 20)
    assert [p.channel_id for p in result] == ["TVN", "TVN", "Polsat"]


def test_airings_none_for_short_programme(guide):
    assert airings(guide, "TVN|2026-10-19T17:50:00Z", ["TVN", "Polsat"], NOW, 20) == []


def test_airings_unknown_programme(guide):
    assert airings(guide, "TVN|2000-01-01T00:00:00Z", ["TVN"], NOW, 20) == []
