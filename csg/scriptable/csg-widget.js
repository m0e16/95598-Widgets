// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
/**
 * 南方电网 · Scriptable 小组件 v1.5.0
 *
 * - 地址截到「XX路XX号」
 * - 大号纵向柱：电量/日期与柱同宽居中、底对齐
 * - 中号：左侧文字指标，右侧横向五日柱（避免超高裁切）
 * - 余额 ≤5 红色；深色底图；无「实时」角标
 *
 * 浏览器预览（无需贴 iOS）：打开同目录 preview.html
 */

const VERSION = "1.5.0";
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
    bg0: dyn("#E8F2FF", "#2C2C2E"),
    bg1: dyn("#F5F9FF", "#1C1C1E"),
    text: dyn("#0B1F3A", "#FFFFFF"),
    text2: dyn("#3D4F63", "#FFFFFF", 1, 0.82),
    text3: dyn("#7A8796", "#FFFFFF", 1, 0.55),
    bar: dyn("#1A6BB5", "#0A84FF"),
    barTrack: dyn("#0B5CAB", "#FFFFFF", 0.12, 0.14),
    danger: dyn("#D70015", "#FF453A"),
    error: dyn("#B85C00", "#FF9F0A"),
  };
}

// -------------------- Main --------------------

async function main() {
  const theme = getTheme();
  const [logo, bgDark] = await Promise.all([loadLogo(), loadDarkBg()]);

  let payload;
  try {
    payload = await fetchBill();
    await saveCache(payload);
  } catch (e) {
    const cached = loadCache();
    if (cached?.data) {
      payload = cached.data;
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

// -------------------- Storage --------------------

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

function fmtMD(dateStr) {
  const s = String(dateStr || "");
  if (s.length >= 10) return s.slice(5, 10);
  if (s.length >= 5) return s.slice(0, 5);
  return s || "--";
}

/**
 * 地址截到「XX路/街/道XX号」
 * 例：…青秀区长虹路10号万科城… → 长虹路10号
 */
function shortAddress(addr) {
  if (!addr) return "";
  const s = String(addr);
  const m = s.match(
    /([\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:路|街|道|巷|弄|大街)\d+号)/
  );
  if (m) return m[1];
  // 退路：仅门牌
  const m2 = s.match(/(\d+号)/);
  if (m2) {
    const i = s.indexOf(m2[1]);
    const head = s.slice(Math.max(0, i - 8), i + m2[1].length);
    const m3 = head.match(/([\u4e00-\u9fa5]{1,8}(?:路|街|道|巷)?\d+号)/);
    if (m3) return m3[1];
  }
  return s.length > 12 ? s.slice(0, 11) + "…" : s;
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
  const pad = isSmall ? 10 : isMedium ? 10 : 14;
  w.setPadding(pad, pad + 2, pad, pad + 2);
  applyBackground(w, theme, bgDark);

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const last = m.lastMonth || {};
  const year = m.year || {};
  const recent = (d.recent || []).slice(-5).filter((r) => n(r.kwh) != null);

  const arrears = n(b.arrears) || 0;
  const isArrears =
    item.arrearsOfFees || arrears > 0 || (n(b.balance) || 0) < 0;
  const balVal = isArrears && arrears > 0 ? arrears : n(b.balance);
  const isLowBal = balVal != null && balVal <= LOW_BALANCE;
  const addr = shortAddress(u.address || u.userName || u.accountNumber || "");

  addHeader(w, theme, logo);
  w.addSpacer(isMedium ? 4 : 6);

  if (isMedium) {
    // 中号：左文案 + 右横向柱，控制总高度
    buildMediumSplit(w, theme, {
      balVal,
      isArrears,
      isLowBal,
      m,
      d,
      last,
      year,
      recent,
      addr,
      meta,
    });
  } else {
    addBalanceRow(w, theme, balVal, isArrears, isLowBal);
    w.addSpacer(isSmall ? 4 : 6);

    if (isSmall) {
      buildSmallBody(w, theme, m, d);
    } else {
      buildLargeBody(w, theme, m, d, last, year);
    }

    if (SHOW_RECENT && isLarge && recent.length) {
      w.addSpacer(8);
      addRecentBarsVertical(w, recent, theme);
    }

    w.addSpacer(isSmall ? 4 : 6);
    addFooter(w, theme, addr, meta);
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
    const logoSize = isSmall ? 34 : isMedium ? 38 : 46;
    const img = head.addImage(logo);
    img.imageSize = new Size(logoSize, logoSize);
    img.cornerRadius = 8;
  }
}

function addBalanceRow(w, theme, balVal, isArrears, isLowBal) {
  const balStack = w.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();

  if (!isSmall) {
    const balLabel = balStack.addText(isArrears ? "欠费 " : "余额 ");
    balLabel.font = Font.systemFont(11);
    balLabel.textColor = theme.text3;
  }

  const bal = balStack.addText(fmtOr(balVal, 2));
  bal.font = Font.boldSystemFont(isSmall ? 22 : 26);
  bal.textColor = isArrears || isLowBal ? theme.danger : theme.text;

  const unit = balStack.addText(" 元");
  unit.font = Font.systemFont(12);
  unit.textColor = isLowBal || isArrears ? theme.danger : theme.text2;
}

function addFooter(w, theme, addr, meta) {
  const foot = w.addStack();
  foot.layoutHorizontally();
  foot.centerAlignContent();
  const f1 = foot.addText(addr || "南网户号");
  f1.font = Font.systemFont(9);
  f1.textColor = theme.text3;
  f1.lineLimit = 1;
  foot.addSpacer();
  if (meta.multi > 1) {
    const idx = foot.addText(`${meta.index + 1}/${meta.multi}`);
    idx.font = Font.systemFont(9);
    idx.textColor = theme.text3;
  }
}

/** 中号：左文字 / 右柱图 */
function buildMediumSplit(w, theme, ctx) {
  const body = w.addStack();
  body.layoutHorizontally();
  body.topAlignContent();
  body.spacing = 10;

  // —— 左：余额 + 指标 + 地址 ——
  const left = body.addStack();
  left.layoutVertically();
  left.spacing = 3;

  const balStack = left.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();
  const balLabel = balStack.addText(ctx.isArrears ? "欠费 " : "余额 ");
  balLabel.font = Font.systemFont(10);
  balLabel.textColor = theme.text3;
  const bal = balStack.addText(fmtOr(ctx.balVal, 2));
  bal.font = Font.boldSystemFont(22);
  bal.textColor =
    ctx.isArrears || ctx.isLowBal ? theme.danger : theme.text;
  const unit = balStack.addText(" 元");
  unit.font = Font.systemFont(11);
  unit.textColor =
    ctx.isLowBal || ctx.isArrears ? theme.danger : theme.text2;

  left.addSpacer(4);

  if (n(ctx.m.totalKwh) != null) {
    addLeftLine(left, "本月", `${fmt(ctx.m.totalKwh, 1)} kWh`, theme);
  }
  if (n(ctx.d.yesterday) != null) {
    const yl = ctx.d.latestDay ? fmtMD(ctx.d.latestDay) : "昨日";
    addLeftLine(left, yl, `${fmt(ctx.d.yesterday, 1)} kWh`, theme);
  }
  if (n(ctx.last.totalKwh) != null || n(ctx.last.totalCost) != null) {
    const bits = [];
    if (n(ctx.last.totalKwh) != null) bits.push(`${fmt(ctx.last.totalKwh, 0)}度`);
    if (n(ctx.last.totalCost) != null) bits.push(`${fmt(ctx.last.totalCost, 0)}元`);
    addLeftLine(left, "上月", bits.join(" "), theme);
  } else if (n(ctx.year.yearKwh) != null) {
    addLeftLine(left, "本年", `${fmt(ctx.year.yearKwh, 0)} kWh`, theme);
  }

  left.addSpacer(6);
  const addrT = left.addText(ctx.addr || "南网户号");
  addrT.font = Font.systemFont(9);
  addrT.textColor = theme.text3;
  addrT.lineLimit = 1;
  if (ctx.meta.multi > 1) {
    const idx = left.addText(`${ctx.meta.index + 1}/${ctx.meta.multi}`);
    idx.font = Font.systemFont(9);
    idx.textColor = theme.text3;
  }

  // —— 右：近五日横向柱（紧凑）——
  if (SHOW_RECENT && ctx.recent.length) {
    const right = body.addStack();
    right.layoutVertically();
    right.spacing = 0;
    addRecentBarsHorizontalCompact(right, ctx.recent, theme);
  }
}

function addLeftLine(parent, label, value, theme) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const l = row.addText(label + " ");
  l.font = Font.systemFont(10);
  l.textColor = theme.text3;
  const v = row.addText(value);
  v.font = Font.mediumSystemFont(11);
  v.textColor = theme.text;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.75;
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
      const col = row.addStack();
      col.layoutVertically();
      col.spacing = 2;
      const l = col.addText(label);
      l.font = Font.systemFont(10);
      l.textColor = theme.text3;
      l.lineLimit = 1;
      const v = col.addText(value);
      v.font = Font.mediumSystemFont(12);
      v.textColor = theme.text;
      v.lineLimit = 1;
      v.minimumScaleFactor = 0.7;
    }
  }
}

