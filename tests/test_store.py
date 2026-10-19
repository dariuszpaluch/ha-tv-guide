from custom_components.tv_guide.model import Guide
from custom_components.tv_guide.store import GuideStore


async def test_store_round_trip(hass, guide: Guide) -> None:
    await GuideStore(hass, "e1").async_save(guide)
    assert await GuideStore(hass, "e1").async_load() == guide


async def test_store_empty(hass) -> None:
    assert await GuideStore(hass, "e1").async_load() is None


async def test_store_remove(hass, guide: Guide, hass_storage) -> None:
    store = GuideStore(hass, "e1")
    await store.async_save(guide)
    assert "tv_guide.e1" in hass_storage
    await store.async_remove()
    assert "tv_guide.e1" not in hass_storage
