// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
/**
 * 南方电网 · Scriptable 小组件
 * 配套仓库: m0e16/95598-Widgets · 模块「南方电网」(仅小组件接口)
 *
 * 依赖：
 * 1. Surge 已安装并启用模块
 *    https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/profiles/csg.surge.sgmodule
 * 2. MitM / 脚本开启，证书已信任
 * 3. 打开「南网在线」App 进入电费页，自动捕获 Token
 *
 * 小组件参数（可选 JSON）：
 * {
 *   "url": "https://api.csg-rewrite.com/electricity/bill/all",
 *   "index": 0,
 *   "showRecent": true,
 *   "refreshMinutes": 60
 * }
 */

const VERSION = "1.3.0";
const DEFAULT_URL = "https://api.csg-rewrite.com/electricity/bill/all";
const LOGO_URL =
  "https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/scriptable/assets/csg.png";
const CACHE_FILE = "csg-widget-cache.json";
const LOGO_CACHE = "csg-logo.png";
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 110;
const DEFAULT_REFRESH_MINUTES = 60;

const widgetFamily = config.widgetFamily || "medium";
const isSmall = widgetFamily === "small";
const isLarge = widgetFamily === "large";

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

// -------------------- Theme (light / dark) --------------------

function getTheme() {
  const dark =
    typeof Device !== "undefined" && Device.isUsingDarkAppearance
      ? Device.isUsingDarkAppearance()
      : true;

  if (dark) {
    return {
      dark: true,
      bg0: new Color("#0A2748"),
      bg1: new Color("#123A66"),
      text: Color.white(),
      text2: new Color("#FFFFFF", 0.78),
      text3: new Color("#FFFFFF", 0.55),
      accent: new Color("#5AC8FA"),
      bar: new Color("#0A84FF"),
      barTrack: new Color("#FFFFFF", 0.12),
      warn: new Color("#FFD60A"),
      error: new Color("#FF9F0A"),
      errorBg: new Color("#2C2C2E"),
    };
  }
  return {
    dark: false,
    bg0: new Color("#EAF3FF"),
    bg1: new Color("#F7FAFF"),
    text: new Color("#0B1F3A"),
    text2: new Color("#3D4F63"),
    text3: new Color("#7A8796"),
    accent: new Color("#0B5CAB"),
    bar: new Color("#1A6BB5"),
    barTrack: new Color("#0B5CAB", 0.1),
    warn: new Color("#C93400"),
    error: new Color("#B85C00"),
    errorBg: new Color("#F2F2F7"),
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
      "无户号数据。请打开「南网在线」进入电费页捕获 Token，并确认 Surge 模块已启用。",
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

/** 用年账单 / 日明细补全上月、昨日等空字段（仅展示层） */
function enrichItem(item) {
  const m = item.monthElecQuantity || {};
  const year = m.year || {};
  const last = m.lastMonth || {};
  const d = item.dayElecQuantity || {};
  const byDay = item.dayElecQuantity31?.byDay || d.recent || [];

  // 上月：接口 null 时用 year.byMonth 上一自然月
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
      last._fromYear = true;
    }
  }

  // 昨日：接口 null 时用 byDay 最近一条
  let latestDay = null;
  if (d.yesterday == null && byDay.length) {
    const lastRow = byDay[byDay.length - 1];
    if (lastRow && n(lastRow.kwh) != null) {
      d.yesterday = lastRow.kwh;
      latestDay = lastRow.date;
    }
  }

  // recent 优先 dayElecQuantity.recent，否则 byDay 末 5 天
  let recent = d.recent;
  if (!recent?.length && byDay.length) {
    recent = byDay.slice(-5);
  }

  return {
    ...item,
    monthElecQuantity: { ...m, lastMonth: last, year },
    dayElecQuantity: { ...d, recent, latestDay },
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
      e.message ||
        "请求失败。请保持 Surge 开启，并确认模块 MitM 含 api.csg-rewrite.com"
    );
  }
  if (json && json.error) {
    throw new Error(json.message || "接口返回错误（可能 Token 已失效）");
  }
  if (!Array.isArray(json) && !Array.isArray(json?.data)) {
    throw new Error("返回格式异常。请更新 Surge 模块并重新捕获 Token");
  }
  return json;
}

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (/登录态|Token|失效|未登录|尚无登录/i.test(msg)) {
    return `${msg}\n\n请打开「南网在线」→ 电费/用电页面，重新捕获 Token。`;
  }
  if (/timed?\s*out|超时|The request timed out/i.test(msg)) {
    return "请求超时。南网接口较慢，可把模块 TIMEOUT 调到 120。";
  }
  if (/Could not connect|网络|NSURLError|offline/i.test(msg)) {
    return "无法连接。请确认 Surge VPN 已开启，模块与 MitM 已启用。";
  }
  return msg;
}

// -------------------- Storage / logo --------------------

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
    if (!j?.data) return null;
    return j;
  } catch (_) {
    return null;
  }
}

