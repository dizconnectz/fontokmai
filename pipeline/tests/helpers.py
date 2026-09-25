from pathlib import Path

from fontokmai.sources.tmd_cap.parser import CapMessage, parse_cap

FIXTURES = Path(__file__).parent / "fixtures" / "tmd_cap"
SYNTHETIC = Path(__file__).parent / "fixtures" / "tmd_cap_synthetic"
CAP_BASE = "https://www.tmd.go.th/uploads/CAP/"


def read_fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def real_messages() -> list[tuple[CapMessage, str]]:
    return [(parse_cap(p.read_bytes()), CAP_BASE + p.name) for p in sorted(FIXTURES.glob("CAPTMD*.xml"))]
