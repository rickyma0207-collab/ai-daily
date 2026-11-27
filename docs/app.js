// AI 日报 —— 首页 / 视频 / 搜索 / 收藏 四个页面，数据来自 data/items.json
const CATS = [["all", "全部"], ["news", "新闻"], ["blog", "官方博客"], ["paper", "论文"], ["video", "视频"], ["zh", "中文"], ["finance", "财经"]];
const CAT_NAME = Object.fromEntries(CATS);
const HOT = ["GPT", "Claude", "Gemini", "智能体", "具身", "DeepSeek", "开源", "芯片"];
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
  items: [], updated: null, sources: [],
  tab: "home",
  homeCat: store.get("cat", "all"), range: store.get("range", "1"), homeShown: PAGE,
  chan: "all", videoShown: 12,
  q: "", searchCat: "all", searchShown: PAGE,
  favCat: "all",
  favs: new Map(store.get("favs", []).map((i) => [i.id, i])),
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const terms = () => state.q.toLowerCase().split(/\s+/).filter(Boolean);
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

// ---------- 组件 ----------
function chipsHTML(list, active, counts, attr) {
  return list.map(([k, v]) =>
    `<button class="chip" data-${attr}="${esc(k)}" aria-pressed="${active === k}">${esc(v)}${counts && counts[k] != null ? `<span class="n">${counts[k]}</span>` : ""}</button>`
  ).join("");
}
function countBy(items) {
  const c = { all: items.length };
  for (const it of items) c[it.cat] = (c[it.cat] || 0) + 1;
  return c;
}
function starBtn(it) {
  const on = state.favs.has(it.id);
  return `<button class="star ${on ? "on" : ""}" data-fav="${esc(it.id)}" aria-label="${on ? "取消收藏" : "收藏"}">${STAR}</button>`;
}
function cardHTML(it, ts = []) {
  const d = new Date(it.date);
  return `<article class="card">
    <div class="body">
      <a class="t" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${hl(it.title, ts)}</a>
      ${it.summary ? `<p class="s">${hl(it.summary, ts)}</p>` : ""}
      <div class="meta">
        <span class="tag ${esc(it.cat)}">${esc(CAT_NAME[it.cat] || it.cat)}</span>
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
      <a class="t" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${hl(it.title, ts)}</a>
      <div class="meta"><span class="avatar">${esc(it.source.slice(0, 1))}</span>
        <span class="src">${esc(it.source)}</span><span class="time">· ${timeAgo(new Date(it.date))}</span>${starBtn(it)}</div>
    </div>
  </article>`;
}
const itemHTML = (it, ts) => (it.cat === "video" ? videoHTML(it, ts) : cardHTML(it, ts));

