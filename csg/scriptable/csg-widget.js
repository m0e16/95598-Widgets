// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
/**
 * 南方电网 · Scriptable 小组件 v1.4.0
 *
 * - 明暗：文字/柱用 Color.dynamic；深色背景用 bg-dark.png
 * - 中号近五日：横向柱状图；大号：底对齐纵向柱
 * - 余额 ≤ 5 元红色警示；去掉「实时/缓存」角标
 * - Logo 加大；日期 MM-DD
 */

const VERSION = "1.4.0";
const DEFAULT_URL = "https://api.csg-rewrite.com/electricity/bill/all";
const LOGO_URL =
  "https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/scriptable/assets/csg.png";
const BG_DARK_URL =
  "https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/scriptable/assets/bg-dark.png";
const CACHE_FILE = "csg-widget-cache.json";
const LOGO_CACHE = "csg-logo.png";
const BG_DARK_CACHE = "csg-bg-dark.png";
const REQUEST_TIMEOUT = 110;
const DEFAULT_REFRESH_MINUTES = 60;
/** 余额低于等于该值时用红色显示 */
const LOW_BALANCE = 5;

const widgetFamily = config.widgetFamily || "medium";
const isSmall = widgetFamily === "small";
const isLarge = widgetFamily === "large";
const isMedium = !isSmall && !isLarge;
const isDark =
  typeof Device !== "undefined" && Device.isUsingDarkAppearance
    ? Device.isUsingDarkAppearance()
    : true;

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

// -------------------- Theme --------------------

function dyn(lightHex, darkHex, lightAlpha, darkAlpha) {
  const la = lightAlpha == null ? 1 : lightAlpha;
  const da = darkAlpha == null ? la : darkAlpha;
  return Color.dynamic(new Color(lightHex, la), new Color(darkHex, da));
}

function getTheme() {
  return {
    // 浅色渐变底；深色优先用背景图，这两色作兜底
    bg0: dyn("#E8F2FF", "#2C2C2E"),
    bg1: dyn("#F5F9FF", "#1C1C1E"),
    text: dyn("#0B1F3A", "#FFFFFF"),
    text2: dyn("#3D4F63", "#FFFFFF", 1, 0.82),
    text3: dyn("#7A8796", "#FFFFFF", 1, 0.55),
    bar: dyn("#1A6BB5", "#0A84FF"),
    barTrack: dyn("#0B5CAB", "#FFFFFF", 0.12, 0.14),
    warn: dyn("#C93400", "#FFD60A"),
    danger: dyn("#D70015", "#FF453A"),
    error: dyn("#B85C00", "#FF9F0A"),
  };
}

// -------------------- Main --------------------

