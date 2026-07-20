// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
/**
 * 南方电网 · Scriptable 小组件 v1.3.1
 *
 * 修复：
 * - 中号高度裁切：压缩字号/间距/柱图，控制信息密度
 * - 明暗适配：使用 Color.dynamic，跟随系统外观（勿用 Device 单次判断）
 *
 * 参数（可选 JSON）：
 * { "url", "index", "showRecent", "refreshMinutes" }
 */

const VERSION = "1.3.1";
const DEFAULT_URL = "https://api.csg-rewrite.com/electricity/bill/all";
const LOGO_URL =
  "https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/scriptable/assets/csg.png";
const CACHE_FILE = "csg-widget-cache.json";
const LOGO_CACHE = "csg-logo.png";
const REQUEST_TIMEOUT = 110;
const DEFAULT_REFRESH_MINUTES = 60;

const widgetFamily = config.widgetFamily || "medium";
const isSmall = widgetFamily === "small";
const isLarge = widgetFamily === "large";
const isMedium = !isSmall && !isLarge;

let params = {};
try {
  if (args.widgetParameter) {
    params =
      typeof args.widgetParameter === "string"
        ? JSON.parse(args.widgetParameter)
        : args.widgetParameter;
  }
} catch (_) {
  params = {};
}

const API_URL = params.url || DEFAULT_URL;
const ACCOUNT_INDEX = Math.max(0, Number(params.index) || 0);
const SHOW_RECENT = params.showRecent !== false;
const REFRESH_MINUTES = Math.max(
  15,
  Number(params.refreshMinutes) || DEFAULT_REFRESH_MINUTES
);

// -------------------- Theme: Color.dynamic（系统自动明暗）--------------------

/** 浅色 / 深色 自动切换 */
function dyn(lightHex, darkHex, lightAlpha, darkAlpha) {
  const la = lightAlpha == null ? 1 : lightAlpha;
  const da = darkAlpha == null ? la : darkAlpha;
  return Color.dynamic(new Color(lightHex, la), new Color(darkHex, da));
}

function getTheme() {
  return {
    // 背景：浅色近白蓝，深色南网蓝
    bg0: dyn("#E8F2FF", "#0A2748"),
    bg1: dyn("#F5F9FF", "#0F355C"),
    text: dyn("#0B1F3A", "#FFFFFF"),
    text2: dyn("#3D4F63", "#FFFFFF", 1, 0.8),
    text3: dyn("#7A8796", "#FFFFFF", 1, 0.55),
    accent: dyn("#0B5CAB", "#5AC8FA"),
    bar: dyn("#1A6BB5", "#0A84FF"),
    barTrack: dyn("#0B5CAB", "#FFFFFF", 0.12, 0.14),
    warn: dyn("#C93400", "#FFD60A"),
    error: dyn("#B85C00", "#FF9F0A"),
  };
}

// -------------------- Main --------------------

async function main() {
  const theme = getTheme();
  const logo = await loadLogo();

  let payload;
  let fromCache = false;
  let cacheTs = null;

  try {
    payload = await fetchBill();
    await saveCache(payload);
    cacheTs = Date.now();
  } catch (e) {
    const cached = loadCache();
    if (cached?.data) {
      payload = cached.data;
      fromCache = true;
      cacheTs = cached.ts || null;
    } else {
      const w = errorWidget(friendlyError(e), theme, logo);
      setRefresh(w);
      await present(w);
      return;
    }
  }

  const list = normalizeList(payload);
  if (!list.length) {
    const w = errorWidget(
      "无户号数据。请打开「南网在线」进入电费页捕获 Token。",
      theme,
      logo
    );
    setRefresh(w);
    await present(w);
    return;
  }

  const index = Math.min(ACCOUNT_INDEX, list.length - 1);
  const item = enrichItem(list[index]);
  const w = buildWidget(item, theme, logo, {
    fromCache,
    cacheTs,
    multi: list.length,
    index,
  });
  setRefresh(w);
  await present(w);
}

