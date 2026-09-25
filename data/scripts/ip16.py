"""Accepted /16 network indicator (ip16) shape shared by the generators.

ip16 is a truncated network indicator, so only values that carry exactly two
numeric octets can be cataloged; absent and malformed values are never counted
as evidence. Both the viewer artifact and the IP16 research catalog import this
rule so they cannot drift apart.
"""

from __future__ import annotations


def accepted_prefix(value: object) -> str | None:
    """Return the accepted `a.b` prefix as a string, or None when it is malformed."""
    if not value:
        return None
    parts = str(value).split(".")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return None
    return str(value)