// ---------- 首页 ----------
function renderHero() {
  const recent = state.items.filter((i) => ["blog", "news", "zh"].includes(i.cat) && inRange(i, 2));
  const picks = [...recent.filter((i) => i.thumb), ...recent.filter((i) => !i.thumb)];
  const seen = new Set(), hero = [];
  for (const it of picks) { if (seen.has(it.source)) continue; seen.add(it.source); hero.push(it); if (hero.length === 5) break; }
  $("#hero").innerHTML = hero.map((it, i) => `
    <a class="hero-card" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer"
       style="background-image:${it.thumb ? `url('${esc(it.thumb).replace(/'/g, "%27")}'),` : ""}${HERO_GRADS[i % HERO_GRADS.length]}">
      <span class="badge">${i === 0 ? "🔥 今日要闻" : esc(CAT_NAME[it.cat])}</span>
      <h3>${esc(it.title)}</h3>
      <span class="m">${esc(it.source)} · ${timeAgo(new Date(it.date))}</span>
    </a>`).join("");
  $("#dots").innerHTML = hero.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("");
  $("#hero").hidden = $("#dots").hidden = !hero.length;
}
function renderHome() {
  const days = +state.range;
  const pool = state.items.filter((i) => inRange(i, days));
  $("#home-cats").innerHTML = chipsHTML(CATS, state.homeCat, countBy(pool), "cat");
  const list = pool.filter((i) => state.homeCat === "all" || i.cat === state.homeCat);
  let html = "", last = "";
  for (const it of list.slice(0, state.homeShown)) {
    const lab = dayLabel(new Date(it.date));
    if (lab !== last) { if (last) html += `<div class="day">${lab}</div>`; last = lab; }
    html += itemHTML(it);
  }
  const first = list[0] ? dayLabel(new Date(list[0].date)) : "";
  $("#home-label").textContent = first || "暂无内容";
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
  if (!ts.length) {
    $("#search-cats").innerHTML = "";
    $("#search-count").textContent = "输入关键词，在全部历史内容里搜索";
    $("#search-list").innerHTML = "";
    $("#search-more").hidden = true;
    return;
  }
  const hits = state.items.filter((it) => {
    const hay = (it.title + " " + it.summary + " " + it.source).toLowerCase();
    return ts.every((t) => hay.includes(t));
  });
  const counts = countBy(hits);
  $("#search-cats").innerHTML = chipsHTML(CATS.filter(([k]) => k === "all" || counts[k]), state.searchCat, counts, "scat");
  const list = hits.filter((i) => state.searchCat === "all" || i.cat === state.searchCat);
  $("#search-count").textContent = `在全部时间内找到 ${list.length} 条结果`;
  $("#search-list").innerHTML = list.slice(0, state.searchShown).map((it) => itemHTML(it, ts)).join("") || `<div class="empty">没有找到相关内容，换个关键词试试</div>`;
  $("#search-more").hidden = list.length <= state.searchShown;
}

// ---------- 收藏 ----------
function renderFav() {
  const favs = [...state.favs.values()].sort(byDate);
  const counts = countBy(favs);
  $("#fav-sub").textContent = `${favs.length} 条 · 保存在这台手机上`;
  $("#fav-cats").innerHTML = favs.length ? chipsHTML(CATS.filter(([k]) => k === "all" || counts[k]), state.favCat, counts, "fcat") : "";
  const list = favs.filter((i) => state.favCat === "all" || i.cat === state.favCat);
  $("#fav-list").innerHTML = list.map((it) => itemHTML(it)).join("") || `<div class="empty">还没有收藏<br>看到喜欢的内容，点卡片右下角的 ☆ 收藏</div>`;
}

function render() {
  ({ home: renderHome, video: renderVideo, search: renderSearch, fav: renderFav })[state.tab]();
}

// ---------- 导航 ----------
function go(tab) {
  if (!["home", "video", "search", "fav"].includes(tab)) tab = "home";
  state.tab = tab;
  document.body.dataset.tab = tab;
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== "view-" + tab;
  for (const a of document.querySelectorAll(".tabbar a")) a.classList.toggle("on", a.dataset.tab === tab);
  render();
  window.scrollTo(0, 0);
  if (tab === "search") setTimeout(() => $("#q").focus(), 50);
}
window.addEventListener("hashchange", () => go(location.hash.slice(1)));

// ---------- 数据 ----------
async function load(force) {
  $("#refresh").classList.add("spin");
  try {
    const res = await fetch("data/items.json" + (force ? "?t=" + Date.now() : ""), { cache: force ? "no-store" : "default" });
    const data = await res.json();
    state.items = (data.items || []).sort(byDate);
    state.updated = data.updated ? new Date(data.updated) : null;
    state.sources = data.sources || [];
    const now = new Date();
    $("#home-sub").textContent = `${now.getMonth() + 1}月${now.getDate()}日 周${"日一二三四五六"[now.getDay()]}` + (state.updated ? ` · 更新于 ${timeAgo(state.updated)}` : "");
    const ok = state.sources.filter((s) => s.ok).length;
    $("#foot").textContent = `共 ${state.items.length} 条 · ${ok}/${state.sources.length} 个来源正常 · 每天自动更新`;
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
    const id = fav.dataset.fav;
    if (state.favs.has(id)) state.favs.delete(id);
    else { const it = state.items.find((i) => i.id === id); if (it) state.favs.set(id, it); }
    store.set("favs", [...state.favs.values()]);
    const on = state.favs.has(id);
    for (const b of document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`)) b.classList.toggle("on", on);
    if (state.tab === "fav") renderFav();
    return;
  }
  let b;
  if ((b = t.closest("[data-cat]"))) { state.homeCat = b.dataset.cat; state.homeShown = PAGE; store.set("cat", state.homeCat); renderHome(); }
  else if ((b = t.closest("[data-chan]"))) { state.chan = b.dataset.chan; state.videoShown = 12; renderVideo(); }
  else if ((b = t.closest("[data-scat]"))) { state.searchCat = b.dataset.scat; state.searchShown = PAGE; renderSearch(); }
  else if ((b = t.closest("[data-fcat]"))) { state.favCat = b.dataset.fcat; renderFav(); }
  else if ((b = t.closest(".hot button"))) { $("#q").value = b.textContent; state.q = b.textContent; state.searchCat = "all"; renderSearch(); }
  else if (t.closest(".card .s")) t.closest(".card").classList.toggle("open");
});
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
$("#q-cancel").addEventListener("click", () => { $("#q").value = ""; state.q = ""; history.length > 1 ? history.back() : (location.hash = "home"); });
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
