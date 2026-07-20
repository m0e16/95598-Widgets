/**
 * 南方电网 (CSG / 南网在线) - Surge 脚本
 *
 * 仅服务 Scriptable 小组件：
 * 1. MITM 捕获 南网在线 App 登录态 (x-auth-token)
 * 2. 重写 api.csg-rewrite.com，返回电费 JSON 供小组件读取
 *
 * 登录：打开「南网在线」App（Surge 开启）自动捕获 Token。
 * 覆盖：广东、广西、云南、贵州、海南
 *
 * 仅运行于 Surge（无 Node / 青龙 / 其他代理 App 适配）。
 * 参考 API：CubicPill/china_southern_power_grid_stat (GPL-3.0)
 */

const NAME = "南方电网";
const VERSION = "1.2.1";
const BASE_APP = "https://95598.csg.cn/ucs/ma/zt/";
const REWRITE_HOST = "api.csg-rewrite.com";

const AREA_FALLBACK = "030000";

const STORE = {
  token: "csg_auth_token",
  cust: "csg_cust_number",
  session: "csg_session",
  accounts: "csg_accounts_cache",
  lastResult: "csg_last_result",
  debug: "csg_debug",
};

const RESP_OK = "00";
const RESP_NO_LOGIN = "04";

// -------------------- Env helpers (Surge only) --------------------

function log(...args) {
  console.log(`[${NAME}]`, ...args);
}

function debug(...args) {
  if (isDebug()) log("[DEBUG]", ...args);
}

function isDebug() {
  const v = getStore(STORE.debug);
  return v === "true" || v === "1" || v === true;
}

function notify(title, subtitle, body) {
  $notification.post(title, subtitle || "", body || "");
}

function getStore(key) {
  return $persistentStore.read(key);
}

function setStore(key, val) {
  $persistentStore.write(val == null ? "" : String(val), key);
}

function done(val) {
  $done(val || {});
}

function parseArgument(raw) {
  const out = {};
  if (!raw) return out;
  if (typeof raw === "object") return { ...raw };
  String(raw)
    .split("&")
    .forEach((pair) => {
      const i = pair.indexOf("=");
      if (i === -1) return;
      const k = decodeURIComponent(pair.slice(0, i));
      const v = decodeURIComponent(pair.slice(i + 1));
      out[k] = v;
    });
  return out;
}

function getSettings() {
  const arg =
    typeof $argument !== "undefined" ? parseArgument($argument) : {};

  const bool = (v, def = false) => {
    if (v === undefined || v === null || v === "") return def;
    return v === true || v === "true" || v === "1" || v === 1;
  };

  return {
    token: getStore(STORE.token) || "",
    custNumber: getStore(STORE.cust) || "",
    areaCode: AREA_FALLBACK,
    debug: bool(arg.debug ?? getStore(STORE.debug), false),
  };
}

// -------------------- HTTP (Surge $httpClient) --------------------

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const opts = {
      url,
      headers: headers || {},
      body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    };
    $httpClient.post(opts, (err, resp, data) => {
      if (err) return reject(err);
      let json = data;
      if (typeof data === "string") {
        try {
          const s = data;
          const a = s.indexOf("{");
          const b = s.lastIndexOf("}");
          json = JSON.parse(a >= 0 ? s.slice(a, b + 1) : s);
        } catch (e) {
          return reject(
            new Error("JSON parse fail: " + String(data).slice(0, 200))
          );
        }
      }
      resolve({
        headers: (resp && resp.headers) || {},
        status: (resp && (resp.status || resp.statusCode)) || 200,
        data: json,
      });
    });
  });
}

// -------------------- CSG Client --------------------

class CSGClient {
  constructor({ token, custNumber, areaCode } = {}) {
    this.token = token || "";
    this.custNumber = custNumber || "";
    this.areaCode = areaCode || AREA_FALLBACK;
  }

