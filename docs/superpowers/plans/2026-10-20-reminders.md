# Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bell on a programme in the card. Home Assistant notifies the phones of the user who set it, 5 minutes before the programme starts.

**Architecture:** A new `ReminderManager` per config entry keeps reminders in their own `Store`, sets one HA timer per reminder and checks the reminders again after every guide update. `delivery.py` finds the user's Companion app phones through the `mobile_app` config entries and calls their notify services. Three new WebSocket commands connect the card's bell to the manager.

**Tech Stack:** Python 3.14, Home Assistant 2026.10 (`Store`, `async_track_point_in_utc_time`, `async_get_translations`), `probatio`; TypeScript, Lit 3, Vitest with happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-20-reminders-design.md`

## Global Constraints

- Lead time: exactly 5 minutes (`REMINDER_LEAD = timedelta(minutes=5)`). No setting.
- Moved programme search window: ±3 hours (`MOVE_WINDOW = timedelta(hours=3)`), same channel, same title after `search.normalize`, closest start wins.
- Languages: `en` and `pl`. Any other language becomes `en`. `pl-PL` becomes `pl`.
- No new packages in `manifest.json`. No `voluptuous`, use `probatio`.
- Never block the event loop. `Store` already writes in the executor.
- The user always comes from `connection.user.id`, never from the message.
- Event name: `tv_guide_reminder`. Event `kind`: `starting` or `gone`.
- Notification tag: `tv_guide_<programme_id>`.
- New WebSocket error code: `too_late`.
- Card: every visible text goes through `t()`, in `frontend/i18n/en.json`, `pl.json`, `qqq.json`.
- Commits: conventional, no `Co-Authored-By` trailer, never amend. Commit as `Dariusz Paluch <dariusz.paluch.it@gmail.com>`.
- Python coverage stays at 95% or more (`pyproject.toml`).
- Branch: `feature/reminders`, from `main` after `fix/card-load-race` is merged.

## Agent Split

One fresh implementer agent per task. Each agent gets: its task text, the Global Constraints, the Review Focus, the spec, and `AGENTS.md`. It reads no other task: the **Interfaces** block of its task gives the names and types from the tasks before it. After each task, one fresh reviewer agent checks the diff against the task and the spec before the next task starts.

| Task | Needs | Lane | Implementer | Reviewer |
| --- | --- | --- | --- | --- |
| 0 API contract | - | - | main session (needs the owner's "yes") | owner |
| 1 Model and matching | 0 | server | sonnet | sonnet |
| 2 Delivery to phones | 1 | server | sonnet | sonnet |
| 3 Store and timers | 1, 2 | server | sonnet | sonnet |
| 4 Wiring | 3 | server | sonnet | sonnet |
| 5 WebSocket commands | 4 | server | sonnet | sonnet |
| 6 Card client | 0 | card | sonnet | sonnet |
| 7 Bell components | 6 | card | sonnet | sonnet |
| 8 Root card | 7 | card | sonnet | sonnet |
| 9 Docs and manual test | 5, 8 | - | sonnet, then the owner tests on the phones | sonnet |

The server lane (1-5) and the card lane (6-8) touch different files and meet only at the API contract from Task 0. They can run at the same time, in two worktrees. Merge both into `feature/reminders` before Task 9. At the end, one reviewer on the most capable model checks the whole branch.

## Review Focus

1. **The night the clocks change (2026-10-25 in Warsaw).** A reminder for "Nocne kino" (02:30 +02:00) must fire at 00:25 UTC, not one hour off. Test in Task 3.
2. **Two users set a reminder for the same programme.** Each gets their own notification. When one removes theirs, the other stays. Tests in Tasks 3 and 5.
3. **A guide update arrives right after a reminder fired.** The fired reminder is already deleted, so no second notification and no "gone" notice. Test in Task 3.
4. **HA stops after a "gone" notice is detected but before it is saved.** The manager saves first and sends after, so a restart gives no second notice. Test in Task 3 (the store holds no gone reminder when the notice is sent).
5. **A language code with a region (`pl-PL`, `en-GB`) or an unknown one (`zh-Hans`).** The notification is in Polish for `pl-PL` and in English for the others. Test in Task 2.

---

### Task 0: API contract (STOP for approval)

`AGENTS.md`: a change to `docs/api.md` needs the owner's approval. Do this task first, and wait.

**Files:**
- Modify: `docs/api.md` (Types, WebSocket commands, error codes)

- [ ] **Step 1: Write the contract change**

Add under "Types":

```
### Reminder
| Field | Type |
| `programme_id` | string, a programme `id` |
| `channel_id` | string |
| `title` | string |
| `start` | ISO 8601 time with offset |