/**
 * 大号纵向柱：列宽固定 = 柱宽，文字 centerAlignText，柱区固定高度底对齐
 */
function addRecentBarsVertical(parent, recent, theme) {
  const maxK = Math.max(...recent.map((r) => n(r.kwh) || 0), 0.01);
  const barMaxH = 42;
  const colW = 40; // 列宽，与文字居中对齐
  const barW = 28;

  const title = parent.addText("近五日用电");
  title.font = Font.systemFont(9);
  title.textColor = theme.text3;
  parent.addSpacer(4);

  const row = parent.addStack();
  row.layoutHorizontally();
  row.spacing = 6;
  row.bottomAlignContent();
  row.centerAlignContent();

  for (const day of recent) {
    const kwh = n(day.kwh) || 0;
    const h = Math.max(4, Math.round((kwh / maxK) * barMaxH));

    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.spacing = 3;
    col.size = new Size(colW, 0);

    // 电量：固定宽容器 + 居中
    const top = col.addStack();
    top.layoutHorizontally();
    top.size = new Size(colW, 11);
    top.centerAlignContent();
    const vt = top.addText(fmt(kwh, 1));
    vt.font = Font.systemFont(8);
    vt.textColor = theme.text2;
    vt.lineLimit = 1;
    vt.centerAlignText();
    vt.minimumScaleFactor = 0.65;

    // 柱区固定高，底对齐
    const zone = col.addStack();
    zone.layoutVertically();
    zone.size = new Size(colW, barMaxH);
    zone.centerAlignContent();
    zone.bottomAlignContent();

    const gap = zone.addStack();
    gap.size = new Size(barW, Math.max(0, barMaxH - h));

    const barWrap = zone.addStack();
    barWrap.layoutHorizontally();
    barWrap.size = new Size(colW, h);
    barWrap.centerAlignContent();
    const bar = barWrap.addStack();
    bar.size = new Size(barW, h);
    bar.backgroundColor = theme.bar;
    bar.cornerRadius = 4;

    // 日期
    const bot = col.addStack();
    bot.layoutHorizontally();
    bot.size = new Size(colW, 11);
    bot.centerAlignContent();
    const dt = bot.addText(fmtMD(day.date));
    dt.font = Font.systemFont(8);
    dt.textColor = theme.text3;
    dt.lineLimit = 1;
    dt.centerAlignText();
    dt.minimumScaleFactor = 0.65;
  }
}

