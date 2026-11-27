"""每日抓取 AI 资讯，合并到 docs/data/items.json。

1. 读取 sources.json 中的 RSS/Atom 源（官方博客、新闻、论文、YouTube、中文媒体、财经）
2. 读取 topics.json 中的话题，用谷歌新闻 RSS 搜索全网最近 7 天的相关报道
3. 如果设置了 AI_API_KEY，用 AI 给新内容写中文标题和 3~5 条中文要点

只用 Python 标准库，GitHub Actions 和本机都能直接运行：
    python fetcher/fetch.py
可选环境变量：
    AI_API_KEY   AI 平台的密钥（不设置就跳过中文要点）
    AI_BASE_URL  OpenAI 兼容的 chat/completions 地址，默认智谱 BigModel
    AI_MODEL     模型名，默认 glm-4.7-flash（智谱免费模型）
"""
import concurrent.futures as cf
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "fetcher" / "sources.json"
TOPICS = ROOT / "fetcher" / "topics.json"
OUT = ROOT / "docs" / "data" / "items.json"
KEEP_DAYS = 60          # 保留最近多少天
TOPIC_KEEP_DAYS = 30    # 话题追踪的内容保留天数
MAX_ITEMS = 6000        # 最多保留多少条
TOPIC_LIMIT = 15        # 每个话题每次最多收录几条
AI_MAX_PER_RUN = 400    # 每次最多让 AI 处理多少条
AI_BATCH = 10           # 每次请求处理几条
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
                "via": txt(it, "source"),  # 谷歌新闻：原始媒体名
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
                "via": "",
            })
    return entries


def topic_source(t):
    """把一个话题变成谷歌新闻搜索 RSS 源。"""
    en = t.get("lang") == "en"
    hl = "hl=en-US&gl=US&ceid=US:en" if en else "hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(t["q"] + " when:7d") + "&" + hl
    return {"name": t["q"], "url": url, "cat": "topic", "group": t["group"], "limit": TOPIC_LIMIT}