### Reminders
| `reminders` | Reminder[], soonest first |
| `phones` | string[], names of the user's phones that get the notification |
```

Add under "WebSocket commands": `tv_guide/reminders/list` (`entry_id?`), `tv_guide/reminders/add` (`entry_id?`, `programme_id`, `language`), `tv_guide/reminders/remove` (`entry_id?`, `programme_id`). Each one returns `Reminders` for the user of the connection. `add` again for the same programme is not an error, and neither is `remove` of a missing reminder. Add the error code `too_late`: `add` for a programme that starts in 5 minutes or less. `add` for an unknown `programme_id` gives `not_found`. Describe the event `tv_guide_reminder` with its fields from the spec.

- [ ] **Step 2: Show the diff to the owner and wait for "yes"**

- [ ] **Step 3: Commit**

```bash
git add docs/api.md
git commit -m "docs: add reminder commands to the API contract"
```

---

### Task 1: Reminder model and reconcile

**Files:**
- Create: `custom_components/tv_guide/reminders.py`
- Modify: `custom_components/tv_guide/const.py`
- Test: `tests/test_reminders.py`

**Interfaces:**
- Consumes: `model.Guide`, `model.Programme`, `search.normalize(text: str) -> str`.
- Produces:
  - `const.REMINDER_LEAD = timedelta(minutes=5)`, `const.MOVE_WINDOW = timedelta(hours=3)`
  - `@dataclass(frozen=True, slots=True) class Reminder`: `user_id: str`, `programme_id: str`, `channel_id: str`, `title: str`, `start: datetime`, `language: str`
    - `Reminder.from_programme(user_id: str, programme: Programme, language: str) -> Reminder`
    - `Reminder.due -> datetime` (property): `start - REMINDER_LEAD`
    - `Reminder.moved_to(programme: Programme) -> Reminder`: new id, start and title
    - `Reminder.to_dict() -> dict[str, str]`, `Reminder.from_dict(data: dict[str, Any]) -> Reminder`
  - `@dataclass(frozen=True, slots=True) class ReconcileResult`: `kept: list[Reminder]`, `gone: list[Reminder]`
  - `find_moved(reminder: Reminder, guide: Guide) -> Programme | None`
  - `reconcile(reminders: list[Reminder], guide: Guide) -> ReconcileResult`

- [ ] **Step 1: Write the failing tests**

Build reminders with a helper `make(programme_id, title, start)` and use the `guide` fixture (TVN and Polsat at `NOW`).

TVN on 2026-10-20 in the fixture: Fakty 19:00-19:35, Info 19:50-19:55, Uwaga 19:55-20:15 (all +02:00).

| Test | Reminder (`programme_id`, title, start +02:00) | Expected |
| --- | --- | --- |
| `test_same_id_keeps_the_reminder_and_takes_the_new_title` | `TVN\|2026-10-20T17:00:00Z`, "Old title", 2026-10-20 19:00 | `kept[0].title == "Fakty"`, `gone == []` |
| `test_moved_by_ten_minutes_is_found` | `TVN\|2026-10-20T17:45:00Z`, "Uwaga", 2026-10-20 19:45 | `kept[0].programme_id == "TVN\|2026-10-20T17:55:00Z"`, `kept[0].start` is 19:55 |
| `test_moved_more_than_three_hours_is_gone` | `TVN\|2026-10-20T14:40:00Z`, "Uwaga", 2026-10-20 16:40 | Fakty 19:00 overlaps the window, Uwaga is 3:15 away: `kept == []`, `gone == [reminder]` |
| `test_title_matches_after_normalize` | `TVN\|2026-10-20T17:45:00Z`, "  UWAGA ", 2026-10-20 19:45 | `kept[0].title == "Uwaga"` |
| `test_channel_without_data_around_the_start_is_kept` | `Polsat\|2026-10-22T10:00:00Z`, "Fakty", 2026-10-22 12:00 | `kept == [reminder]` unchanged, `gone == []` |
| `test_channel_not_in_guide_is_kept` | `Other\|2026-10-20T17:00:00Z`, "X", 2026-10-20 19:00 | `kept == [reminder]` unchanged |

Plus:

```python
def test_closest_of_two_candidates_wins():
    # Hand-built Guide: TVN "Fakty" at 17:00 and at 18:30 (+02:00), reminder "Fakty" at 17:50
    assert find_moved(reminder, guide).start.hour == 18

