"""Rebase decoder timestamps onto one program clock.

FLV and MediaMTX reject equal or backwards timestamps. A reconnecting decoder
starts its clock over, and a burst of frames can share one arrival time. Each
output timestamp stays strictly increasing, in millisecond steps, without
running more than a second ahead of the program clock.
"""

STEP_NS = 1_000_000
MAX_LEAD_NS = 1_000_000_000


class Stamp:
    def __init__(self) -> None:
        self.offset: int | None = None
        self.last_src: int | None = None
        self.last_out = -1

    def reset_source(self) -> None:
        self.offset = None
        self.last_src = None

    def apply(self, source_pts: int | None, program_now: int) -> int:
        now = max(0, program_now)
        discontinuous = (
            source_pts is None
            or self.offset is None
            or self.last_src is None
            or source_pts < self.last_src
        )
        if discontinuous:
            target = now if self.last_out < 0 else max(now, self.last_out + STEP_NS)
            if source_pts is None:
                self.offset = None
                self.last_src = None
                self.last_out = target
                return target
            self.offset = target - source_pts
        assert source_pts is not None and self.offset is not None
        self.last_src = source_pts
        pts = source_pts + self.offset
        if self.last_out >= 0 and pts <= self.last_out:
            pts = self.last_out + STEP_NS
            self.offset = pts - source_pts
        if pts > now + MAX_LEAD_NS:
            pts = now if self.last_out < 0 else max(now, self.last_out + STEP_NS)
            self.offset = pts - source_pts
        self.last_out = pts
        return pts
