#!/usr/bin/env python3
"""Rebuild a DDPAI TAR archive from sanitized NMEA members, without raw padding."""

import argparse
import io
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    sanitizer = Path(__file__).with_name("anonymize-nmea-log.mjs")
    output = io.BytesIO()
    with tempfile.TemporaryDirectory() as temporary:
        source = Path(temporary) / "source.gpx"
        masked = Path(temporary) / "masked.gpx"
        with tarfile.open(args.input, "r:") as archive, tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as target:
            for entry in archive:
                if not entry.isfile() or not re.fullmatch(r"\d{14}_\d{2,7}(?:_[DT])?\.gpx", entry.name, re.I):
                    raise ValueError("unexpected archive member")
                source.write_bytes(archive.extractfile(entry).read())
                subprocess.run(["node", str(sanitizer), str(source), str(masked), "--ddpai"], check=True, capture_output=True)
                data = masked.read_bytes()
                member = tarfile.TarInfo(entry.name)
                member.size = len(data)
                target.addfile(member, io.BytesIO(data))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output.getvalue())


if __name__ == "__main__":
    main()