def test_round_trip_to_dict():
    assert Reminder.from_dict(reminder.to_dict()) == reminder  # start keeps its +02:00 offset
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_reminders.py -v`
Expected: FAIL, `ModuleNotFoundError: custom_components.tv_guide.reminders`

- [ ] **Step 3: Implement `reminders.py` (model part) and the two constants**

`find_moved`: candidates are the programmes of `reminder.channel_id` with `normalize(p.title) == normalize(reminder.title)` and `abs(p.start - reminder.start) <= MOVE_WINDOW`. Return the one with the smallest `abs(p.start - reminder.start)`.

`reconcile`, per reminder, in this order:
1. `guide.find(reminder.programme_id)` found: keep `reminder.moved_to(found)` (same id, fresh title).
2. `find_moved` found: keep `reminder.moved_to(found)`.
3. The channel has a programme that overlaps `[start - MOVE_WINDOW, start + MOVE_WINDOW]`: gone.
4. Else: keep unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_reminders.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add custom_components/tv_guide/reminders.py custom_components/tv_guide/const.py tests/test_reminders.py
git commit -m "feat: add the reminder model and match moved programmes"
```

---

### Task 2: Delivery to the user's phones

**Files:**
- Create: `custom_components/tv_guide/delivery.py`
- Modify: `custom_components/tv_guide/translations/en.json`, `pl.json`, `qqq.json`
- Test: `tests/test_delivery.py`

**Interfaces:**
- Consumes: `Reminder` (Task 1).
- Produces:
  - `type ReminderKind = Literal["starting", "gone"]`
  - `EVENT_REMINDER = "tv_guide_reminder"`
  - `SUPPORTED_LANGUAGES = ("en", "pl")`
  - `supported_language(language: str) -> str`
  - `@dataclass(frozen=True, slots=True) class Phone`: `name: str`, `service: str` (service name without `notify.`)
  - `find_phones(hass: HomeAssistant, user_id: str) -> list[Phone]`, sorted by name
  - `async async_deliver(hass: HomeAssistant, reminder: Reminder, kind: ReminderKind, channel_name: str) -> None`

- [ ] **Step 1: Write the failing tests**

Fixture `phones`: two `MockConfigEntry(domain="mobile_app", data={"user_id": ..., "device_name": ..., "webhook_id": ...})` for user `u1` ("Pixel 8", "Tablet") and one for user `u2` ("iPhone"). Register services with `async_mock_service(hass, "notify", "mobile_app_pixel_8")`, `"mobile_app_iphone"`. No service for "Tablet" (push off).

```python
def test_find_phones_returns_only_this_users_phones_with_a_service(hass, phones):
    assert find_phones(hass, "u1") == [Phone("Pixel 8", "mobile_app_pixel_8")]

def test_find_phones_without_phones(hass):
    assert find_phones(hass, "nobody") == []

async def test_starting_goes_to_each_phone_and_fires_the_event(hass, phones): ...
    # reminder: u1, "TVN|2026-10-20T17:00:00Z", "Fakty", 19:00 +02:00, "en", channel_name "TVN"
    # pixel call data == {"title": "TVN · 19:00", "message": "Fakty starts in 5 minutes",
    #                     "data": {"tag": "tv_guide_TVN|2026-10-20T17:00:00Z"}}
    # one event EVENT_REMINDER with {"kind": "starting", "user_id": "u1", "programme_id": ..., "channel_id": "TVN",
    #                                "channel_name": "TVN", "title": "Fakty", "start": "2026-10-20T19:00:00+02:00"}

async def test_gone_text_in_polish(hass, phones): ...
    # language "pl", kind "gone" -> title "TVN", message "Fakty nie ma już w programie"

async def test_one_failing_phone_does_not_stop_the_others(hass, caplog): ...
    # two phones for u1. The first service is registered by hand with
    # hass.services.async_register("notify", "mobile_app_broken", handler) where handler raises HomeAssistantError
    # (async_mock_service cannot raise). -> the second is called, the event fires, a warning names "Broken"

@pytest.mark.parametrize(("given", "expected"), [("pl", "pl"), ("pl-PL", "pl"), ("en-GB", "en"), ("zh-Hans", "en"), ("de", "en")])
def test_supported_language(given, expected):
    assert supported_language(given) == expected
```

