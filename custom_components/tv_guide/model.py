"""Guide model: channels, programmes and the contract JSON shapes (see docs/api.md)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

IMAGE_ID_LENGTH = 32
IMAGE_PATH = "/api/tv_guide/image"
ID_TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


@dataclass(frozen=True, slots=True)
class Channel:
    """A TV channel of the guide."""

    id: str
    name: str
    icon: str | None


@dataclass(frozen=True, slots=True)
class Programme:
    """One programme on one channel."""

    channel_id: str
    start: datetime
    stop: datetime
    title: str
    subtitle: str | None
    description: str | None
    episode: str | None
    categories: tuple[str, ...]
    image_url: str | None
    rating: str | None
    star_rating: str | None
    year: str | None
    countries: tuple[str, ...]

    @property
    def id(self) -> str:
        """Id from the channel and the start in UTC. It stays the same when the source changes the offset."""
        return f"{self.channel_id}|{self.start.astimezone(UTC).strftime(ID_TIME_FORMAT)}"


@dataclass(slots=True)
class Guide:
    """The parsed guide.

    `channels` and `programmes` hold the selected channels only. `available_channels`
    maps every channel id of the source to its name, for the options flow.
    """

    channels: dict[str, Channel]
    programmes: dict[str, list[Programme]]
    available_channels: dict[str, str]
    fetched_at: datetime

    def to_dict(self) -> dict[str, Any]:
        """Convert to plain JSON types, to store the guide on disk."""
        return {
            "channels": [_channel_to_dict(c) for c in self.channels.values()],
            "programmes": {cid: [_programme_to_dict(p) for p in items] for cid, items in self.programmes.items()},
            "available_channels": self.available_channels,
            "fetched_at": self.fetched_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Guide:
        """Build a guide from the output of `to_dict`."""
        channels = [Channel(**c) for c in data["channels"]]
        return cls(
            channels={c.id: c for c in channels},
            programmes={cid: [_programme_from_dict(p) for p in items] for cid, items in data["programmes"].items()},
            available_channels=dict(data["available_channels"]),
            fetched_at=datetime.fromisoformat(data["fetched_at"]),
        )

    def image_urls(self) -> dict[str, str]:
        """Map image id to source URL for every poster in the guide."""
        return {image_id(p.image_url): p.image_url for items in self.programmes.values() for p in items if p.image_url}

    def find(self, programme_id: str) -> Programme | None:
        """Return the programme with this id, or None."""
        channel_id, _, _ = programme_id.rpartition("|")
        return next((p for p in self.programmes.get(channel_id, []) if p.id == programme_id), None)


def image_id(url: str) -> str:
    """Id of a poster in the HA image path: first 32 hex characters of the SHA-256 of the URL."""
    return hashlib.sha256(url.encode()).hexdigest()[:IMAGE_ID_LENGTH]


def channel_to_json(c: Channel) -> dict[str, Any]:
    """Channel in the API shape."""
    return _channel_to_dict(c)


def programme_to_json(p: Programme) -> dict[str, Any]:
    """Programme in the API shape. The poster is an HA path without a size."""
    data = _programme_to_dict(p)
    del data["image_url"]
    return {
        "id": p.id,
        "channel_id": data.pop("channel_id"),
        **data,
        "image": f"{IMAGE_PATH}/{image_id(p.image_url)}" if p.image_url else None,
    }


def _channel_to_dict(c: Channel) -> dict[str, Any]:
    return {"id": c.id, "name": c.name, "icon": c.icon}


def _programme_to_dict(p: Programme) -> dict[str, Any]:
    return {
        "channel_id": p.channel_id,
        "start": p.start.isoformat(),
        "stop": p.stop.isoformat(),
        "title": p.title,
        "subtitle": p.subtitle,
        "description": p.description,
        "episode": p.episode,
        "categories": list(p.categories),
        "image_url": p.image_url,
        "rating": p.rating,
        "star_rating": p.star_rating,
        "year": p.year,
        "countries": list(p.countries),
    }


def _programme_from_dict(data: dict[str, Any]) -> Programme:
    return Programme(
        **{
            **data,
            "start": datetime.fromisoformat(data["start"]),
            "stop": datetime.fromisoformat(data["stop"]),
            "categories": tuple(data["categories"]),
            "countries": tuple(data["countries"]),
        }
    )
