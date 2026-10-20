"""Constants of the TV guide integration."""

from datetime import timedelta

DOMAIN = "tv_guide"
DEFAULT_UPDATE_INTERVAL = 12  # hours
KEEP_ENDED = timedelta(days=1)  # programmes that ended longer ago are dropped
REMINDER_LEAD = timedelta(minutes=5)  # a reminder fires this long before the programme starts
MOVE_WINDOW = timedelta(hours=3)  # how far a moved programme may be from its old start