The time in the title uses `dt_util.as_local(reminder.start)` (`hass.config.time_zone` is `Europe/Warsaw` in the tests: set it in the fixture) and the format `%H:%M`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_delivery.py -v`
Expected: FAIL, `ModuleNotFoundError: custom_components.tv_guide.delivery`

- [ ] **Step 3: Add the texts**

In `translations/en.json`, a new top-level `exceptions` object:

```json
"exceptions": {
  "reminder_starting_title": { "message": "{channel_name} · {time}" },
  "reminder_starting_message": { "message": "{title} starts in 5 minutes" },
  "reminder_gone_message": { "message": "{title} is no longer in the guide" }
}
```

`pl.json`: `"{channel_name} · {time}"`, `"{title} zaczyna się za 5 minut"`, `"{title} nie ma już w programie"`. `qqq.json`: one line each that says where the text shows (phone notification) and what each placeholder is.

- [ ] **Step 4: Implement `delivery.py`**

`find_phones`: the 4 steps of "How the integration finds the phones" in the spec. Service name: `slugify(f"mobile_app_{device_name}")`. Read `entry.data.get("user_id")` and `entry.data.get("device_name")`; skip an entry without them.

`async_deliver`: texts from `async_get_translations(hass, reminder.language, "exceptions", {DOMAIN})`, key `component.tv_guide.exceptions.<key>.message`, fill with `str.format`. Call each phone with `hass.services.async_call("notify", phone.service, data, blocking=True)` inside `try/except HomeAssistantError` (log a warning with the phone name). Fire the event last with `hass.bus.async_fire`. Explain in a comment why texts live under `exceptions` (hassfest accepts free texts with placeholders only there).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_delivery.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add custom_components/tv_guide/delivery.py custom_components/tv_guide/translations tests/test_delivery.py
git commit -m "feat: send reminders to the phones of the user"
```

---

### Task 3: Reminder store and manager (timers)

**Files:**
- Modify: `custom_components/tv_guide/store.py` (add `ReminderStore`)
- Modify: `custom_components/tv_guide/reminders.py` (add `ReminderManager`, `TooLate`)
- Test: `tests/test_reminder_manager.py`, `tests/test_store.py`

**Interfaces:**
- Consumes: Task 1 (`Reminder`, `reconcile`, `REMINDER_LEAD`), Task 2 (`async_deliver`, `supported_language`).
- Produces:
  - `ReminderStore(hass: HomeAssistant, entry_id: str)`, key `f"{DOMAIN}.{entry_id}.reminders"`, version 1
    - `async async_load() -> list[Reminder]` (a damaged file gives `[]` and a warning)
    - `async async_save(reminders: list[Reminder]) -> None`
    - `async async_remove() -> None`
  - `class TooLate(Exception)`
  - `ReminderManager(hass: HomeAssistant, entry: ConfigEntry, store: ReminderStore, guide: Callable[[], Guide | None])`
    - `async async_load() -> None`: load, then plan timers
    - `for_user(user_id: str) -> list[Reminder]`, soonest first
    - `async async_add(user_id: str, programme: Programme, language: str) -> None`: raises `TooLate` when `programme.start - REMINDER_LEAD <= dt_util.utcnow()`. Stores `supported_language(language)`. A second add for the same user and programme changes nothing.
    - `async async_remove(user_id: str, programme_id: str) -> None`
    - `@callback handle_guide_update() -> None`: a coordinator listener. Starts `_async_reconcile()` as an entry background task.
    - `@callback unload() -> None`: cancels all timers

- [ ] **Step 1: Write the failing tests**

Use `freezer` at `NOW` (2026-10-19 19:20 Warsaw), the `guide` fixture and a fake `async_deliver` (patch `custom_components.tv_guide.reminders.async_deliver` with an `AsyncMock`). Build the manager on a `MockConfigEntry`; `guide` is `lambda: guide`.

