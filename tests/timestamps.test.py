import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from timestamps import STEP_NS, Stamp


def increasing(values):
    return all(b > a for a, b in zip(values, values[1:]))


def test_burst_with_one_arrival_time():
    stamp = Stamp()
    now = 5_000_000_000
    values = [stamp.apply(0, now) for _ in range(5)]
    assert increasing(values)
    assert all(b - a >= STEP_NS for a, b in zip(values, values[1:]))


def test_framerate_spacing_is_preserved():
    stamp = Stamp()
    now = 10_000_000_000
    frame = 33_333_333
    values = [stamp.apply(i * frame, now) for i in range(4)]
    assert values[0] == now
    assert values[1] - values[0] == frame
    assert increasing(values)


def test_reconnect_does_not_rewind():
    stamp = Stamp()
    now = 20_000_000_000
    first = stamp.apply(0, now)
    later = stamp.apply(33_000_000, now + 33_000_000)
    stamp.reset_source()
    restarted = stamp.apply(0, now + 40_000_000)
    assert restarted > later > first


def test_forward_jump_stays_near_the_clock():
    stamp = Stamp()
    now = 30_000_000_000
    stamp.apply(0, now)
    jumped = stamp.apply(5_000_000_000, now + 1_000_000)
    assert jumped <= now + 1_000_000 + STEP_NS


if __name__ == "__main__":
    test_burst_with_one_arrival_time()
    test_framerate_spacing_is_preserved()
    test_reconnect_does_not_rewind()
    test_forward_jump_stays_near_the_clock()
    print("PASS program timestamps")
