"""Tests of the reminder model: matching moved programmes and reconciling with a new guide."""

from datetime import datetime, timedelta, timezone

from custom_components.tv_guide.const import REMINDER_LEAD
from custom_components.tv_guide.model import Guide, Programme
from custom_components.tv_guide.reminders import Reminder, find_moved, reconcile

from .conftest import NOW, WAW

PLUS_TWO = timezone(timedelta(hours=2))


def make(programme_id: str, title: str, start: datetime, user_id: str = "u1") -> Reminder:
    """A reminder for the channel in the programme id."""
    return Reminder(
        user_id=user_id,
        programme_id=programme_id,
        channel_id=programme_id.rpartition("|")[0],
        title=title,
        start=start,
        language="pl",
    )


def programme(channel_id: str, title: str, start: datetime, length: timedelta = timedelta(minutes=30)) -> Programme:
    """A programme with only the fields that matter here."""
    return Programme(
        channel_id=channel_id,
        start=start,
        stop=start + length,
        title=title,
        subtitle=None,
        description=None,
        episode=None,
        categories=(),
        image_url=None,
        rating=None,
        star_rating=None,
        year=None,
        countries=(),
    )


def test_same_id_keeps_the_reminder_and_takes_the_new_title(guide: Guide) -> None:
    reminder = make("TVN|2026-10-20T17:00:00Z", "Old title", datetime(2026, 10, 20, 19, 0, tzinfo=WAW))

    result = reconcile([reminder], guide)

    assert result.kept[0].title == "Fakty"
    assert result.kept[0].programme_id == reminder.programme_id
    assert result.gone == []


def test_moved_by_ten_minutes_is_found(guide: Guide) -> None:
    reminder = make("TVN|2026-10-20T17:45:00Z", "Uwaga", datetime(2026, 10, 20, 19, 45, tzinfo=WAW))

    result = reconcile([reminder], guide)

    assert result.kept[0].programme_id == "TVN|2026-10-20T17:55:00Z"
    assert result.kept[0].start == datetime(2026, 10, 20, 19, 55, tzinfo=WAW)
    assert result.gone == []


def test_moved_more_than_three_hours_is_gone(guide: Guide) -> None:
    reminder = make("TVN|2026-10-20T14:40:00Z", "Uwaga", datetime(2026, 10, 20, 16, 40, tzinfo=WAW))

    result = reconcile([reminder], guide)

    assert result.kept == []
    assert result.gone == [reminder]


def test_title_matches_after_normalize(guide: Guide) -> None:
    reminder = make("TVN|2026-10-20T17:45:00Z", "  UWAGA ", datetime(2026, 10, 20, 19, 45, tzinfo=WAW))

    result = reconcile([reminder], guide)

    assert result.kept[0].title == "Uwaga"


def test_channel_without_data_around_the_start_is_kept(guide: Guide) -> None:
    reminder = make("Polsat|2026-10-22T10:00:00Z", "Fakty", datetime(2026, 10, 22, 12, 0, tzinfo=WAW))

    result = reconcile([reminder], guide)

    assert result.kept == [reminder]
    assert result.gone == []


def test_channel_not_in_guide_is_kept(guide: Guide) -> None:
    reminder = make("Other|2026-10-20T17:00:00Z", "X", datetime(2026, 10, 20, 19, 0, tzinfo=WAW))

    result = reconcile([reminder], guide)

    assert result.kept == [reminder]
    assert result.gone == []


def test_closest_of_two_candidates_wins() -> None:
    early = programme("TVN", "Fakty", datetime(2026, 10, 20, 17, 0, tzinfo=PLUS_TWO))
    late = programme("TVN", "Fakty", datetime(2026, 10, 20, 18, 30, tzinfo=PLUS_TWO))
    guide = Guide(
        channels={},
        programmes={"TVN": [early, late]},
        available_channels={},
        fetched_at=NOW,
    )
    reminder = make("TVN|2026-10-20T15:50:00Z", "Fakty", datetime(2026, 10, 20, 17, 50, tzinfo=PLUS_TWO))

    assert find_moved(reminder, guide).start.hour == 18  # 40 minutes away, the other is 50


def test_find_moved_returns_none_without_a_match(guide: Guide) -> None:
    reminder = make("TVN|2026-10-20T17:45:00Z", "No such title", datetime(2026, 10, 20, 19, 45, tzinfo=WAW))

    assert find_moved(reminder, guide) is None


def test_due_is_five_minutes_before_the_start() -> None:
    reminder = make("TVN|2026-10-20T17:00:00Z", "Fakty", datetime(2026, 10, 20, 19, 0, tzinfo=WAW))

    assert reminder.due == reminder.start - REMINDER_LEAD
    assert reminder.due == datetime(2026, 10, 20, 18, 55, tzinfo=WAW)


def test_from_programme_copies_the_programme(guide: Guide) -> None:
    fakty = guide.find("TVN|2026-10-20T17:00:00Z")
    assert fakty is not None

    reminder = Reminder.from_programme("u1", fakty, "pl")

    assert reminder == make("TVN|2026-10-20T17:00:00Z", "Fakty", fakty.start)


def test_round_trip_to_dict() -> None:
    reminder = make("TVN|2026-10-20T17:00:00Z", "Fakty", datetime(2026, 10, 20, 19, 0, tzinfo=PLUS_TWO))

    restored = Reminder.from_dict(reminder.to_dict())

    assert restored == reminder
    assert restored.start.utcoffset() == timedelta(hours=2)
    assert reminder.to_dict()["start"] == "2026-10-20T19:00:00+02:00"