```python
async def test_fires_five_minutes_before_the_start_and_is_deleted(hass, freezer, guide, deliver):
    # add u1 "TVN|2026-10-19T17:50:00Z" (Info, 19:50)
    # tick to 19:44:59 -> deliver not called; tick to 19:45:00 -> called once with kind "starting"
    # for_user("u1") == [] and the store holds []

async def test_too_late(hass, freezer, guide):
    # freezer at 19:30:00; add "Sport" (19:35) -> raises TooLate. At 19:29:59 -> allowed

async def test_two_users_same_programme(hass, freezer, guide, deliver):
    # u1 and u2 add Info; u1 removes -> at 19:45 deliver called once, for u2

async def test_survives_a_restart(hass, freezer, guide, deliver):
    # add, unload, new manager on the same store, async_load -> fires at 19:45

async def test_due_while_ha_was_off_fires_at_once(hass, freezer, guide, deliver):
    # stored reminder for Info; freezer at 19:47 (due passed, not started) -> async_load -> deliver once

async def test_started_while_ha_was_off_is_dropped_silently(hass, freezer, guide, deliver):
    # stored reminder for Info; freezer at 19:51 -> async_load -> deliver not called, store holds []

async def test_guide_update_moves_the_timer(hass, freezer, guide, deliver):
    # add Uwaga (2026-10-20 19:55); swap guide for one where Uwaga starts 20:05
    # handle_guide_update(); await hass.async_block_till_done()
    # -> fires at 20:00, not at 19:50

async def test_gone_sends_one_notice_after_saving(hass, freezer, guide, deliver, hass_storage):
    # add Uwaga; swap guide for one without Uwaga but with TVN data that evening
    # deliver side effect: assert the store already holds no Uwaga when it is called (Review Focus 4)
    # -> deliver called once with kind "gone"; no timer left

async def test_guide_update_after_firing_sends_nothing(hass, freezer, guide, deliver):
    # Review Focus 3: fire Info at 19:45, then handle_guide_update() with Info gone -> deliver still called once

async def test_dst_night(hass, freezer, guide, deliver):
    # Review Focus 1: add "Polsat|2026-10-25T00:30:00Z" (Nocne kino, 02:30 +02:00)
    # tick to 2026-10-25T00:24:59Z -> no call; 00:25:00Z -> called

async def test_language_is_normalized(hass, freezer, guide):
    # add with "pl-PL" -> for_user(...)[0].language == "pl"
```

In `tests/test_store.py` add: `ReminderStore` round trip, and a damaged file (`hass_storage[key] = {"version": 1, "data": {"reminders": [{"bad": 1}]}}`) gives `[]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_reminder_manager.py tests/test_store.py -v`
Expected: FAIL, `ImportError: cannot import name 'ReminderManager'`

- [ ] **Step 3: Implement `ReminderStore` in `store.py`**

Same shape as `GuideStore`. Data: `{"reminders": [r.to_dict() for r in reminders]}`. Catch `KeyError, TypeError, ValueError` on load, log a warning, return `[]`.

- [ ] **Step 4: Implement `ReminderManager` in `reminders.py`**

State: `self._reminders: list[Reminder]`, `self._timers: dict[tuple[str, str], CALLBACK_TYPE]` keyed by `(user_id, programme_id)`.

`_plan_timers()` (callback): cancel all timers. For each reminder:
- `start <= utcnow()`: drop it (no notification).
- `due <= utcnow()`: fire now.
- else: `async_track_point_in_utc_time(hass, fire, reminder.due)`.
Save when it dropped any.

Fire: remove the reminder, save, then `async_deliver(..., "starting", channel_name)`. Save before delivery. `channel_name`: `guide().channels[channel_id].name` when known, else `channel_id`.

`_async_reconcile()`: `reconcile(self._reminders, guide)`, set `kept`, save, then deliver `gone` for each, then `_plan_timers()`.

`handle_guide_update()`: `self._entry.async_create_background_task(hass, self._async_reconcile(), "tv_guide reminders")`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_reminder_manager.py tests/test_store.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add custom_components/tv_guide/store.py custom_components/tv_guide/reminders.py tests/test_reminder_manager.py tests/test_store.py
git commit -m "feat: keep reminders on disk and fire them on time"
```

---

### Task 4: Wire the manager into the integration

**Files:**
- Modify: `custom_components/tv_guide/coordinator.py`, `__init__.py`, `diagnostics.py`
- Test: `tests/test_init.py` (or the file that tests setup and removal today), `tests/test_diagnostics.py`

**Interfaces:**
- Consumes: Task 3.
- Produces: `TvGuideCoordinator.reminders: ReminderManager`, created in `TvGuideCoordinator.__init__` as `ReminderManager(hass, entry, ReminderStore(hass, entry.entry_id), lambda: self.data)`. `self.data` is `None` until the first guide loads; the manager must accept that (channel name falls back to the channel id, reconcile is skipped).

- [ ] **Step 1: Write the failing tests**

```python
async def test_setup_loads_reminders_and_a_guide_update_reconciles(hass, hass_storage, clock_at_now, aioclient_mock, guide_xml, mock_entry):
    # hass_storage["tv_guide.<entry_id>.reminders"] holds Info for u1
    # after setup: loaded_entry.runtime_data.reminders.for_user("u1") has 1 item

async def test_unload_cancels_the_timers(hass, loaded_entry, ...):
    # add a reminder, unload the entry, tick past due -> async_deliver not called

async def test_remove_entry_deletes_the_reminder_store(hass, loaded_entry, hass_storage):
    # after async_remove: the reminders key is not in hass_storage

