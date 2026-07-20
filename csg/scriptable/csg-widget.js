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
 * 3. 打开「南网在线」App 进入电费页，自动捕获 Token（无短信/密码）
 *
 * 小组件参数（长按 → 编辑小组件 → Parameter，可选 JSON）：
 * {
 *   "url": "https://api.csg-rewrite.com/electricity/bill/all",
 *   "index": 0,
 *   "showRecent": true,
 *   "refreshMinutes": 60
 * }
 *
 * - index: 多户号时选第几个（从 0 开始；接口固定返回全部户号）
 * - showRecent: 中/大尺寸是否显示近五日
 * - refreshMinutes: 提示 iOS 下次刷新间隔（仅建议，系统不保证）
 */

const VERSION = "1.2.0";
const DEFAULT_URL = "https://api.csg-rewrite.com/electricity/bill/all";
const CACHE_FILE = "csg-widget-cache.json";
/** 请求失败时，缓存最长可用时间 */
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** 与模块 TIMEOUT 对齐，略留余量 */
const REQUEST_TIMEOUT = 110;
const DEFAULT_REFRESH_MINUTES = 60;

const widgetFamily = config.widgetFamily || "medium";

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

async function main() {
  let payload;
  let fromCache = false;
  let cacheTs = null;
  let fetchError = null;

  try {
    payload = await fetchBill();
    await saveCache(payload);
    cacheTs = Date.now();
  } catch (e) {
    fetchError = e;
    const cached = loadCache();
    if (cached?.data) {
      payload = cached.data;
      fromCache = true;
      cacheTs = cached.ts || null;
    } else {
      const w = errorWidget(friendlyError(e));
      setRefresh(w);
      await present(w);
      return;
    }
  }

  const list = normalizeList(payload);
  if (!list.length) {
    const w = errorWidget(
      "无户号数据。请确认已打开「南网在线」进入电费页捕获 Token，且 Surge 模块已启用。"
    );
    setRefresh(w);
    await present(w);
    return;
  }

  const index = Math.min(ACCOUNT_INDEX, list.length - 1);
  const item = list[index];
  const w = buildWidget(item, {
    fromCache,
    cacheTs,
    multi: list.length,
    index,
    fetchError,
  });
  setRefresh(w);
  await present(w);
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
    // 非 JSON / 网络失败
    throw new Error(
      e.message ||
        "请求失败。请保持 Surge 开启，并确认模块 MitM 含 api.csg-rewrite.com"
    );
  }

  if (json && json.error) {
    throw new Error(json.message || "接口返回错误（可能 Token 已失效）");
  }
  if (!Array.isArray(json) && !Array.isArray(json?.data)) {
    throw new Error("返回格式异常。请更新 Surge 模块到最新版并重新捕获 Token");
  }
  return json;
}

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (/登录态|Token|失效|未登录|尚无登录/i.test(msg)) {
    return `${msg}\n\n请打开「南网在线」→ 电费/用电页面，重新捕获 Token。`;
  }
  if (/timed?\s*out|超时|The request timed out/i.test(msg)) {
    return "请求超时。南网接口较慢，可把模块 TIMEOUT 调到 120，并确认网络稳定。";
  }
  if (/Could not connect|网络|NSURLError|offline/i.test(msg)) {
    return "无法连接。请确认 Surge VPN 已开启，模块与 MitM 已启用。";
  }
  return msg;
}

function fm() {
  return FileManager.local();
}

function cachePath() {
  return fm().joinPath(fm().documentsDirectory(), CACHE_FILE);
}

async function saveCache(data) {
  try {
    fm().writeString(
      cachePath(),
      JSON.stringify({ ts: Date.now(), data, version: VERSION })
    );
  } catch (_) {}
}