  commonHeaders(withAuth = true, extra = {}) {
    const h = {
      Host: "95598.csg.cn",
      "Content-Type": "application/json;charset=utf-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "Accept-Language": "zh-CN,cn;q=0.9",
      Origin: "file://",
      ...extra,
    };
    if (withAuth) {
      h["x-auth-token"] = this.token;
      h["custNumber"] = this.custNumber || "";
    }
    return h;
  }

  async request(path, payload, { auth = true, base = BASE_APP, extraHeaders = {} } = {}) {
    const url = base + path;
    const headers = this.commonHeaders(auth, extraHeaders);
    debug("POST", path, payload);
    const res = await httpPost(url, payload == null ? null : payload, headers);
    debug("RESP", path, res.data?.sta, res.data?.message);
    return res;
  }

  ensureOk(path, data) {
    if (!data || data.sta === RESP_OK) return data;
    if (data.sta === RESP_NO_LOGIN) {
      const err = new Error("登录态失效，请重新登录南网在线或重新捕获 Token");
      err.code = RESP_NO_LOGIN;
      throw err;
    }
    const err = new Error(data.message || `接口失败 sta=${data.sta} @ ${path}`);
    err.code = data.sta;
    throw err;
  }

  async getUserInfo() {
    const res = await this.request("user/getUserInfo", null);
    this.ensureOk("user/getUserInfo", res.data);
    return res.data.data;
  }

  async initialize() {
    const info = await this.getUserInfo();
    this.custNumber = info.custNumber || this.custNumber;
    return info;
  }

  async verifyLogin() {
    try {
      const res = await this.request("user/queryAuthenticationResult", null);
      return res.data?.sta === RESP_OK;
    } catch (_) {
      return false;
    }
  }

  async getBindUsers() {
    const res = await this.request("eleCustNumber/queryBindEleUsers", {});
    this.ensureOk("eleCustNumber/queryBindEleUsers", res.data);
    return res.data.data || [];
  }

  async getMeteringPoint(areaCode, eleCustId) {
    const res = await this.request("charge/queryMeteringPoint", {
      areaCode,
      eleCustNumberList: [{ eleCustId, areaCode }],
    });
    this.ensureOk("charge/queryMeteringPoint", res.data);
    return (res.data.data && res.data.data[0]) || {};
  }

  async getBalance(areaCode, eleCustId) {
    const res = await this.request("charge/queryUserAccountNumberSurplus", {
      areaCode,
      eleCustId,
    });
    this.ensureOk("charge/queryUserAccountNumberSurplus", res.data);
    const row = (res.data.data && res.data.data[0]) || {};
    return {
      balance: num(row.balance),
      arrears: num(row.arrears),
    };
  }

  async getDayElectric(year, month, areaCode, eleCustId, meteringPointId) {
    const res = await this.request("charge/queryDayElectricByMPoint", {
      areaCode,
      eleCustId,
      yearMonth: `${year}${String(month).padStart(2, "0")}`,
      meteringPointId,
    });
    this.ensureOk("charge/queryDayElectricByMPoint", res.data);
    const d = res.data.data || {};
    return {
      totalPower: num(d.totalPower),
      byDay: (d.result || []).map((x) => ({
        date: x.date,
        kwh: num(x.power),
      })),
    };
  }

  async getDayCharge(year, month, areaCode, eleCustId, meteringPointId) {
    const res = await this.request("charge/queryDayElectricChargeByMPoint", {
      areaCode,
      eleCustId,
      yearMonth: `${year}${String(month).padStart(2, "0")}`,
      meteringPointId,
    });
    this.ensureOk("charge/queryDayElectricChargeByMPoint", res.data);
    const d = res.data.data || {};
    return {
      totalCost: d.totalElectricity != null ? num(d.totalElectricity) : null,
      totalPower: d.totalPower != null ? num(d.totalPower) : null,
      ladder: d.ladderEle != null ? num(d.ladderEle) : null,
      ladderRemain:
        d.ladderEleSurplus != null ? num(d.ladderEleSurplus) : null,
      ladderTariff: d.ladderEleTariff != null ? num(d.ladderEleTariff) : null,
      ladderStart: d.ladderEleStartDate || null,
      byDay: (d.result || []).map((x) => ({
        date: x.date,
        kwh: num(x.power),
        charge: num(x.charge),
      })),
    };
  }