async function loadLogo() {
  const f = fmLocal();
  const p = logoCachePath();
  try {
    if (f.fileExists(p)) {
      return f.readImage(p);
    }
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

// -------------------- Format helpers --------------------

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmt(v, d = 2) {
  const x = n(v);
  if (x === null) return null;
  return x.toFixed(d);
}

function fmtOr(v, d, fallback = "") {
  const s = fmt(v, d);
  return s == null ? fallback : s;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 缩短地址：去掉省名，尽量保留市/区 */
function shortAddress(addr, maxLen) {
  if (!addr) return "";
  let s = String(addr)
    .replace(/^(.{2,3}壮族自治区|.{2,3}维吾尔自治区|.{2,3}回族自治区|.{2,3}自治区|.{2,3}省|.{2,3}市)/, "")
    .replace(/^广西/, "");
  // 若仍以「南宁市」等开头保留
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

function setRefresh(w) {
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
}

async function present(w) {
  if (config.runsInWidget) {
    Script.setWidget(w);
  } else if (isSmall) {
    await w.presentSmall();
  } else if (isLarge) {
    await w.presentLarge();
  } else {
    await w.presentMedium();
  }
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
  w.setPadding(12, 14, 12, 14);
  applyBackground(w, theme);

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const s = item.stepElecQuantity || {};
  const last = m.lastMonth || {};
  const year = m.year || {};
  const arrears = n(b.arrears) || 0;
  const isArrears =
    item.arrearsOfFees || arrears > 0 || (n(b.balance) || 0) < 0;

  // —— Header: 标题 + 状态 | Logo ——
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();

  const headLeft = head.addStack();
  headLeft.layoutVertically();
  headLeft.spacing = 2;

  const title = headLeft.addText("南方电网");
  title.font = Font.boldSystemFont(13);
  title.textColor = theme.text;

  let badgeText = meta.fromCache ? "缓存" : "实时";
  if (meta.fromCache && meta.cacheTs) {
    badgeText = `缓存 ${fmtTime(meta.cacheTs)}`;
  }
  const badge = headLeft.addText(badgeText);
  badge.font = Font.systemFont(10);
  badge.textColor = theme.text3;

  head.addSpacer();

  if (logo) {
    const logoSize = isSmall ? 28 : 36;
    const img = head.addImage(logo);
    img.imageSize = new Size(logoSize, logoSize);
    img.cornerRadius = 6;
    // 白底 logo 在深色下更清晰：不强制 tint
  }

  w.addSpacer(8);

  // —— Balance ——
  const balLabel = w.addText(isArrears ? "账户欠费" : "账户余额");
  balLabel.font = Font.systemFont(11);
  balLabel.textColor = theme.text2;

  const balStack = w.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();
  const balVal = isArrears && arrears > 0 ? arrears : b.balance;
  const bal = balStack.addText(fmtOr(balVal, 2, "--"));
  bal.font = Font.boldSystemFont(isSmall ? 24 : 30);
  bal.textColor = isArrears ? theme.warn : theme.text;
  const unit = balStack.addText(" 元");
  unit.font = Font.systemFont(13);
  unit.textColor = theme.text2;

  w.addSpacer(8);

  // —— Metrics（跳过空值）——
  if (isSmall) {
    const parts = [];
    if (n(m.totalKwh) != null) parts.push(`${fmt(m.totalKwh, 1)} kWh`);
    if (n(m.totalCost) != null) parts.push(`${fmt(m.totalCost, 2)} 元`);
    if (parts.length) {
      const line = w.addText(`本月 ${parts.join(" · ")}`);
      line.font = Font.systemFont(11);
      line.textColor = theme.text2;
      line.lineLimit = 1;
    }
    if (n(d.yesterday) != null) {
      const label = d.latestDay
        ? `${String(d.latestDay).slice(5)} `
        : "昨日 ";
      const y = w.addText(`${label}${fmt(d.yesterday, 1)} kWh`);
      y.font = Font.systemFont(10);
      y.textColor = theme.text3;
    }
  } else {
    const metrics = [];
    if (n(m.totalKwh) != null)
      metrics.push(["本月电量", `${fmt(m.totalKwh, 1)} kWh`]);
    if (n(m.totalCost) != null)
      metrics.push(["本月电费", `${fmt(m.totalCost, 2)} 元`]);
    if (n(d.yesterday) != null) {
      const yl = d.latestDay ? String(d.latestDay).slice(5) : "昨日";
      metrics.push([yl, `${fmt(d.yesterday, 1)} kWh`]);
    } else if (n(s.ladder) != null) {
      metrics.push(["阶梯", `第${s.ladder}档`]);
    }
    if (n(last.totalKwh) != null || n(last.totalCost) != null) {
      const bits = [];
      if (n(last.totalKwh) != null) bits.push(`${fmt(last.totalKwh, 0)} kWh`);
      if (n(last.totalCost) != null) bits.push(`${fmt(last.totalCost, 2)} 元`);
      metrics.push(["上月", bits.join(" / ")]);
    }
    if (isLarge) {
      if (n(year.yearKwh) != null)
        metrics.push(["本年电量", `${fmt(year.yearKwh, 0)} kWh`]);
      if (n(year.yearCost) != null)
        metrics.push(["本年电费", `${fmt(year.yearCost, 2)} 元`]);
    } else if (
      n(year.yearKwh) != null &&
      metrics.filter((x) => x[0] === "上月").length === 0
    ) {
      metrics.push(["本年", `${fmt(year.yearKwh, 0)} kWh`]);
    } else if (n(year.yearKwh) != null && metrics.length < 4) {
      metrics.push(["本年", `${fmt(year.yearKwh, 0)} kWh`]);
    }

    if (metrics.length) {
      addMetricRows(w, metrics, theme, isLarge ? 3 : 3);
    }
  }

  // —— 近五日：柱状图 ——
  const recent = (d.recent || []).slice(-5).filter((r) => n(r.kwh) != null);
  if (SHOW_RECENT && !isSmall && recent.length) {
    w.addSpacer(10);
    const sub = w.addText("近五日用电");
    sub.font = Font.systemFont(10);
    sub.textColor = theme.text3;
    w.addSpacer(4);
    addRecentBars(w, recent, theme);
  }

  w.addSpacer(8);

  // —— Footer ——
  const foot = w.addStack();
  foot.layoutHorizontally();
  foot.centerAlignContent();
  const addr = shortAddress(
    u.address || u.userName || u.accountNumber || "",
    isSmall ? 14 : 22
  );
  const f1 = foot.addText(addr || "南网户号");
  f1.font = Font.systemFont(10);
  f1.textColor = theme.text3;
  f1.lineLimit = 1;
  foot.addSpacer();
  if (meta.multi > 1) {
    const idx = foot.addText(`${meta.index + 1}/${meta.multi}`);
    idx.font = Font.systemFont(10);
    idx.textColor = theme.text3;
  }

  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}

  return w;
}

function addMetricRows(w, metrics, theme, perRow) {
  for (let i = 0; i < metrics.length; i += perRow) {
    if (i > 0) w.addSpacer(6);
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 8;
    const slice = metrics.slice(i, i + perRow);
    for (const [label, value] of slice) {
      addMetric(row, label, value, theme);
    }
    // 不足 perRow 时占位，避免拉伸怪异
    for (let k = slice.length; k < perRow; k++) {
      const sp = row.addStack();
      sp.layoutVertically();
    }
  }
}

function addMetric(parent, label, value, theme) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = 2;
  // 均分宽度
  try {
    col.layoutHorizontally;
  } catch (_) {}
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

/**
 * 近五日柱状图：上数值、中柱高（底对齐）、下日期 MM-DD
 */
function addRecentBars(parent, recent, theme) {
  const maxK = Math.max(...recent.map((r) => n(r.kwh) || 0), 0.01);
  const barMaxH = isLarge ? 52 : 34;
  const barW = isLarge ? 34 : 26;

  const row = parent.addStack();
  row.layoutHorizontally();
  row.spacing = isLarge ? 12 : 8;
  row.bottomAlignContent();

  for (const day of recent) {
    const kwh = n(day.kwh) || 0;
    const h = Math.max(6, Math.round((kwh / maxK) * barMaxH));

    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.spacing = 3;

    const vt = col.addText(fmt(kwh, 1));
    vt.font = Font.mediumSystemFont(9);
    vt.textColor = theme.text2;
    vt.lineLimit = 1;
    vt.centerAlignText();

    // 固定高度容器：上方空白 + 柱体，底对齐更直观
    const shell = col.addStack();
    shell.layoutVertically();
    shell.size = new Size(barW, barMaxH);
    shell.cornerRadius = 5;
    shell.backgroundColor = theme.barTrack;

    const inner = shell.addStack();
    inner.layoutVertically();
    inner.size = new Size(barW, barMaxH);
    inner.bottomAlignContent();

    const gap = inner.addStack();
    gap.size = new Size(barW, Math.max(0, barMaxH - h));
    gap.backgroundColor = new Color("#000000", 0);

    const bar = inner.addStack();
    bar.size = new Size(barW, h);
    bar.backgroundColor = theme.bar;
    bar.cornerRadius = 5;

    const md = String(day.date || "").slice(5); // MM-DD
    const dt = col.addText(md || "--");
    dt.font = Font.systemFont(9);
    dt.textColor = theme.text3;
    dt.lineLimit = 1;
    dt.centerAlignText();
  }
}

function errorWidget(msg, theme, logo) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);
  if (theme) {
    applyBackground(w, theme);
  } else {
    w.backgroundColor = new Color("#3A3A3C");
  }
  const t = getTheme();

  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(14);
  title.textColor = t.text;
  head.addSpacer();
  if (logo) {
    const img = head.addImage(logo);
    img.imageSize = new Size(28, 28);
    img.cornerRadius = 6;
  }

  w.addSpacer(8);
  const b = w.addText(msg);
  b.font = Font.systemFont(12);
  b.textColor = t.error;
  b.lineLimit = 8;
  b.minimumScaleFactor = 0.85;
  w.addSpacer(6);
  const tip = w.addText("Surge 开启 · 模块启用 · App 捕获 Token");
  tip.font = Font.systemFont(10);
  tip.textColor = t.text3;
  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}
  return w;
}

await main();