async function main() {
  const theme = getTheme();
  const [logo, bgDark] = await Promise.all([loadLogo(), loadDarkBg()]);

  let payload;
  let fromCache = false;

  try {
    payload = await fetchBill();
    await saveCache(payload);
  } catch (e) {
    const cached = loadCache();
    if (cached?.data) {
      payload = cached.data;
      fromCache = true;
    } else {
      const w = errorWidget(friendlyError(e), theme, logo, bgDark);
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
      logo,
      bgDark
    );
    setRefresh(w);
    await present(w);
    return;
  }

  const index = Math.min(ACCOUNT_INDEX, list.length - 1);
  const item = enrichItem(list[index]);
  const w = buildWidget(item, theme, logo, bgDark, {
    fromCache,
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
    throw new Error(e.message || "请求失败。请保持 Surge 开启。");
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

// -------------------- Storage / assets --------------------

function fmLocal() {
  return FileManager.local();
}

function cachePath() {
  return fmLocal().joinPath(fmLocal().documentsDirectory(), CACHE_FILE);
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

async function loadCachedImage(url, cacheName) {
  const f = fmLocal();
  const p = f.joinPath(f.documentsDirectory(), cacheName);
  try {
    if (f.fileExists(p)) return f.readImage(p);
  } catch (_) {}
  try {
    const req = new Request(url);
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

async function loadLogo() {
  return loadCachedImage(LOGO_URL, LOGO_CACHE);
}

async function loadDarkBg() {
  return loadCachedImage(BG_DARK_URL, BG_DARK_CACHE);
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

/** MM-DD */
function fmtMD(dateStr) {
  const s = String(dateStr || "");
  if (s.length >= 10) return s.slice(5, 10);
  if (s.length >= 5) return s.slice(0, 5);
  return s || "--";
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

function applyBackground(w, theme, bgDark) {
  if (isDark && bgDark) {
    w.backgroundImage = bgDark;
    return;
  }
  if (isDark) {
    w.backgroundColor = new Color("#2C2C2E");
    return;
  }
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [theme.bg0, theme.bg1];
  w.backgroundGradient = g;
}

// -------------------- Build UI --------------------

function buildWidget(item, theme, logo, bgDark, meta) {
  const w = new ListWidget();
  const pad = isSmall ? 10 : isMedium ? 11 : 14;
  w.setPadding(pad, pad + 2, pad, pad + 2);
  applyBackground(w, theme, bgDark);

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const last = m.lastMonth || {};
  const year = m.year || {};
  const arrears = n(b.arrears) || 0;
  const isArrears =
    item.arrearsOfFees || arrears > 0 || (n(b.balance) || 0) < 0;
  const balVal = isArrears && arrears > 0 ? arrears : n(b.balance);
  const isLowBal = balVal != null && balVal <= LOW_BALANCE;

  // —— Header：标题 + 大 Logo（无「实时」）——
  addHeader(w, theme, logo);

  w.addSpacer(isMedium ? 5 : 6);

  // —— 余额 ——
  const balStack = w.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();

  if (!isSmall) {
    const balLabel = balStack.addText(isArrears ? "欠费 " : "余额 ");
    balLabel.font = Font.systemFont(11);
    balLabel.textColor = theme.text3;
  }

  const bal = balStack.addText(fmtOr(balVal, 2));
  bal.font = Font.boldSystemFont(isSmall ? 22 : isMedium ? 24 : 28);
  if (isArrears || isLowBal) {
    bal.textColor = theme.danger;
  } else {
    bal.textColor = theme.text;
  }

  const unit = balStack.addText(" 元");
  unit.font = Font.systemFont(isMedium ? 12 : 13);
  unit.textColor = isLowBal || isArrears ? theme.danger : theme.text2;

  w.addSpacer(isMedium ? 5 : 6);

  // —— 指标 ——
  if (isSmall) {
    buildSmallBody(w, theme, m, d);
  } else if (isMedium) {
    buildMediumBody(w, theme, m, d, last, year);
  } else {
    buildLargeBody(w, theme, m, d, last, year);
  }

  // —— 近五日 ——
  const recent = (d.recent || []).slice(-5).filter((r) => n(r.kwh) != null);
  if (SHOW_RECENT && !isSmall && recent.length) {
    w.addSpacer(isMedium ? 5 : 8);
    if (isMedium) {
      addRecentBarsHorizontal(w, recent, theme);
    } else {
      addRecentBarsVertical(w, recent, theme);
    }
  }

  // —— 页脚 ——
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

function addHeader(w, theme, logo) {
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();

  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(isSmall ? 13 : 14);
  title.textColor = theme.text;

  head.addSpacer();

  if (logo) {
    // 加大 Logo
    const logoSize = isSmall ? 34 : isMedium ? 40 : 48;
    const img = head.addImage(logo);
    img.imageSize = new Size(logoSize, logoSize);
    img.cornerRadius = 8;
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
    const label = d.latestDay ? fmtMD(d.latestDay) : "近";
    const y = w.addText(`${label} ${fmt(d.yesterday, 1)} kWh`);
    y.font = Font.systemFont(10);
    y.textColor = theme.text3;
    y.lineLimit = 1;
  }
}

function buildMediumBody(w, theme, m, d, last, year) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.spacing = 8;

  if (n(m.totalKwh) != null) {
    addMetric(row, "本月", `${fmt(m.totalKwh, 1)} kWh`, theme, true);
  }
  if (n(d.yesterday) != null) {
    const yl = d.latestDay ? fmtMD(d.latestDay) : "昨日";
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
    const yl = d.latestDay ? fmtMD(d.latestDay) : "昨日";
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
 * 大号：纵向柱，固定柱区高度保证底对齐；日期 MM-DD 小字
 */
function addRecentBarsVertical(parent, recent, theme) {
  const maxK = Math.max(...recent.map((r) => n(r.kwh) || 0), 0.01);
  const barMaxH = 40;
  const barW = 30;

  const title = parent.addText("近五日用电");
  title.font = Font.systemFont(9);
  title.textColor = theme.text3;
  parent.addSpacer(3);

  const row = parent.addStack();
  row.layoutHorizontally();
  row.spacing = 8;
  row.bottomAlignContent();

  for (const day of recent) {
    const kwh = n(day.kwh) || 0;
    const h = Math.max(4, Math.round((kwh / maxK) * barMaxH));

    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.spacing = 2;

    const vt = col.addText(fmt(kwh, 1));
    vt.font = Font.systemFont(8);
    vt.textColor = theme.text2;
    vt.lineLimit = 1;
    vt.centerAlignText();
    vt.minimumScaleFactor = 0.7;

    // 固定高度柱区 → 柱底对齐
    const zone = col.addStack();
    zone.layoutVertically();
    zone.size = new Size(barW, barMaxH);
    zone.bottomAlignContent();

    const gap = zone.addStack();
    gap.size = new Size(barW, Math.max(0, barMaxH - h));

    const bar = zone.addStack();
    bar.size = new Size(barW, h);
    bar.backgroundColor = theme.bar;
    bar.cornerRadius = 4;

    const dt = col.addText(fmtMD(day.date));
    dt.font = Font.systemFont(8);
    dt.textColor = theme.text3;
    dt.lineLimit = 1;
    dt.centerAlignText();
    dt.minimumScaleFactor = 0.7;
  }
}

/**
 * 中号：横向柱状图
 * MM-DD | ████░░░░ | 11.1
 */
function addRecentBarsHorizontal(parent, recent, theme) {
  const maxK = Math.max(...recent.map((r) => n(r.kwh) || 0), 0.01);
  // 轨道总宽（pt），柱填充按比例
  const trackW = 120;
  const trackH = 8;

  const title = parent.addText("近五日用电");
  title.font = Font.systemFont(9);
  title.textColor = theme.text3;
  parent.addSpacer(3);

  for (const day of recent) {
    const kwh = n(day.kwh) || 0;
    const fillW = Math.max(3, Math.round((kwh / maxK) * trackW));

    const row = parent.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 6;

    const dateBox = row.addStack();
    dateBox.size = new Size(34, 12);
    dateBox.layoutHorizontally();
    const dt = dateBox.addText(fmtMD(day.date));
    dt.font = Font.systemFont(8);
    dt.textColor = theme.text3;
    dt.lineLimit = 1;
    dt.minimumScaleFactor = 0.75;

    // 轨道（固定宽）+ 左侧填充柱
    const track = row.addStack();
    track.layoutHorizontally();
    track.size = new Size(trackW, trackH);
    track.backgroundColor = theme.barTrack;
    track.cornerRadius = 3;

    const fill = track.addStack();
    fill.size = new Size(fillW, trackH);
    fill.backgroundColor = theme.bar;
    fill.cornerRadius = 3;

    const valBox = row.addStack();
    valBox.size = new Size(28, 12);
    valBox.layoutHorizontally();
    const vt = valBox.addText(fmt(kwh, 1));
    vt.font = Font.mediumSystemFont(8);
    vt.textColor = theme.text2;
    vt.lineLimit = 1;
    vt.rightAlignText();
    vt.minimumScaleFactor = 0.75;

    parent.addSpacer(3);
  }
}

function errorWidget(msg, theme, logo, bgDark) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);
  applyBackground(w, theme, bgDark);

  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(14);
  title.textColor = theme.text;
  head.addSpacer();
  if (logo) {
    const img = head.addImage(logo);
    img.imageSize = new Size(40, 40);
    img.cornerRadius = 8;
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
