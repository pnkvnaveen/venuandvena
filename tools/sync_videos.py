"""Refresh site/data/videos.json from the Venu & Vena YouTube channel (read-only).

    python3 tools/sync_videos.py            # needs YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET,
                                            # YOUTUBE_REFRESH_TOKEN in the environment
    python3 tools/sync_videos.py --raw F    # rebuild from a saved API dump instead (no network)

Only public videos are listed. Episodes are grouped by the channel's playlists; anything with
"#Shorts" in its title is a Short. Run it after new episodes go public, then commit the file.
The Home page also finds the newest episode by itself once the site is live (src/worker.js).
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CHANNEL = "UCk5NIPTjIx66AJ1riKgn8qQ"
OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "videos.json"
FULL_SHOW = "RID8o2WA3Oc"  # the A to Z show, in no playlist
TRAILER = "-UU52_mFO5Y"

# Site order and look for each series, matched to the playlist title "<name> with Venu & Vena".
SERIES = [
    ("alphabet", "Alphabet", "Meet every letter from A to Z."),
    ("numbers", "Numbers", "Counting stories, one number at a time."),
    ("number-games", "Number Games", "Playful games with counting and sharing."),
    ("colours", "Colours", "Find a colour all around the garden."),
    ("shapes", "Shapes", "Circles, squares and stars in everyday things."),
    ("animal-friends", "Animal Friends", "Meet animals and the sounds they make."),
    ("abc-words", "ABC Words", "Letters and the first words that start with them."),
]


def fetch() -> dict:
    def post(url, data):
        req = urllib.request.Request(url, urllib.parse.urlencode(data).encode())
        return json.load(urllib.request.urlopen(req, timeout=30))

    token = post(
        "https://oauth2.googleapis.com/token",
        dict(
            client_id=os.environ["YOUTUBE_CLIENT_ID"],
            client_secret=os.environ["YOUTUBE_CLIENT_SECRET"],
            refresh_token=os.environ["YOUTUBE_REFRESH_TOKEN"],
            grant_type="refresh_token",
        ),
    )["access_token"]

    def get(path, **q):
        url = f"https://www.googleapis.com/youtube/v3/{path}?{urllib.parse.urlencode(q)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        return json.load(urllib.request.urlopen(req, timeout=30))

    def pages(path, **q):
        out, nxt = [], None
        while True:
            if nxt:
                q["pageToken"] = nxt
            d = get(path, **q)
            out += d.get("items", [])
            nxt = d.get("nextPageToken")
            if not nxt:
                return out

    playlists = pages("playlists", part="snippet,status", channelId=CHANNEL, maxResults=50)
    ids = [
        i["contentDetails"]["videoId"]
        for i in pages("playlistItems", part="contentDetails", playlistId="UU" + CHANNEL[2:], maxResults=50)
    ]
    videos = []
    for k in range(0, len(ids), 50):
        videos += get("videos", part="snippet,status,contentDetails", id=",".join(ids[k : k + 50]))["items"]
    items = {
        p["id"]: [
            i["contentDetails"]["videoId"]
            for i in pages("playlistItems", part="contentDetails", playlistId=p["id"], maxResults=50)
        ]
        for p in playlists
    }
    return dict(playlists=playlists, videos=videos, playlist_items=items)


def seconds(iso: str) -> int:
    h, m, s = (int(x or 0) for x in re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso).groups())
    return h * 3600 + m * 60 + s


def short_title(title: str) -> str:
    """'Bug Hunt: Garden Bugs for Kids | Animal Friends with Venu & Vena | Episode 6' -> 'Bug Hunt: Garden Bugs for Kids'."""
    t = re.sub(r"\s*#Shorts\b", "", title).split(" | ")[0].strip()
    return t


def build(raw: dict) -> dict:
    public = {v["id"]: v for v in raw["videos"] if v["status"]["privacyStatus"] == "public"}

    def item(v: dict) -> dict:
        return {
            "id": v["id"],
            "title": short_title(v["snippet"]["title"]),
            "published": v["snippet"]["publishedAt"][:10],
            "minutes": max(1, round(seconds(v["contentDetails"]["duration"]) / 60)),
        }

    by_name = {p["snippet"]["title"].replace(" with Venu & Vena", "").strip(): p for p in raw["playlists"]}
    series = []
    for slug, name, blurb in SERIES:
        p = by_name.get(name)
        if not p:
            continue
        eps = [
            item(public[i])
            for i in raw["playlist_items"][p["id"]]
            if i in public and "#Shorts" not in public[i]["snippet"]["title"]
        ]
        series.append({"slug": slug, "name": name, "blurb": blurb, "playlist": p["id"], "episodes": eps})
    for s in series:  # which series each episode belongs to, for the newest-video card
        for e in s["episodes"]:
            e["series"] = s["slug"]
    episodes = sorted(
        (e for s in series for e in s["episodes"]), key=lambda e: e["published"], reverse=True
    )
    shorts = sorted(
        (item(v) for v in public.values() if "#Shorts" in v["snippet"]["title"]),
        key=lambda e: e["published"],
        reverse=True,
    )
    return {
        "channel": CHANNEL,
        "newest": episodes[0] if episodes else None,
        "series": series,
        "shorts": shorts,
        "full_show": item(public[FULL_SHOW]) if FULL_SHOW in public else None,
        "trailer": item(public[TRAILER]) if TRAILER in public else None,
    }


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--raw":
        raw = json.loads(Path(sys.argv[2]).read_text())
    else:
        raw = fetch()
    data = build(raw)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    n = sum(len(s["episodes"]) for s in data["series"])
    print(f"wrote {OUT}: {n} episodes in {len(data['series'])} series, {len(data['shorts'])} Shorts")


if __name__ == "__main__":
    main()