function loadCache() {
  try {
    const p = cachePath();
    if (!fm().fileExists(p)) return null;
    const j = JSON.parse(fm().readString(p));
    if (!j?.data) return null;
    if (j.ts && Date.now() - j.ts > CACHE_MAX_AGE_MS) {
      // 过旧仍返回，UI 标「缓存」；调用方已知 fromCache
    }
    return j;
  } catch (_) {
    return null;
  }
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmt(v, d = 2) {
  const x = n(v);
  if (x === null) return "--";
  return x.toFixed(d);
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function setRefresh(w) {
  // 仅建议系统；实际由 iOS 决定
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
}

async function present(w) {
  if (config.runsInWidget) {
    Script.setWidget(w);
  } else if (widgetFamily === "small") {
    await w.presentSmall();
  } else if (widgetFamily === "large") {
    await w.presentLarge();
  } else {
    await w.presentMedium();
  }
  Script.complete();
}

function buildWidget(item, meta) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);

  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [new Color("#0B3D91"), new Color("#1A6BB5")];
  w.backgroundGradient = g;

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const s = item.stepElecQuantity || {};
  const last = m.lastMonth || {};
  const year = m.year || {};
  const arrears = n(b.arrears) || 0;
  const isArrears = item.arrearsOfFees || arrears > 0 || (n(b.balance) || 0) < 0;

  // Header
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(13);
  title.textColor = Color.white();
  head.addSpacer();
  let badgeText = meta.fromCache ? "缓存" : "实时";
  if (meta.fromCache && meta.cacheTs) {
    badgeText = `缓存 ${fmtTime(meta.cacheTs)}`;
  }
  const badge = head.addText(badgeText);
  badge.font = Font.systemFont(10);
  badge.textColor = new Color("#FFFFFF", 0.7);

  w.addSpacer(6);

  // Balance
  const balLabel = w.addText(isArrears ? "账户欠费" : "账户余额");
  balLabel.font = Font.systemFont(11);
  balLabel.textColor = new Color("#FFFFFF", 0.75);

  const balStack = w.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();
  const balVal = isArrears && arrears > 0 ? arrears : b.balance;
  const bal = balStack.addText(`${fmt(balVal)} `);
  bal.font = Font.boldSystemFont(widgetFamily === "small" ? 22 : 28);
  bal.textColor = isArrears ? new Color("#FFD60A") : Color.white();
  const unit = balStack.addText("元");
  unit.font = Font.systemFont(12);
  unit.textColor = new Color("#FFFFFF", 0.85);

  if (isArrears && arrears > 0 && n(b.balance) != null) {
    const hint = w.addText(`余额 ${fmt(b.balance)} 元`);
    hint.font = Font.systemFont(10);
    hint.textColor = new Color("#FFFFFF", 0.65);
  }

  w.addSpacer(6);

  if (widgetFamily === "small") {
    const line = w.addText(
      `本月 ${fmt(m.totalKwh, 1)} kWh · ${fmt(m.totalCost)} 元`
    );
    line.font = Font.systemFont(11);
    line.textColor = new Color("#FFFFFF", 0.9);
    line.lineLimit = 1;
    if (d.yesterday != null) {
      const y = w.addText(`昨日 ${fmt(d.yesterday, 1)} kWh`);
      y.font = Font.systemFont(10);
      y.textColor = new Color("#FFFFFF", 0.75);
    }
  } else {
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 10;
    addMetric(row, "本月电量", `${fmt(m.totalKwh)} kWh`);
    addMetric(row, "本月电费", `${fmt(m.totalCost)} 元`);
    if (d.yesterday != null) {
      addMetric(row, "昨日", `${fmt(d.yesterday)} kWh`);
    } else if (s.ladder != null) {
      addMetric(row, "阶梯", `第${s.ladder}档`);
    }
  }

  // medium+: 上月 / 阶梯
  if (widgetFamily !== "small") {
    w.addSpacer(6);
    const row2 = w.addStack();
    row2.layoutHorizontally();
    row2.spacing = 10;
    addMetric(
      row2,
      "上月",
      `${fmt(last.totalKwh, 0)} kWh / ${fmt(last.totalCost)} 元`
    );
    if (s.ladder != null) {
      const ladderTxt =
        s.remainKwh != null
          ? `第${s.ladder}档 余${fmt(s.remainKwh, 0)}`
          : `第${s.ladder}档`;
      addMetric(row2, "阶梯", ladderTxt);
    } else if (year.yearKwh != null) {
      addMetric(row2, "本年", `${fmt(year.yearKwh, 0)} kWh`);
    }
  }

  // large: 本年 + 近五日更完整
  if (widgetFamily === "large") {
    w.addSpacer(6);
    const row3 = w.addStack();
    row3.layoutHorizontally();
    row3.spacing = 10;
    addMetric(row3, "本年电量", `${fmt(year.yearKwh, 0)} kWh`);
    addMetric(row3, "本年电费", `${fmt(year.yearCost)} 元`);
    if (s.tariff != null) {
      addMetric(row3, "当前电价", `${fmt(s.tariff)} 元`);
    }
  }

  if (SHOW_RECENT && widgetFamily !== "small" && d.recent?.length) {
    w.addSpacer(6);
    const sub = w.addText("近五日用电");
    sub.font = Font.systemFont(10);
    sub.textColor = new Color("#FFFFFF", 0.65);
    const recentLine = d.recent
      .slice(-5)
      .map((r) => `${String(r.date).slice(5)} ${fmt(r.kwh, 1)}`)
      .join("  ");
    const rt = w.addText(recentLine);
    rt.font = Font.systemFont(10);
    rt.textColor = new Color("#FFFFFF", 0.9);
    rt.lineLimit = 2;
    rt.minimumScaleFactor = 0.75;
  }

  w.addSpacer();

  // Footer
  const foot = w.addStack();
  foot.layoutHorizontally();
  foot.centerAlignContent();
  const addr = (u.address || u.userName || u.accountNumber || "").toString();
  const maxLen = widgetFamily === "small" ? 12 : 20;
  const f1 = foot.addText(
    addr.length > maxLen ? addr.slice(0, maxLen) + "…" : addr || "南网户号"
  );
  f1.font = Font.systemFont(10);
  f1.textColor = new Color("#FFFFFF", 0.6);
  f1.lineLimit = 1;
  foot.addSpacer();
  if (meta.multi > 1) {
    const idx = foot.addText(`${meta.index + 1}/${meta.multi}`);
    idx.font = Font.systemFont(10);
    idx.textColor = new Color("#FFFFFF", 0.6);
  }

  // 点击打开 Scriptable 运行本脚本（便于手动刷新）
  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}

  return w;
}

function addMetric(parent, label, value) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = 2;
  const l = col.addText(label);
  l.font = Font.systemFont(10);
  l.textColor = new Color("#FFFFFF", 0.65);
  l.lineLimit = 1;
  const v = col.addText(value);
  v.font = Font.mediumSystemFont(12);
  v.textColor = Color.white();
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.65;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);
  w.backgroundColor = new Color("#3A3A3C");
  const t = w.addText("南方电网");
  t.font = Font.boldSystemFont(14);
  t.textColor = Color.white();
  w.addSpacer(8);
  const b = w.addText(msg);
  b.font = Font.systemFont(12);
  b.textColor = new Color("#FF9F0A");
  b.lineLimit = 8;
  b.minimumScaleFactor = 0.85;
  w.addSpacer();
  const tip = w.addText("Surge 开启 · 模块启用 · App 捕获 Token");
  tip.font = Font.systemFont(10);
  tip.textColor = new Color("#FFFFFF", 0.5);
  try {
    w.url = URLScheme.forRunningScript();
  } catch (_) {}
  return w;
}

await main();
