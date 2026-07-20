// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
/**
 * 南方电网小组件 v1.5.4
 * Surge 模块 + Token 捕获 → api.csg-rewrite.com
 * Logo：csg-white.png 模板 + tintColor（品牌蓝 #0A2366 / 白）
 */

const VERSION = "1.5.4";
const DEFAULT_URL = "https://api.csg-rewrite.com/electricity/bill/all";
const ASSET_BASE =
  "https://raw.githubusercontent.com/m0e16/95598-Widgets/main/scriptable/assets";
const LOGO_URL = `${ASSET_BASE}/csg-white.png`;
const LOGO_BRAND = "#0A2366";
const BG_DARK = "#292929";
const LOGO_CACHE = "csg-logo-template.png";
const DATA_CACHE = "csg-widget-cache.json";
const LOW_BALANCE = 5;
const REQUEST_TIMEOUT = 110;
const DEFAULT_REFRESH_MIN = 60;

const family = config.widgetFamily || "medium";
const isSmall = family === "small";
const isLarge = family === "large";
const isMedium = !isSmall && !isLarge;

let params = {};
try {
  if (args.widgetParameter) {
    params =
      typeof args.widgetParameter === "string"
        ? JSON.parse(args.widgetParameter)
        : args.widgetParameter;
  }
} catch (_) {}

const API_URL = params.url || DEFAULT_URL;
const ACCOUNT_INDEX = Math.max(0, Number(params.index) || 0);
const SHOW_RECENT = params.showRecent !== false;
const REFRESH_MIN = Math.max(15, Number(params.refreshMinutes) || DEFAULT_REFRESH_MIN);

// ---------- theme ----------

function dyn(light, dark, la, da) {
  return Color.dynamic(
    new Color(light, la == null ? 1 : la),
    new Color(dark, da == null ? la == null ? 1 : la : da)
  );
}

function theme() {
  return {
    bg: dyn("#F0F5FC", BG_DARK),
    text: dyn("#0B1F3A", "#FFFFFF"),
    text2: dyn("#3D4F63", "#FFFFFF", 1, 0.82),
    text3: dyn("#7A8796", "#FFFFFF", 1, 0.55),
    bar: dyn("#1A6BB5", "#0A84FF"),
    barTrack: dyn("#0B5CAB", "#FFFFFF", 0.12, 0.14),
    logoTint: dyn(LOGO_BRAND, "#FFFFFF"),
    warn: dyn("#C93400", "#FF9F0A"),
    danger: dyn("#D70015", "#FF453A"),
    error: dyn("#B85C00", "#FF9F0A"),
  };
}

/** 余额色：≤0/欠费红 · (0,5]橙 · 其它正常 */
function balColor(t, v, arrears, unit) {
  if (arrears || (v != null && v <= 0)) return t.danger;
  if (v != null && v <= LOW_BALANCE) return t.warn;
  return unit ? t.text2 : t.text;
}

// ---------- data ----------

function num(v) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmt(v, d = 2) {
  const x = num(v);
  return x == null ? null : x.toFixed(d);
}

function fmtOr(v, d = 2) {
  return fmt(v, d) ?? "--";
}

function fmtMD(s) {
  s = String(s || "");
  return s.length >= 10 ? s.slice(5, 10) : s || "--";
}