def download(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def fetch_host(srcs):
    """同一网站的源依次抓取、间隔 1 秒，避免请求过快被限流。"""
    out = []
    for n, s in enumerate(srcs):
        if n:
            time.sleep(1)
        try:
            out.append((s, fetch_source(s), None))
        except Exception as e:
            out.append((s, None, e))
    return out


def fetch_source(src):
    data = download(src["url"])
    now = datetime.now(timezone.utc)
    items = []
    for e in parse_feed(data):
        title = clean(e["title"], 300)
        link = e["link"]
        if not title or not link.startswith("http"):
            continue
        source = src["name"]
        summary = re.sub(r"^arXiv:\S+\s+Announce Type:\s*\S+\s*Abstract:\s*", "", e["summary"] or "")
        summary = clean(summary)
        if summary.startswith("Article URL:"):  # Hacker News：只保留热度信息
            m = re.search(r"Points:\s*(\d+).*?Comments:\s*(\d+)", summary)
            summary = f"Hacker News 热度 {m.group(1)} 分，{m.group(2)} 条评论" if m else ""
        if src["cat"] == "topic":
            # 谷歌新闻标题形如“标题 - 媒体名”，摘要只是重复标题
            source = clean(e["via"], 40) or "全网"
            if title.endswith(" - " + source):
                title = title[: -len(" - " + source)]
            summary = ""
        if src.get("filter") and not AI_RE.search(title + " " + summary):
            continue
        d = parse_date(e["date"]) or now
        if d > now:
            d = now
        it = {
            "id": hashlib.sha1(link.encode()).hexdigest()[:16],
            "title": title,
            "link": link,
            "source": source,
            "cat": src["cat"],
            "date": d.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "summary": summary,
        }
        if e["thumb"]:
            it["thumb"] = e["thumb"]
        if src.get("group"):
            it["group"] = src["group"]
            it["topic"] = src["name"]
        items.append(it)
        if len(items) >= src.get("limit", 20):
            break
    return items


# ---------------- AI 中文标题与要点 ----------------
AI_PROMPT = """你是一名 AI 科技编辑，读者是看不太懂英文的中国大学生。
下面是若干条 AI 相关资讯（JSON 数组，字段 i=编号, t=原标题, s=原摘要, src=来源）。
请为每一条输出：
- zt：简洁准确的中文标题（原标题已是中文时，可原样保留或稍作精简）
- pts：3~5 条中文要点，每条不超过 40 个字，用自己的话概括事实，不要编造摘要里没有的信息；信息很少时可以只写 1~2 条
只输出 JSON 数组，格式：[{"i":0,"zt":"…","pts":["…","…"]}]，不要输出其他文字。"""


def call_ai(batch, key, base, model):
    payload = [{"i": n, "t": it["title"], "s": it.get("summary", "")[:400], "src": it["source"]}
               for n, it in enumerate(batch)]
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": AI_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        "temperature": 0.3,
        "max_tokens": 4000,
    }
    if "bigmodel.cn" in base:
        body["thinking"] = {"type": "disabled"}  # 智谱：关闭深度思考，更快
    req = urllib.request.Request(
        base, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    return data["choices"][0]["message"]["content"]


def parse_ai(text):
    """从模型回复里取出 JSON 数组（兼容 ```json 包裹）。"""
    a, b = text.find("["), text.rfind("]")
    if a < 0 or b <= a:
        raise ValueError("回复中没有 JSON 数组")
    out = {}
    for r in json.loads(text[a: b + 1]):
        try:
            n = int(r["i"])
        except (KeyError, TypeError, ValueError):
            continue
        zt = clean(str(r.get("zt", "")), 120)
        pts = [clean(str(p), 120) for p in (r.get("pts") or []) if str(p).strip()][:5]
        if zt or pts:
            out[n] = (zt, pts)
    return out


def enrich(items, call=call_ai):
    key = os.environ.get("AI_API_KEY", "").strip()
    if not key:
        print("未设置 AI_API_KEY，跳过中文要点生成")
        return 0
    base = os.environ.get("AI_BASE_URL", "").strip() or "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    model = os.environ.get("AI_MODEL", "").strip() or "glm-4.7-flash"
    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # 优先处理新闻/博客/话题/视频，论文最后
    order = {"news": 0, "topic": 0, "blog": 1, "video": 1, "finance": 2, "zh": 2, "paper": 3}
    todo = [i for i in items if "pts" not in i and i["date"] >= cutoff and not i.get("ai_fail")]
    todo.sort(key=lambda i: i["date"], reverse=True)            # 新的优先
    todo = sorted(todo, key=lambda i: order.get(i["cat"], 2))[:AI_MAX_PER_RUN]  # 再按类别优先级
    done, fails = 0, 0
    for k in range(0, len(todo), AI_BATCH):
        batch = todo[k: k + AI_BATCH]
        for attempt in range(3):
            try:
                res = parse_ai(call(batch, key, base, model))
                for n, (zt, pts) in res.items():
                    if 0 <= n < len(batch):
                        batch[n]["zt"], batch[n]["pts"] = zt, pts
                        done += 1
                break
            except urllib.error.HTTPError as e:
                msg = e.read()[:200].decode("utf-8", "replace")
                print(f"[AI] HTTP {e.code}: {msg}", file=sys.stderr)
                if e.code in (401, 403):
                    print("[AI] 密钥无效或没有权限，停止生成", file=sys.stderr)
                    return done
                time.sleep(10 * (attempt + 1))
            except Exception as e:  # 网络或格式问题：重试
                print(f"[AI] 出错：{e}", file=sys.stderr)
                time.sleep(3 * (attempt + 1))
        else:
            fails += 1
            if fails >= 5:
                print("[AI] 连续失败太多，下次再试", file=sys.stderr)
                break
        time.sleep(1)
    print(f"[AI] 生成中文要点 {done} 条（待处理 {len(todo)} 条）")
    return done


def main():
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    if TOPICS.exists():
        sources += [topic_source(t) for t in json.loads(TOPICS.read_text(encoding="utf-8"))]
    old = {}
    if OUT.exists():
        try:
            for it in json.loads(OUT.read_text(encoding="utf-8")).get("items", []):
                old[it["id"]] = it
        except (ValueError, KeyError):
            pass

    status, new_count, merged = [], 0, dict(old)
    seen_titles = {re.sub(r"\W", "", i["title"]).lower() for i in merged.values()}
    hosts = {}
    for s in sources:
        hosts.setdefault(urllib.parse.urlparse(s["url"]).netloc, []).append(s)
    results = []
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(fetch_host, hosts.values()):
            results += res
    for s, items, err in results:
            if err is not None:  # 单个源失败不影响整体
                status.append({"source": s["name"], "ok": False, "error": str(err)[:200]})
                print(f"[失败] {s['name']}: {err}", file=sys.stderr)
                continue
            fresh = 0
            for it in items:
                if it["id"] in merged:  # 保留首次发现的数据，只更新标题/摘要
                    if it["title"] != merged[it["id"]]["title"]:
                        merged[it["id"]].pop("pts", None)
                    merged[it["id"]].update(title=it["title"], summary=it["summary"] or merged[it["id"]].get("summary", ""))
                    continue
                norm = re.sub(r"\W", "", it["title"]).lower()
                if it["cat"] == "topic" and norm in seen_titles:
                    continue  # 话题搜索结果和已有内容重复
                seen_titles.add(norm)
                fresh += 1
                merged[it["id"]] = it
            new_count += fresh
            status.append({"source": s["name"], "ok": True, "count": len(items), "new": fresh})
            print(f"[成功] {s['name']}: {len(items)} 条（新增 {fresh}）")

    now = datetime.now(timezone.utc)
    cut = (now - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    tcut = (now - timedelta(days=TOPIC_KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    items = sorted((i for i in merged.values() if i["date"] >= (tcut if i["cat"] == "topic" else cut)),
                   key=lambda i: i["date"], reverse=True)[:MAX_ITEMS]
    ai_done = enrich(items)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(items),
        "ai": ai_done,
        "sources": sorted(status, key=lambda x: x["source"]),
        "items": items,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ok = sum(1 for s in status if s["ok"])
    print(f"完成：{ok}/{len(sources)} 个源成功，新增 {new_count} 条，共 {len(items)} 条")
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
