import threading

from custom_components.tv_guide.model import Guide
from custom_components.tv_guide.store import GuideStore


async def test_store_round_trip(hass, guide: Guide) -> None:
    await GuideStore(hass, "e1").async_save(guide)
    assert await GuideStore(hass, "e1").async_load() == guide


async def test_store_converts_the_guide_outside_the_event_loop(hass, guide: Guide, monkeypatch) -> None:
    # Building the dict and parsing it back take hundreds of ms for a big guide.
    threads: dict[str, int] = {}
    to_dict, from_dict = Guide.to_dict, Guide.from_dict

    def spy_to_dict(self: Guide):
        threads["to_dict"] = threading.get_ident()
        return to_dict(self)

    def spy_from_dict(data):
        threads["from_dict"] = threading.get_ident()
        return from_dict(data)

    monkeypatch.setattr(Guide, "to_dict", spy_to_dict)
    monkeypatch.setattr(Guide, "from_dict", staticmethod(spy_from_dict))
    store = GuideStore(hass, "e1")
    await store.async_save(guide)
    assert await store.async_load() == guide
    assert set(threads) == {"to_dict", "from_dict"}
    assert hass.loop_thread_id not in threads.values()


async def test_store_empty(hass) -> None:
    assert await GuideStore(hass, "e1").async_load() is None


async def test_store_remove(hass, guide: Guide, hass_storage) -> None:
    store = GuideStore(hass, "e1")
    await store.async_save(guide)
    assert "tv_guide.e1" in hass_storage
    await store.async_remove()
    assert "tv_guide.e1" not in hass_storage