/** 广西壮族自治区→广西，截到首个 …路/街XX号 */
function shortAddress(addr) {
  if (!addr) return "";
  let s = String(addr).trim().replace(/^广西壮族自治区/, "广西");
  const m =
    s.match(/^(.*?(?:路|街|道|巷|弄|大街)\d+号)/) || s.match(/^(.*?\d+号)/);
  let out = m ? m[1] : s;
  const lim = isSmall ? 16 : isMedium ? 20 : 24;
  return out.length > lim ? out.slice(0, lim - 1) + "…" : out;
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

/** 补全上月（年账单）、昨日/近五日（日明细） */
function enrich(item) {
  const m = item.monthElecQuantity || {};
  const year = m.year || {};
  const last = { ...(m.lastMonth || {}) };
  const d = { ...(item.dayElecQuantity || {}) };
  const byDay = item.dayElecQuantity31?.byDay || d.recent || [];

  if (last.totalKwh == null && last.totalCost == null && year.byMonth?.length) {
    const p = new Date();
    p.setDate(1);
    p.setMonth(p.getMonth() - 1);
    const key = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
    const hit = year.byMonth.find(
      (x) => String(x.month || "").replace("/", "-").slice(0, 7) === key
    );
    if (hit) {
      last.totalKwh = hit.kwh;
      last.totalCost = hit.charge;
    }
  }

  if (d.yesterday == null && byDay.length) {
    const row = byDay[byDay.length - 1];
    if (row && num(row.kwh) != null) {
      d.yesterday = row.kwh;
      d.latestDay = row.date;
    }
  }
  if (!d.recent?.length && byDay.length) d.recent = byDay.slice(-5);

  return {
    ...item,
    monthElecQuantity: { ...m, lastMonth: last, year },
    dayElecQuantity: d,
  };
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

// ---------- cache / logo ----------

function fm() {
  return FileManager.local();
}

function dataCachePath() {
  return fm().joinPath(fm().documentsDirectory(), DATA_CACHE);
}

function saveCache(data) {
  try {
    fm().writeString(
      dataCachePath(),
      JSON.stringify({ ts: Date.now(), data, version: VERSION })
    );
  } catch (_) {}
}

function loadCache() {
  try {
    const p = dataCachePath();
    if (!fm().fileExists(p)) return null;
    const j = JSON.parse(fm().readString(p));
    return j?.data ? j : null;
  } catch (_) {
    return null;
  }
}

async function loadLogo() {
  const f = fm();
  const p = f.joinPath(f.documentsDirectory(), LOGO_CACHE);
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

function addLogo(parent, logo, t, size) {
  if (!logo) return;
  const img = parent.addImage(logo);
  img.imageSize = new Size(size, size);
  img.cornerRadius = Math.round(size * 0.2);
  img.tintColor = t.logoTint;
}

// ---------- present ----------

function setRefresh(w) {
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
}

async function present(w) {
  if (config.runsInWidget) Script.setWidget(w);
  else if (isSmall) await w.presentSmall();
  else if (isLarge) await w.presentLarge();
  else await w.presentMedium();
  Script.complete();
}

function setRunUrl(w) {
  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}
}

// ---------- UI ----------

function addHeader(w, t, logo) {
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(isSmall ? 13 : isMedium ? 16 : 17);
  title.textColor = t.text;
  head.addSpacer();
  addLogo(head, logo, t, isSmall ? 34 : isMedium ? 38 : 46);
}

function addBalance(parent, t, balVal, arrears, compact) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  if (!isSmall || compact) {
    const lab = row.addText(arrears ? "欠费 " : "余额 ");
    lab.font = Font.systemFont(compact ? 10 : 11);
    lab.textColor = t.text3;
  }
  const n = row.addText(fmtOr(balVal, 2));
  n.font = Font.boldSystemFont(compact ? 22 : isSmall ? 22 : 26);
  n.textColor = balColor(t, balVal, arrears, false);
  const u = row.addText(" 元");
  u.font = Font.systemFont(compact ? 11 : 12);
  u.textColor = balColor(t, balVal, arrears, true);
}

function addFooter(w, t, addr, meta) {
  const foot = w.addStack();
  foot.layoutHorizontally();
  foot.centerAlignContent();
  if (isMedium) {
    const pad = foot.addStack();
    pad.size = new Size(6, 1);
  }
  const a = foot.addText(addr || "南网户号");
  a.font = Font.systemFont(9);
  a.textColor = t.text3;
  a.lineLimit = 1;
  a.minimumScaleFactor = 0.8;
  foot.addSpacer();
  if (meta.multi > 1) {
    const i = foot.addText(`${meta.index + 1}/${meta.multi}`);
    i.font = Font.systemFont(9);
    i.textColor = t.text3;
  }
}

function addLeftLine(parent, label, value, t) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const l = row.addText(label + " ");
  l.font = Font.systemFont(10);
  l.textColor = t.text3;
  const v = row.addText(value);
  v.font = Font.mediumSystemFont(11);
  v.textColor = t.text;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.75;
}

/** 中号：左指标 + 右横向柱 */
function buildMedium(w, t, ctx) {
  const body = w.addStack();
  body.layoutHorizontally();
  body.bottomAlignContent();

  const left = body.addStack();
  left.layoutVertically();
  left.spacing = 3;
  addBalance(left, t, ctx.balVal, ctx.arrears, true);
  left.addSpacer(4);

  const { m, d, last, year } = ctx;
  if (num(m.totalKwh) != null) {
    addLeftLine(left, "本月", `${fmt(m.totalKwh, 1)} kWh`, t);
  }
  if (num(d.yesterday) != null) {
    addLeftLine(
      left,
      d.latestDay ? fmtMD(d.latestDay) : "昨日",
      `${fmt(d.yesterday, 1)} kWh`,
      t
    );
  }
  if (num(last.totalKwh) != null || num(last.totalCost) != null) {
    const bits = [];
    if (num(last.totalKwh) != null) bits.push(`${fmt(last.totalKwh, 0)} kWh`);
    if (num(last.totalCost) != null) bits.push(`${fmt(last.totalCost, 0)} 元`);
    addLeftLine(left, "上月", bits.join(" "), t);
  } else if (num(year.yearKwh) != null) {
    addLeftLine(left, "本年", `${fmt(year.yearKwh, 0)} kWh`, t);
  }

  body.addSpacer();

  if (SHOW_RECENT && ctx.recent.length) {
    const right = body.addStack();
    right.layoutVertically();
    barsHorizontal(right, ctx.recent, t);
  }

  w.addSpacer(6);
  addFooter(w, t, ctx.addr, ctx.meta);
}