function enrichItem(item) {
  const m = item.monthElecQuantity || {};
  const year = m.year || {};
  const last = { ...(m.lastMonth || {}) };
  const d = { ...(item.dayElecQuantity || {}) };
  const byDay = item.dayElecQuantity31?.byDay || d.recent || [];

  if (last.totalKwh == null && last.totalCost == null && year.byMonth?.length) {
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    const key = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const hit = year.byMonth.find(
      (x) => String(x.month || "").replace("/", "-").slice(0, 7) === key
    );
    if (hit) {
      last.totalKwh = hit.kwh;
      last.totalCost = hit.charge;
    }
  }

  if (d.yesterday == null && byDay.length) {
    const lastRow = byDay[byDay.length - 1];
    if (lastRow && n(lastRow.kwh) != null) {
      d.yesterday = lastRow.kwh;
      d.latestDay = lastRow.date;
    }
  }

  let recent = d.recent;
  if (!recent?.length && byDay.length) recent = byDay.slice(-5);
  d.recent = recent;

  return {
    ...item,
    monthElecQuantity: { ...m, lastMonth: last, year },
    dayElecQuantity: d,
  };
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function fetchBill() {
  const req = new Request(API_URL);
  req.method = "GET";
  req.timeoutInterval = REQUEST_TIMEOUT;
  req.headers = {
    Accept: "application/json",
    "User-Agent": `Scriptable-CSG-Widget/${VERSION}`,
  };
  let json;
  try {
    json = await req.loadJSON();
  } catch (e) {
    throw new Error(
      e.message || "请求失败。请保持 Surge 开启并检查 MitM / 模块。"
    );
  }
  if (json?.error) throw new Error(json.message || "接口错误（Token 可能失效）");
  if (!Array.isArray(json) && !Array.isArray(json?.data)) {
    throw new Error("返回格式异常");
  }
  return json;
}

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (/登录态|Token|失效|未登录/i.test(msg)) {
    return `${msg}\n请打开南网在线 → 电费页重新捕获 Token。`;
  }
  if (/timed?\s*out|超时/i.test(msg)) return "请求超时，可把模块 TIMEOUT 调到 120。";
  if (/connect|网络|NSURLError|offline/i.test(msg)) {
    return "无法连接，请确认 Surge 已开启。";
  }
  return msg;
}

// -------------------- Storage --------------------

function fmLocal() {
  return FileManager.local();
}

function cachePath() {
  return fmLocal().joinPath(fmLocal().documentsDirectory(), CACHE_FILE);
}

function logoCachePath() {
  return fmLocal().joinPath(fmLocal().documentsDirectory(), LOGO_CACHE);
}

async function saveCache(data) {
  try {
    fmLocal().writeString(
      cachePath(),
      JSON.stringify({ ts: Date.now(), data, version: VERSION })
    );
  } catch (_) {}
}

function loadCache() {
  try {
    const p = cachePath();
    if (!fmLocal().fileExists(p)) return null;
    const j = JSON.parse(fmLocal().readString(p));
    return j?.data ? j : null;
  } catch (_) {
    return null;
  }
}

async function loadLogo() {
  const f = fmLocal();
  const p = logoCachePath();
  try {
    if (f.fileExists(p)) return f.readImage(p);
  } catch (_) {}
  try {
    const req = new Request(LOGO_URL);
    req.timeoutInterval = 15;
    const img = await req.loadImage();
    try {
      f.writeImage(p, img);
    } catch (_) {}
    return img;
  } catch (_) {
    return null;
  }
}

// -------------------- Format --------------------

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmt(v, d = 2) {
  const x = n(v);
  return x == null ? null : x.toFixed(d);
}