  async getYearAnalyze(year, areaCode, eleCustId) {
    const res = await this.request("charge/getAnalyzeFeeDetails", {
      areaCode,
      electricityBillYear: year,
      eleCustId,
      meteringPointId: null,
    });
    this.ensureOk("charge/getAnalyzeFeeDetails", res.data);
    const d = res.data.data || {};
    return {
      yearKwh: num(d.totalBillingElectricity),
      yearCost: num(d.totalActualAmount),
      byMonth: (d.electricAndChargeList || []).map((m) => ({
        month: m.yearMonth,
        kwh: num(m.billingElectricity),
        charge: num(m.actualTotalAmount),
      })),
    };
  }

  async getYesterday(areaCode, eleCustId) {
    const res = await this.request("charge/queryDayElectricByMPointYesterday", {
      eleCustId,
      areaCode,
    });
    this.ensureOk("charge/queryDayElectricByMPointYesterday", res.data);
    const d = res.data.data || {};
    return d.power != null ? num(d.power) : null;
  }

  async getAllAccounts() {
    const users = await this.getBindUsers();
    const accounts = [];
    for (const u of users) {
      const areaCode = u.areaCode || this.areaCode;
      const eleCustId = u.bindingId;
      let mp = {};
      try {
        mp = await this.getMeteringPoint(areaCode, eleCustId);
      } catch (e) {
        log("metering point fail", e.message);
      }
      accounts.push({
        accountNumber: u.eleCustNumber,
        areaCode,
        eleCustId,
        meteringPointId: mp.meteringPointId || "",
        meteringPointNumber: mp.meteringPointNumber || "",
        address: u.eleAddress || "",
        userName: u.userName || "",
      });
    }
    return accounts;
  }

  async collectAccount(account) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const last = new Date(y, m - 2, 1);
    const ly = last.getFullYear();
    const lm = last.getMonth() + 1;

    const bal = await this.getBalance(account.areaCode, account.eleCustId);
    let month = {
      totalCost: null,
      totalPower: null,
      ladder: null,
      ladderRemain: null,
      ladderTariff: null,
      byDay: [],
    };
    let lastMonth = { totalCost: null, totalPower: null, byDay: [] };
    let year = { yearKwh: null, yearCost: null, byMonth: [] };
    let yesterday = null;

    if (account.meteringPointId) {
      try {
        month = await this.getDayCharge(
          y,
          m,
          account.areaCode,
          account.eleCustId,
          account.meteringPointId
        );
      } catch (e) {
        log("month charge fail", e.message);
        try {
          const d = await this.getDayElectric(
            y,
            m,
            account.areaCode,
            account.eleCustId,
            account.meteringPointId
          );
          month.totalPower = d.totalPower;
          month.byDay = d.byDay.map((x) => ({ ...x, charge: null }));
        } catch (e2) {
          log("month kwh fail", e2.message);
        }
      }
      try {
        lastMonth = await this.getDayCharge(
          ly,
          lm,
          account.areaCode,
          account.eleCustId,
          account.meteringPointId
        );
      } catch (e) {
        log("last month fail", e.message);
      }
    }

    try {
      year = await this.getYearAnalyze(y, account.areaCode, account.eleCustId);
    } catch (e) {
      log("year fail", e.message);
    }
    try {
      yesterday = await this.getYesterday(account.areaCode, account.eleCustId);
    } catch (e) {
      log("yesterday fail", e.message);
    }

    const recent = (month.byDay || []).slice(-5);

