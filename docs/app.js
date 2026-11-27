// AI 日报 —— 首页 / 视频 / 搜索 / 收藏 / 文章页，数据来自 data/items.json
const CATS = [["all", "全部"], ["topic", "话题追踪"], ["news", "新闻"], ["blog", "官方博客"], ["paper", "论文"], ["video", "视频"], ["zh", "中文"], ["finance", "财经"]];
const CAT_NAME = Object.fromEntries(CATS);
const HOT = ["Claude 封号", "GPT", "Gemini", "智能体", "DeepSeek", "AI 编程", "英伟达", "开源"];
const ELSEWHERE = [
  ["小红书", "https://www.xiaohongshu.com/search_result?keyword="],
  ["知乎", "https://www.zhihu.com/search?type=content&q="],
  ["B站", "https://search.bilibili.com/all?keyword="],
  ["微博", "https://s.weibo.com/weibo?q="],
  ["抖音", "https://www.douyin.com/search/"],
  ["百度", "https://www.baidu.com/s?wd="],
  ["谷歌", "https://www.google.com/search?q="],
];
const HERO_GRADS = [
  "linear-gradient(135deg,#0EA5E9,#6D28D9 55%,#DB2777)",
  "linear-gradient(135deg,#059669,#0EA5E9 50%,#6366F1)",
  "linear-gradient(135deg,#7C3AED,#EC4899 60%,#F59E0B)",
  "linear-gradient(135deg,#1D4ED8,#22D3EE 60%,#34D399)",
  "linear-gradient(135deg,#BE185D,#7C3AED 55%,#22D3EE)",
];
const PAGE = 40;
const STAR = '<svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill="#fff"/></svg>';

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  items: [], byId: new Map(), updated: null, sources: [],
  tab: "home", artId: null,
  homeCat: store.get("cat", "all"), group: "all", range: store.get("range", "1"), homeShown: PAGE,
  chan: "all", videoShown: 12,
  q: "", searchCat: "all", searchShown: PAGE,
  favCat: "all",
  favs: new Map(store.get("favs", []).map((i) => [i.id, i])),
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const terms = () => state.q.toLowerCase().split(/\s+/).filter(Boolean);
const titleOf = (it) => it.zt || it.title;
const tagName = (it) => (it.cat === "topic" && it.group) || CAT_NAME[it.cat] || it.cat;
function hl(text, ts) {
  const out = esc(text);
  if (!ts.length) return out;
  const re = new RegExp("(" + ts.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  return out.replace(re, "<mark>$1</mark>");
}
function timeAgo(d) {
  const m = Math.floor((Date.now() - d) / 60000);
  if (m < 60) return `${Math.max(m, 1)} 分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / 1440)} 天前`;
}
function dayLabel(d) {
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日 周${"日一二三四五六"[d.getDay()]}`;
}
const byDate = (a, b) => (a.date < b.date ? 1 : -1);
const inRange = (it, days) => !days || Date.now() - new Date(it.date) < days * 86400000;
const artHref = (it) => "#a/" + encodeURIComponent(it.id);

// ---------- 组件 ----------
function chipsHTML(list, active, counts, attr) {
  return list.map(([k, v]) =>
    `<button class="chip" data-${attr}="${esc(k)}" aria-pressed="${active === k}">${esc(v)}${counts && counts[k] != null ? `<span class="n">${counts[k]}</span>` : ""}</button>`
  ).join("");
}
function countBy(items, key = "cat") {
  const c = { all: items.length };
  for (const it of items) c[it[key]] = (c[it[key]] || 0) + 1;
  return c;
}
function starBtn(it) {
  const on = state.favs.has(it.id);
  return `<button class="star ${on ? "on" : ""}" data-fav="${esc(it.id)}" aria-label="${on ? "取消收藏" : "收藏"}">${STAR}</button>`;
}
function cardHTML(it, ts = []) {
  const d = new Date(it.date);
  const sub = it.pts && it.pts.length
    ? `<p class="s ai">${hl(it.pts.join("；"), ts)}</p>`
    : it.summary ? `<p class="s">${hl(it.summary, ts)}</p>` : "";
  return `<article class="card" data-open="${esc(it.id)}">
    <div class="body">
      <a class="t" href="${artHref(it)}">${hl(titleOf(it), ts)}</a>
      ${it.zt && it.zt !== it.title ? `<p class="orig">${hl(it.title, ts)}</p>` : ""}
      ${sub}
      <div class="meta">
        <span class="tag ${esc(it.cat)}">${esc(tagName(it))}</span>
        <span class="src">${hl(it.source, ts)}</span><span class="time">· ${timeAgo(d)}</span>
        ${starBtn(it)}
      </div>
    </div>
    ${it.thumb && it.cat !== "video" ? `<img class="thumb" loading="lazy" src="${esc(it.thumb)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
  </article>`;
}
function videoHTML(it, ts = []) {
  return `<article class="vcard">
    <a class="cover" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" aria-label="播放">
      ${it.thumb ? `<img loading="lazy" src="${esc(it.thumb)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <span class="play">${PLAY}</span>
    </a>
    <div class="vb">
      <a class="t" href="${artHref(it)}">${hl(titleOf(it), ts)}</a>
      <div class="meta"><span class="avatar">${esc(it.source.slice(0, 1))}</span>
        <span class="src">${esc(it.source)}</span><span class="time">· ${timeAgo(new Date(it.date))}</span>${starBtn(it)}</div>
    </div>
  </article>`;
}
const itemHTML = (it, ts) => (it.cat === "video" ? videoHTML(it, ts) : cardHTML(it, ts));
function elsewhereHTML(q, title = "在其他平台搜") {
  return `<p>${esc(title)}「${esc(q)}」，点击后在对应网站打开：</p><div class="links">` +
    ELSEWHERE.map(([n, u]) => `<a href="${esc(u + encodeURIComponent(q))}" target="_blank" rel="noopener noreferrer">${n}</a>`).join("") + "</div>";
}

// ---------- 首页 ----------
function renderHero() {
  const recent = state.items.filter((i) => ["blog", "news", "zh"].includes(i.cat) && inRange(i, 2));
  const picks = [...recent.filter((i) => i.thumb), ...recent.filter((i) => !i.thumb)];
  const seen = new Set(), hero = [];
  for (const it of picks) { if (seen.has(it.source)) continue; seen.add(it.source); hero.push(it); if (hero.length === 5) break; }
  $("#hero").innerHTML = hero.map((it, i) => `
    <a class="hero-card" href="${artHref(it)}"
       style="background-image:${it.thumb ? `url('${esc(it.thumb).replace(/'/g, "%27")}'),` : ""}${HERO_GRADS[i % HERO_GRADS.length]}">
      <span class="badge">${i === 0 ? "🔥 今日要闻" : esc(tagName(it))}</span>
      <h3>${esc(titleOf(it))}</h3>
      <span class="m">${esc(it.source)} · ${timeAgo(new Date(it.date))}</span>
    </a>`).join("");
  $("#dots").innerHTML = hero.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("");
  $("#hero").hidden = $("#dots").hidden = !hero.length;
}
function renderHome() {
  const days = +state.range;
  const pool = state.items.filter((i) => inRange(i, days));
  $("#home-cats").innerHTML = chipsHTML(CATS, state.homeCat, countBy(pool), "cat");
  let list = pool.filter((i) => state.homeCat === "all" || i.cat === state.homeCat);
  const groupsEl = $("#home-groups");
  if (state.homeCat === "topic") {
    const gc = countBy(list, "group");
    const groups = [...new Set(state.items.filter((i) => i.cat === "topic").map((i) => i.group))];
    groupsEl.innerHTML = chipsHTML([["all", "全部话题"], ...groups.map((g) => [g, g])], state.group, gc, "group");
    groupsEl.hidden = false;
    if (state.group !== "all") list = list.filter((i) => i.group === state.group);
  } else groupsEl.hidden = true;
  let html = "", last = "";
  for (const it of list.slice(0, state.homeShown)) {
    const lab = dayLabel(new Date(it.date));
    if (lab !== last) { if (last) html += `<div class="day">${lab}</div>`; last = lab; }
    html += itemHTML(it);
  }
  $("#home-label").textContent = list[0] ? dayLabel(new Date(list[0].date)) : "暂无内容";
  $("#home-list").innerHTML = html || `<div class="empty">这个时间范围内暂无内容，试试右上角选“7天”</div>`;
  $("#home-more").hidden = list.length <= state.homeShown;
}

// ---------- 视频 ----------
function renderVideo() {
  const vids = state.items.filter((i) => i.cat === "video");
  const chans = [...new Set(vids.map((v) => v.source))];
  const week = vids.filter((v) => inRange(v, 7)).length;
  $("#video-sub").textContent = `${chans.length} 个 AI 频道 · 本周 ${week} 个新视频`;
  $("#video-chans").innerHTML = chipsHTML([["all", "全部频道"], ...chans.map((c) => [c, c])], state.chan, null, "chan");
  const list = vids.filter((v) => state.chan === "all" || v.source === state.chan);
  $("#video-list").innerHTML = list.slice(0, state.videoShown).map((v) => videoHTML(v)).join("") || `<div class="empty">暂无视频</div>`;
  $("#video-more").hidden = list.length <= state.videoShown;
}

// ---------- 搜索 ----------
function renderSearch() {
  const ts = terms();
  $("#q-clear").hidden = !state.q;
  $("#hot").hidden = !!ts.length;
  $("#elsewhere").hidden = !ts.length;
  if (!ts.length) {
    $("#search-cats").innerHTML = "";
    $("#search-count").textContent = "输入关键词，在全部历史内容里搜索（中英文都可以）";
    $("#search-list").innerHTML = "";
    $("#search-more").hidden = true;
    return;
  }
  const hits = state.items.filter((it) => {
    const hay = [it.title, it.zt, it.summary, it.source, it.topic, it.group, ...(it.pts || [])].join(" ").toLowerCase();
    return ts.every((t) => hay.includes(t));
  });
  // 标题里直接包含关键词的排在前面，其次按时间
  const score = (it) => { const h = (it.title + " " + (it.zt || "")).toLowerCase(); return ts.filter((t) => h.includes(t)).length; };
  hits.sort((a, b) => score(b) - score(a) || byDate(a, b));
  const counts = countBy(hits);
  $("#search-cats").innerHTML = chipsHTML(CATS.filter(([k]) => k === "all" || counts[k]), state.searchCat, counts, "scat");
  const list = hits.filter((i) => state.searchCat === "all" || i.cat === state.searchCat);
  $("#search-count").textContent = `在全部时间内找到 ${list.length} 条结果`;
  $("#search-list").innerHTML = list.slice(0, state.searchShown).map((it) => itemHTML(it, ts)).join("") ||
    `<div class="empty">应用里还没有相关内容<br>可以点下面的按钮去其他平台搜</div>`;
  $("#search-more").hidden = list.length <= state.searchShown;
  $("#elsewhere").innerHTML = elsewhereHTML(state.q);
}

// ---------- 收藏 ----------
function renderFav() {
  const favs = [...state.favs.values()].map((f) => state.byId.get(f.id) || f).sort(byDate);
  const counts = countBy(favs);
  $("#fav-sub").textContent = `${favs.length} 条 · 保存在这台手机上`;
  $("#fav-cats").innerHTML = favs.length ? chipsHTML(CATS.filter(([k]) => k === "all" || counts[k]), state.favCat, counts, "fcat") : "";
  const list = favs.filter((i) => state.favCat === "all" || i.cat === state.favCat);
  $("#fav-list").innerHTML = list.map((it) => itemHTML(it)).join("") || `<div class="empty">还没有收藏<br>看到喜欢的内容，点卡片右下角的 ☆ 收藏</div>`;
}

// ---------- 文章页 ----------
function renderArticle() {
  const it = state.byId.get(state.artId) || state.favs.get(state.artId);
  if (!it) {
    $("#art-crumb").textContent = "";
    $("#art").innerHTML = `<div class="empty">${state.items.length ? "这条内容已过期或不存在" : "加载中…"}</div>`;
    return;
  }
  const on = state.favs.has(it.id);
  const translate = "https://translate.google.com/translate?sl=auto&tl=zh-CN&u=" + encodeURIComponent(it.link);
  const isEn = !/[一-鿿]/.test(it.title);
  $("#art-crumb").textContent = `${tagName(it)} · ${it.source}`;
  $("#art").innerHTML = `
    <div class="meta"><span class="tag ${esc(it.cat)}">${esc(tagName(it))}</span>
      <span class="src">${esc(it.source)}</span><span class="time">· ${timeAgo(new Date(it.date))}</span>
      ${it.topic ? `<span class="time">· 话题：${esc(it.topic)}</span>` : ""}</div>
    <h1>${esc(titleOf(it))}</h1>
    ${it.zt && it.zt !== it.title ? `<p class="orig-t">原标题：${esc(it.title)}</p>` : ""}
    ${it.thumb ? `<img class="cover" src="${esc(it.thumb)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <section class="ai-box"><h2>✦ AI 中文要点</h2>${it.pts && it.pts.length
      ? `<ul>${it.pts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`
      : `<p class="none">这条还没有中文要点（每天自动更新时生成，只处理最近 3 天的内容）。可以点“网页翻译”看全文中文版。</p>`}</section>
    ${it.summary ? `<section class="art-sum"><h2>原文摘要</h2><p>${esc(it.summary)}</p></section>` : ""}
    <div class="art-actions">
      <a class="primary" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>
      ${isEn ? `<a href="${esc(translate)}" target="_blank" rel="noopener noreferrer">网页翻译成中文</a>` : ""}
      <button data-fav="${esc(it.id)}" class="${on ? "on" : ""}">${on ? "★ 已收藏" : "☆ 收藏"}</button>
    </div>
    <p class="note">要点由 AI 根据标题和摘要生成，仅供快速了解，以原文为准。</p>
    <div class="elsewhere">${elsewhereHTML(it.topic || titleOf(it).slice(0, 30), "想看更多讨论？在其他平台搜")}</div>`;
}

const RENDER = { home: renderHome, video: renderVideo, search: renderSearch, fav: renderFav, article: renderArticle };
const render = () => RENDER[state.tab]();

// ---------- 导航 ----------
let prevTab = "home";
function go(hash) {
  let tab = hash;
  if (hash.startsWith("a/")) { tab = "article"; state.artId = decodeURIComponent(hash.slice(2)); }
  else if (!["home", "video", "search", "fav"].includes(tab)) tab = "home";
  if (state.tab !== "article") prevTab = state.tab;
  state.tab = tab;
  document.body.dataset.tab = tab;
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== "view-" + tab;
  for (const a of document.querySelectorAll(".tabbar a")) a.classList.toggle("on", a.dataset.tab === tab);
  render();
  window.scrollTo(0, 0);
  if (tab === "search" && !state.q) setTimeout(() => $("#q").focus(), 50);
}
window.addEventListener("hashchange", () => go(location.hash.slice(1)));

// ---------- 数据 ----------
async function load(force) {
  $("#refresh").classList.add("spin");
  try {
    const res = await fetch("data/items.json" + (force ? "?t=" + Date.now() : ""), { cache: force ? "no-store" : "default" });
    const data = await res.json();
    state.items = (data.items || []).sort(byDate);
    state.byId = new Map(state.items.map((i) => [i.id, i]));
    state.updated = data.updated ? new Date(data.updated) : null;
    state.sources = data.sources || [];
    const now = new Date();
    $("#home-sub").textContent = `${now.getMonth() + 1}月${now.getDate()}日 周${"日一二三四五六"[now.getDay()]}` + (state.updated ? ` · 更新于 ${timeAgo(state.updated)}` : "");
    const ok = state.sources.filter((s) => s.ok).length;
    const zh = state.items.filter((i) => i.pts).length;
    $("#foot").textContent = `共 ${state.items.length} 条 · ${zh} 条有中文要点 · ${ok}/${state.sources.length} 个来源正常 · 每天自动更新`;
  } catch {
    $("#home-sub").textContent = "离线或加载失败，显示的是上次的内容";
  } finally {
    $("#refresh").classList.remove("spin");
  }
  $("#range").value = state.range;
  renderHero();
  render();
}

// ---------- 事件 ----------
document.addEventListener("click", (e) => {
  const t = e.target;
  const fav = t.closest("[data-fav]");
  if (fav) {
    e.preventDefault();
    const id = fav.dataset.fav;
    if (state.favs.has(id)) state.favs.delete(id);
    else { const it = state.byId.get(id); if (it) state.favs.set(id, it); }
    store.set("favs", [...state.favs.values()]);
    if (state.tab === "fav" || state.tab === "article") render();
    else {
      const on = state.favs.has(id);
      for (const b of document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`)) b.classList.toggle("on", on);
    }
    return;
  }
  let b;
  if ((b = t.closest("[data-cat]"))) { state.homeCat = b.dataset.cat; state.group = "all"; state.homeShown = PAGE; store.set("cat", state.homeCat); renderHome(); }
  else if ((b = t.closest("[data-group]"))) { state.group = b.dataset.group; state.homeShown = PAGE; renderHome(); }
  else if ((b = t.closest("[data-chan]"))) { state.chan = b.dataset.chan; state.videoShown = 12; renderVideo(); }
  else if ((b = t.closest("[data-scat]"))) { state.searchCat = b.dataset.scat; state.searchShown = PAGE; renderSearch(); }
  else if ((b = t.closest("[data-fcat]"))) { state.favCat = b.dataset.fcat; renderFav(); }
  else if ((b = t.closest(".hot button"))) { $("#q").value = b.textContent; state.q = b.textContent; state.searchCat = "all"; renderSearch(); }
  else if ((b = t.closest(".card[data-open]")) && !t.closest("a")) { location.hash = "a/" + encodeURIComponent(b.dataset.open); }
});
$("#art-back").addEventListener("click", () => { history.length > 1 ? history.back() : (location.hash = prevTab); });
$("#range").addEventListener("change", (e) => { state.range = e.target.value; state.homeShown = PAGE; store.set("range", state.range); renderHome(); });
$("#refresh").addEventListener("click", () => load(true));
$("#go-search").addEventListener("click", () => { location.hash = "search"; });
$("#home-more").addEventListener("click", () => { state.homeShown += PAGE; renderHome(); });
$("#video-more").addEventListener("click", () => { state.videoShown += 12; renderVideo(); });
$("#search-more").addEventListener("click", () => { state.searchShown += PAGE; renderSearch(); });
let timer;
$("#q").addEventListener("input", (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = e.target.value.trim(); state.searchCat = "all"; state.searchShown = PAGE; renderSearch(); }, 150);
});
$("#q-clear").addEventListener("click", () => { $("#q").value = ""; state.q = ""; renderSearch(); $("#q").focus(); });
$("#q-cancel").addEventListener("click", () => { $("#q").value = ""; state.q = ""; location.hash = "home"; });
$("#hero").addEventListener("scroll", () => {
  const h = $("#hero"), cards = h.children;
  if (!cards.length) return;
  const i = Math.round(h.scrollLeft / (cards[0].offsetWidth + 12));
  [...$("#dots").children].forEach((d, k) => d.classList.toggle("on", k === i));
}, { passive: true });
$("#hot").insertAdjacentHTML("beforeend", HOT.map((w) => `<button>${esc(w)}</button>`).join(""));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
go(location.hash.slice(1) || "home");
load(false);