async def test_diagnostics_counts_reminders(...):
    # diagnostics["reminders"] == 1, and no user id in the output
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_init.py tests/test_diagnostics.py -v`
Expected: FAIL, `AttributeError: 'TvGuideCoordinator' object has no attribute 'reminders'`

Also run `uv run pytest tests/test_translations.py -v` after Task 2's new `exceptions` texts: it checks that `en`, `pl` and `qqq` have the same keys.

- [ ] **Step 3: Implement the wiring**

- `async_setup_entry`: `await coordinator.reminders.async_load()` before the guide loads. Replace `coordinator.async_add_listener(lambda: None)` with `coordinator.async_add_listener(coordinator.reminders.handle_guide_update)` and update the comment: the listener keeps the coordinator timer alive and checks the reminders. Add `entry.async_on_unload(coordinator.reminders.unload)`.
- `async_remove_entry`: also `await ReminderStore(hass, entry.entry_id).async_remove()`.
- `diagnostics.py`: add `"reminders": <count>`.

- [ ] **Step 4: Run all Python tests**

Run: `uv run pytest -q`
Expected: all pass, coverage 95% or more

- [ ] **Step 5: Commit**

```bash
git add custom_components/tv_guide tests
git commit -m "feat: load reminders with the entry and check them after each guide update"
```

---

### Task 5: WebSocket commands

**Files:**
- Modify: `custom_components/tv_guide/websocket_api.py`
- Test: `tests/test_websocket_api.py`

**Interfaces:**
- Consumes: Task 2 (`find_phones`), Task 3 (`ReminderManager`, `TooLate`), Task 4 (`coordinator.reminders`).
- Produces: `ws_reminders_list`, `ws_reminders_add`, `ws_reminders_remove`; `ERR_TOO_LATE = "too_late"`; result shape `{"reminders": [{"programme_id", "channel_id", "title", "start"}], "phones": [str]}`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_reminders_add_list_remove(ws, loaded_entry, hass_admin_user):
    msg = await call(ws, "reminders/add", programme_id="TVN|2026-10-19T17:50:00Z", language="en")
    assert msg["result"]["reminders"] == [{"programme_id": "TVN|2026-10-19T17:50:00Z", "channel_id": "TVN",
                                           "title": "Info", "start": "2026-10-19T19:50:00+02:00"}]
    assert msg["result"]["phones"] == []
    assert (await call(ws, "reminders/list"))["result"] == msg["result"]
    assert (await call(ws, "reminders/remove", programme_id="TVN|2026-10-19T17:50:00Z"))["result"]["reminders"] == []

async def test_reminders_add_twice_is_not_an_error(ws, loaded_entry): ...
async def test_reminders_remove_missing_is_not_an_error(ws, loaded_entry): ...

async def test_reminders_add_unknown_programme(ws, loaded_entry):
    assert (await call(ws, "reminders/add", programme_id="TVN|2030-01-01T00:00:00Z", language="en"))["error"]["code"] == "not_found"

async def test_reminders_add_too_late(ws, loaded_entry):
    # Fakty is on now
    assert (await call(ws, "reminders/add", programme_id="TVN|2026-10-19T17:00:00Z", language="en"))["error"]["code"] == "too_late"

async def test_reminders_are_per_user(hass, ws, loaded_entry, hass_ws_client, hass_read_only_access_token):
    # Review Focus 2: admin adds Info; a second client with another user's token sees [] in list

async def test_reminders_list_shows_the_phones(ws, loaded_entry, hass, hass_admin_user):
    # a mobile_app entry for hass_admin_user.id with a mock service -> phones == ["Pixel 8"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_websocket_api.py -k reminders -v`
Expected: FAIL, `unknown_command`

- [ ] **Step 3: Implement the three commands**

Same decorator stack as the other commands (`websocket_command` with `probatio`, `async_response`, `_with_coordinator`). Schemas: `pb.Optional("entry_id"): str`, plus `pb.Required("programme_id"): str` for add and remove, and `pb.Required("language"): str` for add. A shared helper `_reminders_result(hass, coordinator, user_id) -> dict[str, Any]` builds the result. `add`: `coordinator.data.find(programme_id)`, `None` gives `ERR_NOT_FOUND`; `TooLate` gives `ERR_TOO_LATE`. Register them in `async_register_commands`.

- [ ] **Step 4: Run all Python tests**

Run: `uv run pytest -q`
Expected: all pass, coverage 95% or more

- [ ] **Step 5: Commit**

```bash
git add custom_components/tv_guide/websocket_api.py tests/test_websocket_api.py
git commit -m "feat: add the reminder WebSocket commands"
```

---

### Task 6: Card client and types