function buildSmall(w, t, m, d) {
  const parts = [];
  if (num(m.totalKwh) != null) parts.push(`${fmt(m.totalKwh, 1)} kWh`);
  if (num(m.totalCost) != null) parts.push(`${fmt(m.totalCost, 2)} 元`);
  if (parts.length) {
    const line = w.addText(`本月 ${parts.join(" · ")}`);
    line.font = Font.systemFont(11);
    line.textColor = t.text2;
    line.lineLimit = 1;
    line.minimumScaleFactor = 0.8;
  }
  if (num(d.yesterday) != null) {
    const y = w.addText(
      `${d.latestDay ? fmtMD(d.latestDay) : "近"} ${fmt(d.yesterday, 1)} kWh`
    );
    y.font = Font.systemFont(10);
    y.textColor = t.text3;
    y.lineLimit = 1;
  }
}

function buildLarge(w, t, m, d, last, year) {
  const metrics = [];
  if (num(m.totalKwh) != null)
    metrics.push(["本月电量", `${fmt(m.totalKwh, 1)} kWh`]);
  if (num(m.totalCost) != null)
    metrics.push(["本月电费", `${fmt(m.totalCost, 2)} 元`]);
  if (num(d.yesterday) != null) {
    metrics.push([
      d.latestDay ? fmtMD(d.latestDay) : "昨日",
      `${fmt(d.yesterday, 1)} kWh`,
    ]);
  }
  if (num(last.totalKwh) != null || num(last.totalCost) != null) {
    const bits = [];
    if (num(last.totalKwh) != null) bits.push(`${fmt(last.totalKwh, 0)} kWh`);
    if (num(last.totalCost) != null) bits.push(`${fmt(last.totalCost, 2)} 元`);
    metrics.push(["上月", bits.join(" / ")]);
  }
  if (num(year.yearKwh) != null)
    metrics.push(["本年电量", `${fmt(year.yearKwh, 0)} kWh`]);
  if (num(year.yearCost) != null)
    metrics.push(["本年电费", `${fmt(year.yearCost, 2)} 元`]);

  for (let i = 0; i < metrics.length; i += 3) {
    if (i) w.addSpacer(6);
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 8;
    for (const [lab, val] of metrics.slice(i, i + 3)) {
      const col = row.addStack();
      col.layoutVertically();
      col.spacing = 2;
      const l = col.addText(lab);
      l.font = Font.systemFont(10);
      l.textColor = t.text3;
      l.lineLimit = 1;
      const v = col.addText(val);
      v.font = Font.mediumSystemFont(12);
      v.textColor = t.text;
      v.lineLimit = 1;
      v.minimumScaleFactor = 0.7;
    }
  }
}

/** 大号竖柱 */
function barsVertical(parent, recent, t) {
  const maxK = Math.max(...recent.map((r) => num(r.kwh) || 0), 0.01);
  const barMaxH = 42;
  const colW = 40;
  const barW = 28;

  const title = parent.addText("近五日用电");
  title.font = Font.systemFont(9);
  title.textColor = t.text3;
  parent.addSpacer(4);

  const row = parent.addStack();
  row.layoutHorizontally();
  row.spacing = 6;
  row.bottomAlignContent();
  row.centerAlignContent();

  for (const day of recent) {
    const kwh = num(day.kwh) || 0;
    const h = Math.max(4, Math.round((kwh / maxK) * barMaxH));

    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.spacing = 3;
    col.size = new Size(colW, 0);

    const top = col.addStack();
    top.layoutHorizontally();
    top.size = new Size(colW, 11);
    top.centerAlignContent();
    const vt = top.addText(fmt(kwh, 1));
    vt.font = Font.systemFont(8);
    vt.textColor = t.text2;
    vt.centerAlignText();
    vt.minimumScaleFactor = 0.65;

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
    bar.backgroundColor = t.bar;
    bar.cornerRadius = 4;

    const bot = col.addStack();
    bot.layoutHorizontally();
    bot.size = new Size(colW, 11);
    bot.centerAlignContent();
    const dt = bot.addText(fmtMD(day.date));
    dt.font = Font.systemFont(8);
    dt.textColor = t.text3;
    dt.centerAlignText();
    dt.minimumScaleFactor = 0.65;
  }
}