function fmtOr(v, d, fb = "--") {
  return fmt(v, d) ?? fb;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function shortAddress(addr, maxLen) {
  if (!addr) return "";
  let s = String(addr)
    .replace(
      /^(.{2,3}壮族自治区|.{2,3}维吾尔自治区|.{2,3}回族自治区|.{2,3}自治区|.{2,3}省)/,
      ""
    )
    .replace(/^广西/, "");
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

function setRefresh(w) {
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
}

async function present(w) {
  if (config.runsInWidget) Script.setWidget(w);
  else if (isSmall) await w.presentSmall();
  else if (isLarge) await w.presentLarge();
  else await w.presentMedium();
  Script.complete();
}

function applyBackground(w, theme) {
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [theme.bg0, theme.bg1];
  w.backgroundGradient = g;
}

// -------------------- Build UI --------------------

function buildWidget(item, theme, logo, meta) {
  const w = new ListWidget();
  // 中号边距再压一点，避免裁切
  const pad = isSmall ? 10 : isMedium ? 10 : 14;
  w.setPadding(pad, pad + 2, pad, pad + 2);
  applyBackground(w, theme);

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const last = m.lastMonth || {};
  const year = m.year || {};
  const arrears = n(b.arrears) || 0;
  const isArrears =
    item.arrearsOfFees || arrears > 0 || (n(b.balance) || 0) < 0;

  // —— Header（单行，省高度）——
  addHeader(w, theme, logo, meta);

  // —— 余额 ——
  const gap1 = isMedium ? 4 : 6;
  w.addSpacer(gap1);

  const balStack = w.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();

  if (!isSmall) {
    const balLabel = balStack.addText(isArrears ? "欠费 " : "余额 ");
    balLabel.font = Font.systemFont(11);
    balLabel.textColor = theme.text3;
  }

  const balVal = isArrears && arrears > 0 ? arrears : b.balance;
  const bal = balStack.addText(fmtOr(balVal, 2));
  bal.font = Font.boldSystemFont(isSmall ? 22 : isMedium ? 24 : 28);
  bal.textColor = isArrears ? theme.warn : theme.text;

  const unit = balStack.addText(" 元");
  unit.font = Font.systemFont(isMedium ? 12 : 13);
  unit.textColor = theme.text2;

  balStack.addSpacer();
  // 小尺寸把状态放余额行右侧
  if (isSmall) {
    let badgeText = meta.fromCache ? "缓存" : "实时";
    if (meta.fromCache && meta.cacheTs) badgeText = `缓存${fmtTime(meta.cacheTs)}`;
    const bd = balStack.addText(badgeText);
    bd.font = Font.systemFont(9);
    bd.textColor = theme.text3;
  }

  w.addSpacer(isMedium ? 4 : 6);

  // —— 指标区 ——
  if (isSmall) {
    buildSmallBody(w, theme, m, d);
  } else if (isMedium) {
    buildMediumBody(w, theme, m, d, last, year);
  } else {
    buildLargeBody(w, theme, m, d, last, year);
  }

  // —— 近五日柱图（中/大；中号用更矮柱）——
  const recent = (d.recent || []).slice(-5).filter((r) => n(r.kwh) != null);
  if (SHOW_RECENT && !isSmall && recent.length) {
    w.addSpacer(isMedium ? 4 : 8);
    addRecentBars(w, recent, theme);
  }

  // —— 页脚地址（中号更短）——
  w.addSpacer(isMedium ? 4 : 6);
  const foot = w.addStack();
  foot.layoutHorizontally();
  foot.centerAlignContent();
  const addr = shortAddress(
    u.address || u.userName || u.accountNumber || "",
    isSmall ? 12 : isMedium ? 18 : 24
  );
  const f1 = foot.addText(addr || "南网户号");
  f1.font = Font.systemFont(9);
  f1.textColor = theme.text3;
  f1.lineLimit = 1;
  f1.minimumScaleFactor = 0.8;
  foot.addSpacer();
  if (meta.multi > 1) {
    const idx = foot.addText(`${meta.index + 1}/${meta.multi}`);
    idx.font = Font.systemFont(9);
    idx.textColor = theme.text3;
  }

  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}
  return w;
}

function addHeader(w, theme, logo, meta) {
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();

  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(isSmall ? 12 : 13);
  title.textColor = theme.text;

  if (!isSmall) {
    head.addSpacer(6);
    let badgeText = meta.fromCache ? "缓存" : "实时";
    if (meta.fromCache && meta.cacheTs) {
      badgeText = `缓存 ${fmtTime(meta.cacheTs)}`;
    }
    const badge = head.addText(badgeText);
    badge.font = Font.systemFont(10);
    badge.textColor = theme.text3;
  }

  head.addSpacer();

  if (logo) {
    const logoSize = isSmall ? 22 : isMedium ? 26 : 32;
    const img = head.addImage(logo);
    img.imageSize = new Size(logoSize, logoSize);
    img.cornerRadius = 5;
  }
}

function buildSmallBody(w, theme, m, d) {
  const parts = [];
  if (n(m.totalKwh) != null) parts.push(`${fmt(m.totalKwh, 1)} kWh`);
  if (n(m.totalCost) != null) parts.push(`${fmt(m.totalCost, 2)} 元`);
  if (parts.length) {
    const line = w.addText(`本月 ${parts.join(" · ")}`);
    line.font = Font.systemFont(11);
    line.textColor = theme.text2;
    line.lineLimit = 1;
    line.minimumScaleFactor = 0.8;
  }
  if (n(d.yesterday) != null) {
    const label = d.latestDay ? String(d.latestDay).slice(5) : "近";
    const y = w.addText(`${label} ${fmt(d.yesterday, 1)} kWh`);
    y.font = Font.systemFont(10);
    y.textColor = theme.text3;
    y.lineLimit = 1;
  }
}

/** 中号：一行塞满关键指标，不再第二行「本年」，防裁切 */
function buildMediumBody(w, theme, m, d, last, year) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.spacing = 6;

  if (n(m.totalKwh) != null) {
    addMetric(row, "本月", `${fmt(m.totalKwh, 1)} kWh`, theme, true);
  }
  if (n(d.yesterday) != null) {
    const yl = d.latestDay ? String(d.latestDay).slice(5) : "昨日";
    addMetric(row, yl, `${fmt(d.yesterday, 1)} kWh`, theme, true);
  }
  if (n(last.totalKwh) != null || n(last.totalCost) != null) {
    const bits = [];
    if (n(last.totalKwh) != null) bits.push(`${fmt(last.totalKwh, 0)}`);
    if (n(last.totalCost) != null) bits.push(`${fmt(last.totalCost, 0)}元`);
    addMetric(row, "上月", bits.join("/"), theme, true);
  } else if (n(year.yearKwh) != null) {
    addMetric(row, "本年", `${fmt(year.yearKwh, 0)} kWh`, theme, true);
  }
}

