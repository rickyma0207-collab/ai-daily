"""每日抓取 AI 资讯：读取 sources.json 中的 RSS/Atom 源，合并到 docs/data/items.json。

只用 Python 标准库，GitHub Actions 和本机都能直接运行：
    python fetcher/fetch.py
"""
import concurrent.futures as cf
import email.utils
import hashlib
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "fetcher" / "sources.json"
OUT = ROOT / "docs" / "data" / "items.json"
KEEP_DAYS = 60          # 保留最近多少天
MAX_ITEMS = 5000        # 最多保留多少条
UA = "Mozilla/5.0 (compatible; AI-Daily-Reader/1.0; personal RSS reader)"

# 用于综合类来源（36氪、雷峰网等）只保留和 AI 相关的内容
AI_RE = re.compile(
    r"(\bAI\b|\bAGI\b|\bLLMs?\b|\bGPT|ChatGPT|OpenAI|Anthropic|Claude|Gemini|DeepSeek|Llama|Qwen|"
    r"machine learning|deep learning|neural|artificial intelligence|generative|chatbot|agent|"
    r"人工智能|大模型|模型|智能体|机器学习|深度学习|神经网络|生成式|机器人|算力|具身|多模态|AIGC|千问|文心|豆包|Kimi)",
    re.I,
)

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "yt": "http://www.youtube.com/xml/schemas/2015",
}


def clean(text, limit=280):
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def txt(el, path):
    found = el.find(path, NS)
    return found.text if found is not None and found.text else ""


def parse_feed(data):
    root = ET.fromstring(data.lstrip())
    entries = []
    if root.tag.endswith("rss") or root.find("channel") is not None:
        for it in root.iter("item"):
            thumb = ""
            m = it.find("media:thumbnail", NS)
            if m is None:
                m = it.find("media:content", NS)
            if m is not None and m.get("url") and (m.get("medium", "image") == "image"):
                thumb = m.get("url")
            enc = it.find("enclosure")
            if not thumb and enc is not None and (enc.get("type") or "").startswith("image"):
                thumb = enc.get("url", "")
            entries.append({
                "title": txt(it, "title"),
                "link": txt(it, "link").strip(),
                "date": txt(it, "pubDate") or txt(it, "dc:date"),
                "summary": txt(it, "description") or txt(it, "content:encoded"),
                "thumb": thumb,
            })
    else:  # Atom（YouTube、The Verge 等）
        for it in root.findall("atom:entry", NS):
            link = ""
            for l in it.findall("atom:link", NS):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            thumb = ""
            t = it.find("media:group/media:thumbnail", NS)
            if t is not None:
                thumb = t.get("url", "")
            summary = (txt(it, "media:group/media:description") or txt(it, "atom:summary")
                       or txt(it, "atom:content"))
            entries.append({
                "title": txt(it, "atom:title"),
                "link": link,
                "date": txt(it, "atom:published") or txt(it, "atom:updated"),
                "summary": summary,
                "thumb": thumb,
            })
    return entries


def fetch_source(src):
    req = urllib.request.Request(src["url"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    now = datetime.now(timezone.utc)
    items = []
    for e in parse_feed(data):
        title = clean(e["title"], 300)
        link = e["link"]
        if not title or not link.startswith("http"):
            continue
        summary = re.sub(r"^arXiv:\S+\s+Announce Type:\s*\S+\s*Abstract:\s*", "", e["summary"] or "")
        summary = clean(summary)
        if src.get("filter") and not AI_RE.search(title + " " + summary):
            continue
        d = parse_date(e["date"]) or now
        if d > now:
            d = now
        items.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:16],
            "title": title,
            "link": link,
            "source": src["name"],
            "cat": src["cat"],
            "date": d.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "summary": summary,
            **({"thumb": e["thumb"]} if e["thumb"] else {}),
        })
        if len(items) >= src.get("limit", 20):
            break
    return items


def main():
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    old = {}
    if OUT.exists():
        try:
            for it in json.loads(OUT.read_text(encoding="utf-8")).get("items", []):
                old[it["id"]] = it
        except (ValueError, KeyError):
            pass

    status, new_count, merged = [], 0, dict(old)
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(fetch_source, s): s for s in sources}
        for f in cf.as_completed(futs):
            s = futs[f]
            try:
                items = f.result()
            except Exception as e:  # 单个源失败不影响整体
                status.append({"source": s["name"], "ok": False, "error": str(e)[:200]})
                print(f"[失败] {s['name']}: {e}", file=sys.stderr)
                continue
            fresh = 0
            for it in items:
                if it["id"] not in merged:
                    fresh += 1
                    merged[it["id"]] = it
                else:  # 保留首次发现的数据，只更新标题/摘要
                    merged[it["id"]].update(title=it["title"], summary=it["summary"])
            new_count += fresh
            status.append({"source": s["name"], "ok": True, "count": len(items), "new": fresh})
            print(f"[成功] {s['name']}: {len(items)} 条（新增 {fresh}）")

    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    items = sorted((i for i in merged.values() if i["date"] >= cutoff),
                   key=lambda i: i["date"], reverse=True)[:MAX_ITEMS]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(items),
        "sources": sorted(status, key=lambda x: x["source"]),
        "items": items,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ok = sum(1 for s in status if s["ok"])
    print(f"完成：{ok}/{len(sources)} 个源成功，新增 {new_count} 条，共 {len(items)} 条")
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
