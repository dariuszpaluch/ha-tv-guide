"""Constants of the TV guide integration."""

from datetime import timedelta

DOMAIN = "tv_guide"
DEFAULT_UPDATE_INTERVAL = 12  # hours
KEEP_ENDED = timedelta(days=1)  # programmes that ended longer ago are dropped