**Files:**
- Modify: `frontend/src/types/api.ts`, `frontend/src/data/guide-client.ts`
- Create: `frontend/src/data/reminders.ts`
- Test: `frontend/tests/data/guide-client.test.ts`, `frontend/tests/data/reminders.test.ts`

**Interfaces:**
- Produces:
  - `interface Reminder { programme_id: string; channel_id: string; title: string; start: string }`
  - `interface Reminders { reminders: Reminder[]; phones: string[] }`
  - `GuideErrorCode` gains `'too_late'`, and `KNOWN_CODES` too
  - `GuideClient.reminders(): Promise<Reminders>`, `addReminder(programmeId: string, language: string): Promise<Reminders>`, `removeReminder(programmeId: string): Promise<Reminders>`. None cached.
  - `REMINDER_LEAD_MS = 5 * 60_000`, `canRemind(programme: Programme, now: number): boolean` (true when `start - REMINDER_LEAD_MS > now`)

- [ ] **Step 1: Write the failing tests**

```ts
test('reminder commands send the right messages and are never cached', async () => {
  // addReminder('TVN|2026-10-19T17:50:00Z', 'pl') sends
  // { type: 'tv_guide/reminders/add', programme_id: 'TVN|2026-10-19T17:50:00Z', language: 'pl' }
  // reminders() twice -> two sends; removeReminder sends type 'tv_guide/reminders/remove'
});
test('too_late is a known error code', ...);  // rejects with { code: 'too_late' } -> GuideError.code === 'too_late'
test('canRemind is false within 5 minutes of the start', ...);
// NOW = 19:20: Sport (19:35) -> true; at 19:30:00 -> false; at 19:29:59 -> true
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm vitest run tests/data/guide-client.test.ts tests/data/reminders.test.ts`
Expected: FAIL, `client.addReminder is not a function`

- [ ] **Step 3: Implement the types, the three methods and `reminders.ts`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm vitest run tests/data`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/data frontend/tests/data
git commit -m "feat: add reminder calls to the card client"
```

---

### Task 7: Bell in the programme view and the channel view

**Files:**
- Modify: `frontend/src/components/icons.ts`, `events.ts`, `tvg-programme-view.ts`, `tvg-channel-view.ts`
- Modify: `frontend/i18n/en.json`, `pl.json`, `qqq.json`
- Test: `frontend/tests/components/tvg-programme-view.test.ts`, `tvg-channel-view.test.ts`, `events.test.ts`

**Interfaces:**
- Consumes: `canRemind` (Task 6).
- Produces:
  - Icons `bell` (MDI `mdiBellOutline`) and `bellRing` (MDI `mdiBellRing`) in `ICON`
  - Event `'tvg-reminder': { programmeId: string; on: boolean }` in `TvgEventDetails` and `HTMLElementEventMap`
  - `TvgProgrammeView` props: `reminded = false`, `noPhone = false`
  - `TvgChannelView` prop: `remindedIds: ReadonlySet<string> = new Set()`
  - Strings: `remindMe` "Remind me 5 minutes before" / "Przypomnij 5 minut przed"; `reminderSet` "Reminder set" / "Przypomnienie ustawione"; `noPhone` "No phone with the Home Assistant app found for your user." / "Nie znaleziono telefonu z aplikacją Home Assistant dla Twojego użytkownika."; `reminderFailed` "Cannot change the reminder: {error}" / "Nie można zmienić przypomnienia: {error}"

- [ ] **Step 1: Write the failing tests**

```ts
// tvg-programme-view
test('a bell for a later programme fires tvg-reminder on', ...);
  // programme Sport (19:35), now NOW -> button[data-reminder] with aria-pressed="false", aria-label "Remind me 5 minutes before"
  // click -> tvg-reminder { programmeId: 'TVN|2026-10-19T17:35:00Z', on: true }
test('a pressed bell fires tvg-reminder off', ...);   // reminded = true -> aria-pressed="true", label "Reminder set", click -> on: false
test('no bell for a programme on now or within 5 minutes', ...);  // Fakty (on now) -> no [data-reminder]
test('the no-phone warning shows only when the bell is on', ...);  // reminded + noPhone -> text of noPhone; not reminded -> none

// tvg-channel-view
test('a programme with a reminder has a small bell next to its time', ...);
  // remindedIds = new Set(['TVN|2026-10-19T17:50:00Z']) -> the Info slot has svg.i inside .rem with aria-label "Reminder set"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm vitest run tests/components`
Expected: FAIL, no `[data-reminder]` element

- [ ] **Step 3: Implement**

