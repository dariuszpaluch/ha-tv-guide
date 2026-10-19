import re

from custom_components.tv_guide.model import Guide, image_id, programme_to_json


def test_programme_id_uses_utc(guide):
    assert guide.programmes["TVN"][0].id == "TVN|2026-10-19T17:00:00Z"


def test_find(guide):
    assert guide.find("TVN|2026-10-19T17:00:00Z").title == "Fakty"
    assert guide.find("TVN|2000-01-01T00:00:00Z") is None


def test_image_id_is_32_hex():
    assert re.fullmatch(r"[0-9a-f]{32}", image_id("https://img.example/fakty.jpg"))


def test_programme_to_json_matches_contract(guide):
    data = programme_to_json(guide.programmes["TVN"][0])
    assert data["image"] == f"/api/tv_guide/image/{image_id('https://img.example/fakty.jpg')}"
    assert data["start"] == "2026-10-19T19:00:00+02:00"
    assert set(data) == {
        "id",
        "channel_id",
        "start",
        "stop",
        "title",
        "subtitle",
        "description",
        "episode",
        "categories",
        "image",
        "rating",
        "star_rating",
        "year",
        "countries",
    }


def test_guide_round_trip(guide):
    assert Guide.from_dict(guide.to_dict()) == guide
