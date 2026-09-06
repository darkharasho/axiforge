#!/usr/bin/env python3
"""Turn a release's notes into Discord webhook payloads, one JSON per line.

Discord caps an embed description at 4096 characters and a whole message at
6000 across its embeds. The release post used to be a single embed truncated
at 3800, so any release with more to say than that lost its tail -- and the
tail is where "Bug Fixes" always is. v0.18.0's notes ran to 6.4k and the post
stopped mid-sentence, announcing the team features and nothing else.

Sections are the natural seam: split on the "### " headings so a section is
never halved, pack sections into embeds, and pack embeds into messages.
"""
import json
import os

# Both under Discord's real limits (4096 / 6000), leaving room for the title,
# URL and footer that ride along on the first and last embeds.
EMBED_LIMIT = 3800
MESSAGE_LIMIT = 5400
EMBEDS_PER_MESSAGE = 10
COLOR = 0x5865F2
THUMBNAIL = "https://raw.githubusercontent.com/darkharasho/axiforge/main/build/icon.png"


def split_sections(notes):
    """Notes -> blocks, each a '### ' heading with everything under it."""
    blocks, current = [], []
    for line in notes.splitlines():
        if line.startswith("### ") and current:
            blocks.append("\n".join(current).strip())
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append("\n".join(current).strip())
    return [b for b in blocks if b]


def hard_split(block, limit):
    """A section too big for one embed, broken on paragraph then line breaks."""
    if len(block) <= limit:
        return [block]
    parts, current = [], ""
    for para in block.split("\n\n"):
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            parts.append(current)
        # Still oversized on its own: cut it on line boundaries.
        while len(para) > limit:
            cut = para.rfind("\n", 0, limit)
            if cut <= 0:
                cut = limit
            parts.append(para[:cut].strip())
            para = para[cut:].strip()
        current = para
    if current:
        parts.append(current)
    return [p for p in parts if p]


def pack(items, limit, max_items=None):
    """Greedily group items into groups whose joined length stays under limit."""
    groups, current, size = [], [], 0
    for item in items:
        addition = len(item) + (2 if current else 0)
        too_long = current and size + addition > limit
        too_many = max_items is not None and len(current) >= max_items
        if too_long or too_many:
            groups.append(current)
            current, size = [], 0
            addition = len(item)
        current.append(item)
        size += addition
    if current:
        groups.append(current)
    return groups


def build_payloads(tag, release_url, notes):
    notes = (notes or "").strip()
    if not notes:
        return [{"embeds": [{
            "title": f"AxiForge {tag}",
            "url": release_url,
            "description": "A new version of AxiForge is available!",
            "color": COLOR,
            "thumbnail": {"url": THUMBNAIL},
            "footer": {"text": "AxiForge Release"},
        }]}]

    blocks = []
    for section in split_sections(notes):
        blocks.extend(hard_split(section, EMBED_LIMIT))

    descriptions = ["\n\n".join(group) for group in pack(blocks, EMBED_LIMIT)]
    messages = pack(descriptions, MESSAGE_LIMIT, EMBEDS_PER_MESSAGE)

    payloads = []
    for m, group in enumerate(messages):
        embeds = [{"description": text, "color": COLOR} for text in group]
        # Title, link and thumbnail on the very first embed only; the rest read
        # as continuations of it rather than as separate announcements.
        if m == 0:
            embeds[0]["title"] = f"AxiForge {tag}"
            embeds[0]["url"] = release_url
            embeds[0]["thumbnail"] = {"url": THUMBNAIL}
        if m == len(messages) - 1:
            embeds[-1]["footer"] = {"text": "AxiForge Release"}
        payloads.append({"embeds": embeds})
    return payloads


def main():
    tag = os.environ["TAG"]
    release_url = os.environ["RELEASE_URL"]
    notes = os.environ.get("NOTES", "")
    for payload in build_payloads(tag, release_url, notes):
        print(json.dumps(payload))


if __name__ == "__main__":
    main()
