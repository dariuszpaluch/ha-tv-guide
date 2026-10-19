"""Shared test data. Later tasks add to this file; do not define a second copy."""

import io
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from custom_components.tv_guide.model import Guide
from custom_components.tv_guide.parser import parse_guide

WAW = ZoneInfo("Europe/Warsaw")
NOW = datetime(2026, 10, 19, 19, 20, tzinfo=WAW)
URL = "http://src/guide.xml"


@pytest.fixture(autouse=True)
def _enable(enable_custom_integrations: None) -> None:
    """Let Home Assistant load the integration from `custom_components`."""


@pytest.fixture
def guide_xml() -> bytes:
    """Bytes of the XMLTV fixture file."""
    return (Path(__file__).parent / "fixtures" / "guide.xml").read_bytes()


@pytest.fixture
def guide(guide_xml: bytes) -> Guide:
    """The fixture guide parsed for TVN and Polsat at `NOW`."""
    return parse_guide(io.BytesIO(guide_xml), {"TVN", "Polsat"}, NOW)