/** 中号横柱（fill 从左长出） */
function barsHorizontal(parent, recent, t) {
  const maxK = Math.max(...recent.map((r) => num(r.kwh) || 0), 0.01);
  const trackW = 88;
  const trackH = 6;

  const title = parent.addText("近五日");
  title.font = Font.systemFont(8);
  title.textColor = t.text3;
  parent.addSpacer(3);

  for (const day of recent) {
    const kwh = num(day.kwh) || 0;
    const fillW = Math.max(3, Math.round((kwh / maxK) * trackW));
    const restW = Math.max(0, trackW - fillW);

    const row = parent.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 4;

    const dateBox = row.addStack();
    dateBox.size = new Size(32, 10);
    const dt = dateBox.addText(fmtMD(day.date));
    dt.font = Font.systemFont(7);
    dt.textColor = t.text3;
    dt.minimumScaleFactor = 0.7;

    const track = row.addStack();
    track.layoutHorizontally();
    track.size = new Size(trackW, trackH);
    track.backgroundColor = t.barTrack;
    track.cornerRadius = 2;
    const fill = track.addStack();
    fill.size = new Size(fillW, trackH);
    fill.backgroundColor = t.bar;
    fill.cornerRadius = 2;
    if (restW > 0) {
      const rest = track.addStack();
      rest.size = new Size(restW, trackH);
    }

    const valBox = row.addStack();
    valBox.size = new Size(22, 10);
    const vt = valBox.addText(fmt(kwh, 1));
    vt.font = Font.systemFont(7);
    vt.textColor = t.text2;
    vt.rightAlignText();
    vt.minimumScaleFactor = 0.7;

    parent.addSpacer(2);
  }
}

function errorWidget(msg, t, logo) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);
  w.backgroundColor = t.bg;
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(14);
  title.textColor = t.text;
  head.addSpacer();
  addLogo(head, logo, t, 40);
  w.addSpacer(8);
  const b = w.addText(msg);
  b.font = Font.systemFont(12);
  b.textColor = t.error;
  b.lineLimit = 8;
  w.addSpacer(6);
  const tip = w.addText("Surge · 模块 · App 捕获 Token");
  tip.font = Font.systemFont(10);
  tip.textColor = t.text3;
  setRunUrl(w);
  return w;
}

function buildWidget(item, t, logo, meta) {
  const w = new ListWidget();
  const pad = isLarge ? 14 : 10;
  w.setPadding(pad, pad + 2, pad, pad + 2);
  w.backgroundColor = t.bg;

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const last = m.lastMonth || {};
  const year = m.year || {};
  const recent = (d.recent || []).slice(-5).filter((r) => num(r.kwh) != null);

  const arrearsAmt = num(b.arrears) || 0;
  const arrears =
    item.arrearsOfFees || arrearsAmt > 0 || (num(b.balance) || 0) < 0;
  const balVal = arrears && arrearsAmt > 0 ? arrearsAmt : num(b.balance);
  const addr = shortAddress(u.address || u.userName || u.accountNumber || "");

  addHeader(w, t, logo);
  w.addSpacer(isMedium ? 4 : 6);

  if (isMedium) {
    buildMedium(w, t, { balVal, arrears, m, d, last, year, recent, addr, meta });
  } else {
    addBalance(w, t, balVal, arrears, false);
    w.addSpacer(isSmall ? 4 : 6);
    if (isSmall) buildSmall(w, t, m, d);
    else {
      buildLarge(w, t, m, d, last, year);
      if (SHOW_RECENT && recent.length) {
        w.addSpacer(8);
        barsVertical(w, recent, t);
      }
    }
    w.addSpacer(isSmall ? 4 : 6);
    addFooter(w, t, addr, meta);
  }

  setRunUrl(w);
  return w;
}

// ---------- main ----------

async function main() {
  const t = theme();
  const logo = await loadLogo();

  let payload;
  try {
    payload = await fetchBill();
    saveCache(payload);
  } catch (e) {
    const cached = loadCache();
    if (cached?.data) payload = cached.data;
    else {
      const w = errorWidget(friendlyError(e), t, logo);
      setRefresh(w);
      await present(w);
      return;
    }
  }

  const list = normalizeList(payload);
  if (!list.length) {
    const w = errorWidget(
      "无户号数据。请打开「南网在线」进入电费页捕获 Token。",
      t,
      logo
    );
    setRefresh(w);
    await present(w);
    return;
  }

  const index = Math.min(ACCOUNT_INDEX, list.length - 1);
  const w = buildWidget(enrich(list[index]), t, logo, {
    multi: list.length,
    index,
  });
  setRefresh(w);
  await present(w);
}

await main();