Programme view: the bell is an `icon-btn` in the header, between `renderChannelTitle` and `renderCloseButton`, shown when `canRemind(programme, this.now)`. Icon `bellRing` when `reminded`, else `bell`. The warning is a `<div class="warn">` under `renderTiming`. Channel view: in `renderSlot`, after the time span, `<span class="rem" aria-label=...>${icon('bellRing')}</span>` when the id is in `remindedIds`; size it to 14px in the styles. Add the four strings to `en.json`, `pl.json` and `qqq.json` (qqq: where it shows and what `{error}` is).

- [ ] **Step 4: Run the card tests and the checks**

Run: `cd frontend && pnpm test && pnpm check`
Expected: all pass, no type or lint errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components frontend/i18n frontend/tests/components
git commit -m "feat: show a reminder bell on programmes"
```

---

### Task 8: Root card state and actions

**Files:**
- Modify: `frontend/src/tv-guide.ts`
- Test: `frontend/tests/tv-guide.test.ts`

**Interfaces:**
- Consumes: Tasks 6 and 7.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests**

Extend `makeServer` in `tv-guide.test.ts` to answer `tv_guide/reminders/list`, `add` and `remove` from an in-memory list, with `phones: ['Pixel 8']`.

```ts
test('refresh loads the reminders and the channel view shows the bell', ...);
test('a tap on the bell adds the reminder with the HA profile language', ...);
  // hass.locale.language = 'pl' -> server got { type: 'tv_guide/reminders/add', ..., language: 'pl' }
  // then the programme view bell has aria-pressed="true"
test('a second tap removes it', ...);
test('a failed add shows one hass-notification', ...);
  // server rejects with { code: 'too_late', message: 'Too late' }
  // -> hass-notification { message: 'Cannot change the reminder: Too late' }; bell stays off
test('a reminders failure does not break the guide', ...);
  // reminders/list rejects -> the channel list still renders, no error card
test('the no-phone warning shows when phones is empty', ...);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm vitest run tests/tv-guide.test.ts`
Expected: FAIL, no `tv_guide/reminders/list` call

- [ ] **Step 3: Implement**

- `@state() private reminders?: Reminders`.
- `refresh()`: start `client.reminders()` next to the other calls, but outside their `Promise.all`. On success set `this.reminders` (check `run` and `client` like the other calls). On failure keep the old value.
- A getter for the set of reminded ids, passed to `tvg-channel-view` as `.remindedIds` and to `tvg-programme-view` as `.reminded` and `.noPhone` (`phones.length === 0`).
- `onReminder` handler for `tvg-reminder`: call `addReminder(id, hass.locale.language)` or `removeReminder(id)`, set `this.reminders` from the answer. On failure send `hass-notification` with `t('reminderFailed', { error: error.message })`, like `switchTo`.
- Register `@tvg-reminder=${this.onReminder}` where the other card events are registered.

- [ ] **Step 4: Run the card tests, checks and build**

Run: `cd frontend && pnpm test && pnpm check && pnpm build`
Expected: all pass, the build writes `custom_components/tv_guide/frontend/tv-guide.js`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tv-guide.ts frontend/tests/tv-guide.test.ts
git commit -m "feat: set and remove reminders from the card"
```

---

### Task 9: User and design docs

**Files:**
- Modify: `docs/design.md`, `README.md`, `CHANGELOG.md`
- Delete: nothing. Keep `docs/superpowers/` out of the release zip (it is outside `custom_components/`, so it already is).

- [ ] **Step 1: Update the docs**

- `docs/design.md`: move "Reminders" out of "Ideas for later" into a "Reminders" section that says how phones are found, the 5-minute timer, moved and gone programmes, and the event. Add `reminders.py` and `delivery.py` to the integration file table. Keep the "Later still" line under "Ideas for later".
- `README.md`: a "Reminders" section: tap the bell on a programme; the phones of your HA user with the Companion app get a notification 5 minutes before; no phone means only the event; an automation example that listens to `tv_guide_reminder`.
- `CHANGELOG.md`: a `## 0.2.0 - <release date>` section, `### Card` and `### Integration` lines for reminders.

- [ ] **Step 2: Run everything**

Run: `uv run pytest -q && cd frontend && pnpm test && pnpm check && pnpm build`
Expected: all pass

- [ ] **Step 3: Test on a real HA (manual)**

Install the build, restart HA, set a reminder for a programme that starts in about 10 minutes, on an iPhone and an Android phone. Both get the notification 5 minutes before. Remove one and check that it does not come.

- [ ] **Step 4: Commit**

```bash
git add docs/design.md README.md CHANGELOG.md
git commit -m "docs: describe reminders"
```
