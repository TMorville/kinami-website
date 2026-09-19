# /// script
# dependencies = ["requests"]
# ///
"""Seedance 2 image-to-video: blank paper -> brush-ink enso. First + last frame.

Reads FAL_KEY from the environment (set for every session via ~/.claude/settings.json).
"""

import base64
import json
import os
import pathlib
import sys
import time

import requests

HERE = pathlib.Path(__file__).parent
ENDPOINT = "bytedance/seedance-2.0/image-to-video"


def data_uri(p: pathlib.Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(p.read_bytes()).decode()


def main(prompt_file: str, out_name: str) -> None:
    key = os.environ.get("FAL_KEY")
    if not key:
        cfg = json.loads(pathlib.Path("~/.claude/settings.json").expanduser().read_text())
        key = cfg.get("env", {}).get("FAL_KEY")
    if not key:
        sys.exit("FAL_KEY not found")
    headers = {"Authorization": f"Key {key}", "Content-Type": "application/json"}

    payload = {
        "prompt": pathlib.Path(prompt_file).read_text().strip(),
        "image_url": data_uri(HERE / "start.jpg"),
        "end_image_url": data_uri(HERE / "end.jpg"),
        "resolution": "720p",
        "duration": "5",
        "aspect_ratio": "1:1",
        "generate_audio": False,
    }

    r = requests.post(f"https://queue.fal.run/{ENDPOINT}", headers=headers, json=payload, timeout=120)
    r.raise_for_status()
    job = r.json()
    status_url, response_url = job["status_url"], job["response_url"]
    print("submitted", job.get("request_id"), flush=True)

    t0 = time.time()
    while True:
        s = requests.get(status_url, headers=headers, timeout=60).json()
        st = s.get("status")
        print(f"  {int(time.time() - t0):4d}s  {st}", flush=True)
        if st == "COMPLETED":
            break
        if st not in ("IN_QUEUE", "IN_PROGRESS"):
            sys.exit(f"job failed: {json.dumps(s)[:600]}")
        time.sleep(10)

    res = requests.get(response_url, headers=headers, timeout=60).json()
    url = (res.get("video") or {}).get("url")
    if not url:
        sys.exit(f"no video url: {json.dumps(res)[:600]}")
    dest = HERE / out_name
    dest.write_bytes(requests.get(url, timeout=300).content)
    print("saved", dest, dest.stat().st_size, "bytes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