    return {
      userInfo: {
        accountNumber: account.accountNumber,
        userName: account.userName,
        address: account.address,
        areaCode: account.areaCode,
        eleCustId: account.eleCustId,
      },
      eleBill: {
        balance: bal.balance,
        arrears: bal.arrears,
        sumMoney: bal.balance,
        historyOwe: bal.arrears,
      },
      dayElecQuantity: {
        yesterday,
        recent,
      },
      dayElecQuantity31: {
        byDay: month.byDay || [],
      },
      monthElecQuantity: {
        totalKwh: month.totalPower,
        totalCost: month.totalCost,
        year,
        lastMonth: {
          totalKwh: lastMonth.totalPower,
          totalCost: lastMonth.totalCost,
        },
      },
      stepElecQuantity: {
        ladder: month.ladder,
        remainKwh: month.ladderRemain,
        tariff: month.ladderTariff,
      },
      arrearsOfFees: (bal.arrears || 0) > 0 || (bal.balance || 0) < 0,
    };
  }
}

function headerPick(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return "";
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isHttpRequest() {
  return typeof $request !== "undefined" && $request;
}

function requestHost() {
  try {
    const u = $request.url || "";
    return new URL(u).hostname;
  } catch (_) {
    return "";
  }
}

function captureTokenFromRequest() {
  const headers = $request.headers || {};
  // Surge may normalize header keys
  const token =
    headerPick(headers, "x-auth-token") ||
    headerPick(headers, "X-Auth-Token");
  const cust =
    headerPick(headers, "custNumber") ||
    headerPick(headers, "custnumber");

  if (!token) {
    done({});
    return;
  }

  const prev = getStore(STORE.token);
  setStore(STORE.token, token);
  if (cust) setStore(STORE.cust, cust);

  // save lightweight session
  setStore(
    STORE.session,
    JSON.stringify({
      token,
      custNumber: cust || getStore(STORE.cust) || "",
      capturedAt: new Date().toISOString(),
      url: ($request.url || "").slice(0, 120),
    })
  );

  if (token !== prev) {
    log("已捕获新的 x-auth-token");
    notify(NAME, "登录态已更新", "已从南网请求中捕获 Token，可供小组件使用");
  } else {
    debug("token unchanged");
  }
  done({});
}

async function runService(settings) {
  const client = await ensureClient(settings);
  const accounts = await client.getAllAccounts();
  if (!accounts.length) throw new Error("未查询到绑定户号");

  const data = [];
  for (const acc of accounts) {
    data.push(await client.collectAccount(acc));
  }
  setStore(STORE.lastResult, JSON.stringify({ ts: Date.now(), data }));
  setStore(STORE.accounts, JSON.stringify(accounts));
  return data;
}

async function ensureClient(settings) {
  if (settings.debug) setStore(STORE.debug, "true");

  let token = settings.token || "";
  let cust = settings.custNumber || "";

  const client = new CSGClient({
    token,
    custNumber: cust,
    areaCode: settings.areaCode,
  });

  if (!token) {
    throw new Error(
      "尚无登录态。请打开「南网在线」App，进入电费/用电相关页面以自动捕获 Token。"
    );
  }

  // refresh custNumber if missing
  try {
    await client.initialize();
    if (client.custNumber) setStore(STORE.cust, client.custNumber);
    setStore(STORE.token, client.token);
  } catch (e) {
    if (e.code === RESP_NO_LOGIN) {
      setStore(STORE.token, "");
      throw e;
    }
    // getUserInfo failed but token might still work for other apis
    log("initialize warn:", e.message);
  }
  return client;
}

function serviceResponse(obj, status = 200) {
  return {
    response: {
      status,
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(obj),
    },
  };
}

// -------------------- Main --------------------

async function main() {
  const settings = getSettings();
  if (settings.debug) setStore(STORE.debug, "true");

  // 仅处理 HTTP 请求：Token 捕获 / 小组件接口
  if (!isHttpRequest()) {
    log("本脚本仅用于小组件接口与 Token 捕获，无定时任务入口");
    done();
    return;
  }

  const host = requestHost();
  if (host === "95598.csg.cn") {
    captureTokenFromRequest();
    return;
  }

  if (host === REWRITE_HOST || ($request.url || "").includes("electricity/bill")) {
    try {
      const data = await runService(settings);
      done(serviceResponse(data));
    } catch (e) {
      log("service error", e);
      done(
        serviceResponse({ error: true, message: e.message || String(e) }, 500)
      );
    }
    return;
  }

  done({});
}

main();