/** 中号右侧：紧凑横向柱 */
function addRecentBarsHorizontalCompact(parent, recent, theme) {
  const maxK = Math.max(...recent.map((r) => n(r.kwh) || 0), 0.01);
  const trackW = 72;
  const trackH = 6;

  const title = parent.addText("近五日");
  title.font = Font.systemFont(8);
  title.textColor = theme.text3;
  parent.addSpacer(3);

  for (const day of recent) {
    const kwh = n(day.kwh) || 0;
    const fillW = Math.max(3, Math.round((kwh / maxK) * trackW));

    const row = parent.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 4;

    const dateBox = row.addStack();
    dateBox.size = new Size(32, 10);
    const dt = dateBox.addText(fmtMD(day.date));
    dt.font = Font.systemFont(7);
    dt.textColor = theme.text3;
    dt.lineLimit = 1;
    dt.minimumScaleFactor = 0.7;

    const track = row.addStack();
    track.layoutHorizontally();
    track.size = new Size(trackW, trackH);
    track.backgroundColor = theme.barTrack;
    track.cornerRadius = 2;
    const fill = track.addStack();
    fill.size = new Size(fillW, trackH);
    fill.backgroundColor = theme.bar;
    fill.cornerRadius = 2;

    const valBox = row.addStack();
    valBox.size = new Size(22, 10);
    const vt = valBox.addText(fmt(kwh, 1));
    vt.font = Font.systemFont(7);
    vt.textColor = theme.text2;
    vt.lineLimit = 1;
    vt.rightAlignText();
    vt.minimumScaleFactor = 0.7;

    parent.addSpacer(2);
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
