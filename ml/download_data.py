"""Download the UCI Parking Birmingham dataset and verify its checksum."""

from __future__ import annotations

import hashlib
import urllib.request
import zipfile

import config


def main() -> None:
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    if not config.RAW_ZIP.exists():
        print(f"Downloading {config.DATA_URL}")
        urllib.request.urlretrieve(config.DATA_URL, config.RAW_ZIP)
    digest = hashlib.sha256(config.RAW_ZIP.read_bytes()).hexdigest()
    if digest != config.DATA_SHA256:
        raise SystemExit(
            f"Checksum mismatch for {config.RAW_ZIP}.\n"
            f"  expected {config.DATA_SHA256}\n  received {digest}\n"
            "The upstream file changed. Review it before updating DATA_SHA256 in ml/config.py."
        )
    with zipfile.ZipFile(config.RAW_ZIP) as archive:
        with archive.open("dataset.csv") as source:
            config.RAW_CSV.write_bytes(source.read())
    print(f"Verified SHA-256 and extracted {config.RAW_CSV}")


if __name__ == "__main__":
    main()
