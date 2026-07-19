// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
/**
 * 南方电网 · Scriptable 小组件
 *
 * 依赖：
 * 1. iPhone 已安装并启用 Surge
 * 2. 已安装本仓库「南方电网」Surge 模块，MITM 含 api.csg-rewrite.com
 * 3. 已通过「南网在线」App 捕获 Token（或短信登录成功）
 *
 * 小组件参数（长按小组件 → 编辑参数，可选 JSON）：
 * {
 *   "url": "https://api.csg-rewrite.com/electricity/bill/all",
 *   "index": 0,
 *   "showRecent": true
 * }
 */

const DEFAULT_URL = "https://api.csg-rewrite.com/electricity/bill/all";
const CACHE_FILE = "csg-widget-cache.json";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟

const widgetFamily = config.widgetFamily || "medium";

let params = {};
try {
  if (args.widgetParameter) {
    params =
      typeof args.widgetParameter === "string"
        ? JSON.parse(args.widgetParameter)
        : args.widgetParameter;
  }
} catch (e) {
  params = {};
}

const API_URL = params.url || DEFAULT_URL;
const ACCOUNT_INDEX = Number(params.index || 0) || 0;
const SHOW_RECENT = params.showRecent !== false;

async function main() {
  let payload;
  let fromCache = false;
  try {
    payload = await fetchBill();
    await saveCache(payload);
  } catch (e) {
    const cached = await loadCache();
    if (cached?.data) {
      payload = cached.data;
      fromCache = true;
    } else {
      const w = errorWidget(e.message || String(e));
      if (config.runsInWidget) {
        Script.setWidget(w);
      } else {
        await w.presentMedium();
      }
      Script.complete();
      return;
    }
  }

  const list = Array.isArray(payload) ? payload : payload?.data || [];
  if (!list.length) {
    const w = errorWidget("无户号数据，请确认 Surge 已捕获登录态");
    if (config.runsInWidget) Script.setWidget(w);
    else await w.presentMedium();
    Script.complete();
    return;
  }

  const item = list[Math.min(ACCOUNT_INDEX, list.length - 1)];
  const w = buildWidget(item, {
    fromCache,
    multi: list.length,
    index: ACCOUNT_INDEX,
  });

  if (config.runsInWidget) {
    Script.setWidget(w);
  } else {
    if (widgetFamily === "small") await w.presentSmall();
    else if (widgetFamily === "large") await w.presentLarge();
    else await w.presentMedium();
  }
  Script.complete();
}

async function fetchBill() {
  const req = new Request(API_URL);
  req.method = "GET";
  req.timeoutInterval = 60;
  req.headers = {
    Accept: "application/json",
    "User-Agent": "Scriptable-CSG-Widget/1.0",
  };
  const json = await req.loadJSON();
  if (json?.error) {
    throw new Error(json.message || "接口返回错误");
  }
  if (!Array.isArray(json) && !json?.data) {
    throw new Error("返回格式异常，请检查 Surge 模块与 MITM");
  }
  return json;
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
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch (_) {}
}

async function loadCache() {
  try {
    const p = cachePath();
    if (!fm().fileExists(p)) return null;
    const j = JSON.parse(fm().readString(p));
    if (!j?.ts || Date.now() - j.ts > CACHE_TTL_MS * 4) return j; // 仍返回，标记过期由 UI 提示
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

function buildWidget(item, meta) {
  const w = new ListWidget();
  w.setPadding(12, 14, 12, 14);
  // 渐变背景
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [new Color("#0B3D91"), new Color("#1A6BB5")];
  w.backgroundGradient = g;

  const u = item.userInfo || {};
  const b = item.eleBill || {};
  const m = item.monthElecQuantity || {};
  const d = item.dayElecQuantity || {};
  const s = item.stepElecQuantity || {};

  // Header
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const title = head.addText("南方电网");
  title.font = Font.boldSystemFont(13);
  title.textColor = Color.white();
  head.addSpacer();
  const badge = head.addText(meta.fromCache ? "缓存" : "实时");
  badge.font = Font.systemFont(10);
  badge.textColor = new Color("#FFFFFF", 0.7);

  w.addSpacer(6);

  // Balance
  const balLabel = w.addText("账户余额");
  balLabel.font = Font.systemFont(11);
  balLabel.textColor = new Color("#FFFFFF", 0.75);

  const balStack = w.addStack();
  balStack.layoutHorizontally();
  balStack.bottomAlignContent();
  const bal = balStack.addText(`${fmt(b.balance)} `);
  bal.font = Font.boldSystemFont(widgetFamily === "small" ? 22 : 28);
  bal.textColor = Color.white();
  const unit = balStack.addText("元");
  unit.font = Font.systemFont(12);
  unit.textColor = new Color("#FFFFFF", 0.85);
  unit.lineLimit = 1;

  if ((n(b.arrears) || 0) > 0) {
    const arr = w.addText(`欠费 ${fmt(b.arrears)} 元`);
    arr.font = Font.mediumSystemFont(11);
    arr.textColor = new Color("#FFD60A");
  }

  w.addSpacer(6);

  // Stats row
  if (widgetFamily !== "small") {
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
  } else {
    const line = w.addText(
      `本月 ${fmt(m.totalKwh)} kWh · ${fmt(m.totalCost)} 元`
    );
    line.font = Font.systemFont(11);
    line.textColor = new Color("#FFFFFF", 0.9);
    line.lineLimit = 1;
  }

  // Recent days (medium/large)
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
    rt.minimumScaleFactor = 0.8;
  }

  w.addSpacer();

  // Footer
  const foot = w.addStack();
  foot.layoutHorizontally();
  const addr = (u.address || u.accountNumber || "").toString();
  const f1 = foot.addText(addr.length > 18 ? addr.slice(0, 18) + "…" : addr);
  f1.font = Font.systemFont(10);
  f1.textColor = new Color("#FFFFFF", 0.6);
  f1.lineLimit = 1;
  foot.addSpacer();
  if (meta.multi > 1) {
    const idx = foot.addText(`${meta.index + 1}/${meta.multi}`);
    idx.font = Font.systemFont(10);
    idx.textColor = new Color("#FFFFFF", 0.6);
  }

  // 点击刷新：打开 Scriptable 运行本脚本
  w.url = URLScheme.forRunningScript();

  return w;
}

function addMetric(parent, label, value) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = 2;
  const l = col.addText(label);
  l.font = Font.systemFont(10);
  l.textColor = new Color("#FFFFFF", 0.65);
  const v = col.addText(value);
  v.font = Font.mediumSystemFont(12);
  v.textColor = Color.white();
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.7;
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
  b.lineLimit = 6;
  w.addSpacer();
  const tip = w.addText("请确认 Surge 已开启且已登录南网");
  tip.font = Font.systemFont(10);
  tip.textColor = new Color("#FFFFFF", 0.5);
  return w;
}

await main();