function buildLargeBody(w, theme, m, d, last, year) {
  const metrics = [];
  if (n(m.totalKwh) != null)
    metrics.push(["本月电量", `${fmt(m.totalKwh, 1)} kWh`]);
  if (n(m.totalCost) != null)
    metrics.push(["本月电费", `${fmt(m.totalCost, 2)} 元`]);
  if (n(d.yesterday) != null) {
    const yl = d.latestDay ? String(d.latestDay).slice(5) : "昨日";
    metrics.push([yl, `${fmt(d.yesterday, 1)} kWh`]);
  }
  if (n(last.totalKwh) != null || n(last.totalCost) != null) {
    const bits = [];
    if (n(last.totalKwh) != null) bits.push(`${fmt(last.totalKwh, 0)} kWh`);
    if (n(last.totalCost) != null) bits.push(`${fmt(last.totalCost, 2)} 元`);
    metrics.push(["上月", bits.join(" / ")]);
  }
  if (n(year.yearKwh) != null)
    metrics.push(["本年电量", `${fmt(year.yearKwh, 0)} kWh`]);
  if (n(year.yearCost) != null)
    metrics.push(["本年电费", `${fmt(year.yearCost, 2)} 元`]);

  for (let i = 0; i < metrics.length; i += 3) {
    if (i > 0) w.addSpacer(6);
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 8;
    for (const [label, value] of metrics.slice(i, i + 3)) {
      addMetric(row, label, value, theme, false);
    }
  }
}

function addMetric(parent, label, value, theme, compact) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = compact ? 1 : 2;
  const l = col.addText(label);
  l.font = Font.systemFont(compact ? 9 : 10);
  l.textColor = theme.text3;
  l.lineLimit = 1;
  l.minimumScaleFactor = 0.7;
  const v = col.addText(value);
  v.font = Font.mediumSystemFont(compact ? 11 : 12);
  v.textColor = theme.text;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.65;
}

/**
 * 近五日：数值在上、短柱、日期在下
 * 中号柱高严格控制，避免撑破小组件
 */
function addRecentBars(parent, recent, theme) {
  const maxK = Math.max(...recent.map((r) => n(r.kwh) || 0), 0.01);
  // 中号 ~18pt 柱 + 上下文字 ≈ 可接受；大号可更高
  const barMaxH = isLarge ? 44 : 18;
  const barW = isLarge ? 32 : 24;
  const fontSize = isLarge ? 9 : 8;

  const title = parent.addText("近五日");
  title.font = Font.systemFont(9);
  title.textColor = theme.text3;

  parent.addSpacer(2);

  const row = parent.addStack();
  row.layoutHorizontally();
  row.spacing = isLarge ? 10 : 6;
  row.bottomAlignContent();
  row.centerAlignContent();

  for (const day of recent) {
    const kwh = n(day.kwh) || 0;
    const h = Math.max(4, Math.round((kwh / maxK) * barMaxH));

    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.spacing = 2;

    const vt = col.addText(fmt(kwh, 1));
    vt.font = Font.mediumSystemFont(fontSize);
    vt.textColor = theme.text2;
    vt.lineLimit = 1;
    vt.centerAlignText();
    vt.minimumScaleFactor = 0.7;

    // 简化柱：不再套多层壳，减少布局误差
    const bar = col.addStack();
    bar.size = new Size(barW, h);
    bar.backgroundColor = theme.bar;
    bar.cornerRadius = 3;

    const md = String(day.date || "").slice(8); // 只显示日，更短
    const dt = col.addText(md || "--");
    dt.font = Font.systemFont(fontSize);
    dt.textColor = theme.text3;
    dt.lineLimit = 1;
    dt.centerAlignText();
  }
}

function errorWidget(msg, theme, logo) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);
  applyBackground(w, theme);

  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(14);
  title.textColor = theme.text;
  head.addSpacer();
  if (logo) {
    const img = head.addImage(logo);
    img.imageSize = new Size(26, 26);
    img.cornerRadius = 5;
  }

  w.addSpacer(8);
  const b = w.addText(msg);
  b.font = Font.systemFont(12);
  b.textColor = theme.error;
  b.lineLimit = 8;
  b.minimumScaleFactor = 0.85;

  w.addSpacer(6);
  const tip = w.addText("Surge · 模块 · App 捕获 Token");
  tip.font = Font.systemFont(10);
  tip.textColor = theme.text3;

  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}
  return w;
}

await main();
