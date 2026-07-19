/**
 * 南方电网 (CSG / 南网在线) - Surge 脚本
 *
 * 功能：
 * 1. MITM 自动捕获 南网在线 App/网页 登录态 (x-auth-token)
 * 2. 定时查询余额 / 用电并系统通知
 * 3. 服务模式：供 Scriptable 小组件拉取 JSON
 * 4. 可选：短信 / 密码+短信 登录（需 argument 或 persistentStore）
 *
 * 覆盖：广东、广西、云南、贵州、海南
 *
 * 参考 API 实现：CubicPill/china_southern_power_grid_stat (GPL-3.0)
 * 本仓库脚本按同类接口自写，结构对齐网上国网 95598 任务用法。
 */

const NAME = "南方电网";
const VERSION = "1.0.0";
const BASE_APP = "https://95598.csg.cn/ucs/ma/zt/";
const BASE_WEB = "https://95598.csg.cn/ucs/ma/wt/";
const REWRITE_HOST = "api.csg-rewrite.com";

// AES for login payload (from 95598.csg.cn front-end JS)
const PARAM_KEY = "cOdHFNHUNkZrjNaN";
const PARAM_IV = "oMChoRLZnTivcQyR";
// RSA public key (SPKI base64) for password field
const CREDENTIAL_PUBKEY_B64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD1RJE6GBKJlFQvTU6g0ws9R+qXFccKl4i1Rf4KVR8Rh3XtlBtvBxEyTxnVT294RVvYz6THzHGQwREnlgdkjZyGBf7tmV2CgwaHF+ttvupuzOmRVQ/difIJtXKM+SM0aCOqBk0fFaLiHrZlZS4qI2/rBQN8VBoVKfGinVMM+USswwIDAQAB";

const AREA_CODES = {
  广东: "030000",
  广西: "040000",
  云南: "050000",
  贵州: "060000",
  海南: "070000",
  GD: "030000",
  GX: "040000",
  YN: "050000",
  GZ: "060000",
  HI: "070000",
};
const AREA_FALLBACK = "030000";

const STORE = {
  token: "csg_auth_token",
  cust: "csg_cust_number",
  session: "csg_session",
  accounts: "csg_accounts_cache",
  lastResult: "csg_last_result",
  debug: "csg_debug",
  phone: "csg_phone",
  password: "csg_password",
  showRecent: "csg_show_recent",
  notifyAll: "csg_notify_all",
};

const RESP_OK = "00";
const RESP_NO_LOGIN = "04";
const RESP_QR_WAIT = "09";
const RESP_BAD_CRED = "00010002";

// -------------------- Env helpers --------------------

const isSurge = typeof $httpClient !== "undefined";
const isQX = typeof $task !== "undefined";
const isNode = typeof require === "function" && typeof module !== "undefined";

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
  if (isSurge) {
    $notification.post(title, subtitle || "", body || "");
  } else if (isQX) {
    $notify(title, subtitle || "", body || "");
  } else {
    log("NOTIFY:", title, subtitle, body);
  }
}

function getStore(key) {
  if (isSurge || typeof $persistentStore !== "undefined") {
    return $persistentStore.read(key);
  }
  if (isQX) return $prefs.valueForKey(key);
  if (isNode) {
    try {
      const fs = require("fs");
      const p = "./csg-store.json";
      if (!fs.existsSync(p)) return null;
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j[key] ?? null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function setStore(key, val) {
  const s = val == null ? "" : String(val);
  if (isSurge || typeof $persistentStore !== "undefined") {
    $persistentStore.write(s, key);
    return;
  }
  if (isQX) {
    $prefs.setValueForKey(s, key);
    return;
  }
  if (isNode) {
    const fs = require("fs");
    const p = "./csg-store.json";
    let j = {};
    try {
      if (fs.existsSync(p)) j = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {}
    j[key] = s;
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
  }
}

function done(val) {
  if (typeof $done === "function") $done(val || {});
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
    typeof $argument !== "undefined"
      ? parseArgument($argument)
      : isNode
        ? parseArgument(process.env.CSG_ARGUMENT || "")
        : {};

  const bool = (v, def = false) => {
    if (v === undefined || v === null || v === "") return def;
    return v === true || v === "true" || v === "1" || v === 1;
  };

  const areaRaw = arg.area || arg.AREA || getStore("csg_area") || "广东";
  const areaCode =
    AREA_CODES[areaRaw] ||
    (/^\d{6}$/.test(String(areaRaw)) ? String(areaRaw) : AREA_FALLBACK);

  return {
    phone: arg.phone || arg.PHONE || arg.username || getStore(STORE.phone) || "",
    password:
      arg.password || arg.PASSWORD || getStore(STORE.password) || "",
    smsCode: arg.sms || arg.code || arg.SMS || "",
    action: (arg.action || arg.ACTION || "").toLowerCase(),
    token: arg.token || arg.TOKEN || getStore(STORE.token) || "",
    custNumber: arg.cust || arg.CUST || getStore(STORE.cust) || "",
    areaCode,
    debug: bool(arg.debug ?? getStore(STORE.debug), false),
    showRecent: bool(
      arg.show_recent ?? arg.showRecent ?? getStore(STORE.showRecent),
      false
    ),
    notifyAll: bool(
      arg.notify_all ?? arg.notifyAll ?? getStore(STORE.notifyAll),
      true
    ),
    serviceMode: bool(arg.service ?? arg.serviceMode, false),
  };
}

// -------------------- Crypto (AES-128-CBC zero pad + RSA PKCS1) --------------------
// Compact pure-JS; only used for SMS / password login.

const CryptoUtil = (() => {
  // ---- AES S-box / tables (compact) ----
  const sBox = [
    99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118,
    202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192,
    183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21,
    4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117,
    9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132,
    83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207,
    208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168,
    81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
    205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115,
    96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219,
    224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121,
    231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
    186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138,
    112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158,
    225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
    140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22,
  ];
  const rCon = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function rotWord(w) {
    return (w << 8) | (w >>> 24);
  }
  function subWord(w) {
    return (
      (sBox[(w >>> 24) & 255] << 24) |
      (sBox[(w >>> 16) & 255] << 16) |
      (sBox[(w >>> 8) & 255] << 8) |
      sBox[w & 255]
    );
  }
  function keyExpansion(keyBytes) {
    const Nk = 4,
      Nr = 10;
    const w = new Array(44);
    for (let i = 0; i < Nk; i++) {
      w[i] =
        (keyBytes[4 * i] << 24) |
        (keyBytes[4 * i + 1] << 16) |
        (keyBytes[4 * i + 2] << 8) |
        keyBytes[4 * i + 3];
    }
    for (let i = Nk; i < 44; i++) {
      let temp = w[i - 1];
      if (i % Nk === 0) temp = subWord(rotWord(temp)) ^ (rCon[i / Nk] << 24);
      w[i] = w[i - Nk] ^ temp;
    }
    return w;
  }
  function addRoundKey(s, w, rnd) {
    for (let c = 0; c < 4; c++) {
      const rk = w[rnd * 4 + c];
      s[0][c] ^= (rk >>> 24) & 255;
      s[1][c] ^= (rk >>> 16) & 255;
      s[2][c] ^= (rk >>> 8) & 255;
      s[3][c] ^= rk & 255;
    }
  }
  function subBytes(s) {
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) s[r][c] = sBox[s[r][c]];
  }
  function shiftRows(s) {
    const t = s[1][0];
    s[1][0] = s[1][1];
    s[1][1] = s[1][2];
    s[1][2] = s[1][3];
    s[1][3] = t;
    const t0 = s[2][0],
      t1 = s[2][1];
    s[2][0] = s[2][2];
    s[2][1] = s[2][3];
    s[2][2] = t0;
    s[2][3] = t1;
    const u = s[3][3];
    s[3][3] = s[3][2];
    s[3][2] = s[3][1];
    s[3][1] = s[3][0];
    s[3][0] = u;
  }
  function xtime(a) {
    return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 255;
  }
  function mixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const a0 = s[0][c],
        a1 = s[1][c],
        a2 = s[2][c],
        a3 = s[3][c];
      const r = a0 ^ a1 ^ a2 ^ a3;
      s[0][c] ^= r ^ xtime(a0 ^ a1);
      s[1][c] ^= r ^ xtime(a1 ^ a2);
      s[2][c] ^= r ^ xtime(a2 ^ a3);
      s[3][c] ^= r ^ xtime(a3 ^ a0);
    }
  }
  function bytesToState(b) {
    const s = [[], [], [], []];
    for (let i = 0; i < 16; i++) s[i % 4][(i / 4) | 0] = b[i];
    return s;
  }
  function stateToBytes(s) {
    const b = new Array(16);
    for (let i = 0; i < 16; i++) b[i] = s[i % 4][(i / 4) | 0];
    return b;
  }
  function encryptBlock(block, w) {
    const s = bytesToState(block);
    addRoundKey(s, w, 0);
    for (let rnd = 1; rnd < 10; rnd++) {
      subBytes(s);
      shiftRows(s);
      mixColumns(s);
      addRoundKey(s, w, rnd);
    }
    subBytes(s);
    shiftRows(s);
    addRoundKey(s, w, 10);
    return stateToBytes(s);
  }

  function strToBytes(str) {
    const utf8 = unescape(encodeURIComponent(str));
    const arr = new Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) arr[i] = utf8.charCodeAt(i);
    return arr;
  }
  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // btoa/atob polyfill for Node
  const btoa =
    globalThis.btoa ||
    ((s) => Buffer.from(s, "binary").toString("base64"));
  const atob =
    globalThis.atob ||
    ((s) => Buffer.from(s, "base64").toString("binary"));

  function aesEncryptZeroPad(plaintext, keyStr, ivStr) {
    const keyBytes = strToBytes(keyStr);
    const ivBytes = strToBytes(ivStr);
    const data = strToBytes(plaintext);
    // CSG: zero-byte padding; when already aligned, still pad a full block of 16 zeros
    const n = 16 - (data.length % 16);
    for (let i = 0; i < n; i++) data.push(0);

    const w = keyExpansion(keyBytes);
    const out = [];
    let prev = ivBytes.slice();
    for (let off = 0; off < data.length; off += 16) {
      const block = data.slice(off, off + 16);
      for (let i = 0; i < 16; i++) block[i] ^= prev[i];
      const enc = encryptBlock(block, w);
      for (let i = 0; i < 16; i++) out.push(enc[i]);
      prev = enc;
    }
    return bytesToB64(out);
  }

  // ---- RSA PKCS#1 v1.5 encrypt (1024-bit) using BigInt ----
  function parseSpkiRsa(spkiB64) {
    const bytes = b64ToBytes(spkiB64);
    // naive DER walk to find BIT STRING containing RSAPublicKey SEQUENCE
    // SPKI: SEQ { alg, BIT STRING (0x00 + SEQ { n INTEGER, e INTEGER }) }
    function readLen(buf, i) {
      let len = buf[i++];
      if (len < 0x80) return [len, i];
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | buf[i++];
      return [len, i];
    }
    function findIntegers(buf) {
      // find the deepest SEQUENCE with two INTEGERs
      const ints = [];
      let i = 0;
      while (i < buf.length) {
        const tag = buf[i++];
        const [len, ni] = readLen(buf, i);
        i = ni;
        if (tag === 0x02) {
          let v = buf.slice(i, i + len);
          // strip leading zero
          while (v.length > 1 && v[0] === 0) v = v.slice(1);
          ints.push(v);
          i += len;
        } else if (tag === 0x30 || tag === 0x03) {
          // bit string may start with unused bits byte
          let start = i;
          let end = i + len;
          if (tag === 0x03) start += 1; // unused bits
          const sub = findIntegers(buf.slice(start, end));
          if (sub.length >= 2) return sub;
          i = end;
        } else {
          i += len;
        }
      }
      return ints;
    }
    const ints = findIntegers(bytes);
    if (ints.length < 2) throw new Error("RSA pubkey parse failed");
    const n = bytesToBigInt(ints[0]);
    const e = bytesToBigInt(ints[1]);
    return { n, e };
  }

  function bytesToBigInt(bytes) {
    let hex = "0x";
    for (let i = 0; i < bytes.length; i++)
      hex += bytes[i].toString(16).padStart(2, "0");
    return BigInt(hex);
  }
  function bigIntToBytes(bi, len) {
    let hex = bi.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    const out = [];
    for (let i = 0; i < hex.length; i += 2)
      out.push(parseInt(hex.slice(i, i + 2), 16));
    while (out.length < len) out.unshift(0);
    return out;
  }
  function modPow(base, exp, mod) {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      base = (base * base) % mod;
      exp >>= 1n;
    }
    return result;
  }
  function rsaEncryptPkcs1(text, spkiB64) {
    const { n, e } = parseSpkiRsa(spkiB64);
    const k = 128; // 1024-bit
    const mBytes = strToBytes(text);
    if (mBytes.length > k - 11) throw new Error("RSA message too long");
    // EM = 0x00 || 0x02 || PS || 0x00 || M
    const psLen = k - mBytes.length - 3;
    const em = [0x00, 0x02];
    for (let i = 0; i < psLen; i++) {
      let r = (Math.random() * 255) | 0;
      if (r === 0) r = 1;
      em.push(r);
    }
    em.push(0x00);
    for (const b of mBytes) em.push(b);
    const m = bytesToBigInt(em);
    const c = modPow(m, e, n);
    return bytesToB64(bigIntToBytes(c, k));
  }

  return {
    encryptParams(obj) {
      const json = JSON.stringify(obj);
      return aesEncryptZeroPad(json, PARAM_KEY, PARAM_IV);
    },
    encryptPassword(pwd) {
      return rsaEncryptPkcs1(pwd, CREDENTIAL_PUBKEY_B64);
    },
  };
})();

// -------------------- HTTP --------------------

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const opts = {
      url,
      headers: headers || {},
      body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    };
    const handler = (err, resp, data) => {
      if (err) return reject(err);
      let json = data;
      if (typeof data === "string") {
        try {
          const s = data;
          const a = s.indexOf("{");
          const b = s.lastIndexOf("}");
          json = JSON.parse(a >= 0 ? s.slice(a, b + 1) : s);
        } catch (e) {
          return reject(new Error("JSON parse fail: " + String(data).slice(0, 200)));
        }
      }
      resolve({
        headers: resp?.headers || {},
        status: resp?.status || resp?.statusCode || 200,
        data: json,
      });
    };
    if (isSurge) {
      $httpClient.post(opts, handler);
    } else if (isQX) {
      opts.method = "POST";
      $task.fetch(opts).then(
        (r) => handler(null, r, r.body),
        (e) => handler(e)
      );
    } else if (isNode) {
      // Node fallback for local test
      const https = require("https");
      const u = new URL(url);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=utf-8",
            "Content-Length": Buffer.byteLength(opts.body),
            ...opts.headers,
          },
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () =>
            handler(null, { status: res.statusCode, headers: res.headers }, buf)
          );
        }
      );
      req.on("error", reject);
      req.write(opts.body);
      req.end();
    } else {
      reject(new Error("unsupported runtime"));
    }
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

  async sendLoginSms(phone) {
    const res = await this.request(
      "center/sendMsg",
      {
        areaCode: this.areaCode,
        phoneNumber: phone,
        vcType: "1",
        msgType: "1",
      },
      { auth: false }
    );
    this.ensureOk("center/sendMsg", res.data);
    return true;
  }

  async loginWithSms(phone, code) {
    const plain = {
      areaCode: this.areaCode,
      acctId: phone,
      logonChan: "4",
      credType: "11",
      code,
    };
    const res = await this.request(
      "center/login",
      { param: CryptoUtil.encryptParams(plain) },
      { auth: false, extraHeaders: { "need-crypto": "true" } }
    );
    this.ensureOk("center/login", res.data);
    const token =
      res.headers["x-auth-token"] ||
      res.headers["X-Auth-Token"] ||
      headerPick(res.headers, "x-auth-token");
    if (!token) throw new Error("登录成功但未返回 x-auth-token");
    this.token = token;
    return token;
  }

  async loginWithPasswordAndSms(phone, password, code) {
    const plain = {
      areaCode: this.areaCode,
      acctId: phone,
      logonChan: "4",
      credType: "1011",
      credentials: CryptoUtil.encryptPassword(password),
      code,
      checkPwd: true,
    };
    const res = await this.request(
      "center/loginByPwdAndMsg",
      { param: CryptoUtil.encryptParams(plain) },
      { auth: false, extraHeaders: { "need-crypto": "true" } }
    );
    if (res.data?.sta === RESP_BAD_CRED) {
      throw new Error("账号或密码错误");
    }
    this.ensureOk("center/loginByPwdAndMsg", res.data);
    const token =
      res.headers["x-auth-token"] ||
      res.headers["X-Auth-Token"] ||
      headerPick(res.headers, "x-auth-token");
    if (!token) throw new Error("登录成功但未返回 x-auth-token");
    this.token = token;
    return token;
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

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  return Number(n).toFixed(digits);
}

// -------------------- Formatting --------------------

function formatNotify(items, { showRecent }) {
  const list = [];
  for (const it of items) {
    const u = it.userInfo || {};
    const b = it.eleBill || {};
    const m = it.monthElecQuantity || {};
    const d = it.dayElecQuantity || {};
    const s = it.stepElecQuantity || {};
    const lines = [];
    lines.push(`户号: ${u.accountNumber || "--"}`);
    if (u.address) lines.push(`地址: ${u.address}`);
    lines.push(`余额: ${fmt(b.balance)} 元`);
    if ((b.arrears || 0) > 0) lines.push(`欠费: ${fmt(b.arrears)} 元`);
    lines.push(
      `本月: ${fmt(m.totalKwh)} kWh / ${fmt(m.totalCost)} 元`
    );
    if (m.lastMonth)
      lines.push(
        `上月: ${fmt(m.lastMonth.totalKwh)} kWh / ${fmt(m.lastMonth.totalCost)} 元`
      );
    if (m.year)
      lines.push(
        `本年: ${fmt(m.year.yearKwh)} kWh / ${fmt(m.year.yearCost)} 元`
      );
    if (d.yesterday != null) lines.push(`昨日: ${fmt(d.yesterday)} kWh`);
    if (s.ladder != null)
      lines.push(
        `阶梯: 第${s.ladder}档 剩余${fmt(s.remainKwh)} kWh 单价${fmt(s.tariff)}`
      );
    if (showRecent && d.recent?.length) {
      lines.push("近五日:");
      for (const r of d.recent) {
        lines.push(`  ${r.date}: ${fmt(r.kwh)} kWh`);
      }
    }
    list.push(lines.join("\n"));
  }
  return list;
}

// -------------------- Modes --------------------

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
    notify(NAME, "登录态已更新", "已从南网请求中捕获 Token，可用于查询与小组件");
  } else {
    debug("token unchanged");
  }
  done({});
}

async function runService(settings, query = {}) {
  const client = await ensureClient(settings);
  const accounts = await client.getAllAccounts();
  if (!accounts.length) throw new Error("未查询到绑定户号");

  const picked = settings.notifyAll ? accounts : accounts.slice(0, 1);
  const data = [];
  for (const acc of picked) {
    data.push(await client.collectAccount(acc));
  }
  setStore(STORE.lastResult, JSON.stringify({ ts: Date.now(), data }));
  setStore(STORE.accounts, JSON.stringify(accounts));
  return data;
}

async function runNotify(settings) {
  const data = await runService(settings);
  const bodies = formatNotify(data, { showRecent: settings.showRecent });
  if (!bodies.length) {
    notify(NAME, "无数据", "查询成功但没有可展示的户号数据");
    return { title: NAME, body: "无数据", data };
  }
  // 多户号：首条汇总，其余分条或合并
  if (bodies.length === 1) {
    notify(NAME, "用电查询", bodies[0]);
  } else {
    notify(NAME, `共 ${bodies.length} 个户号`, bodies[0]);
    for (let i = 1; i < bodies.length; i++) {
      notify(`${NAME} #${i + 1}`, "", bodies[i]);
    }
  }
  return { title: NAME, body: bodies.join("\n\n"), data };
}

async function ensureClient(settings) {
  if (settings.debug) setStore(STORE.debug, "true");

  let token = settings.token || getStore(STORE.token) || "";
  let cust = settings.custNumber || getStore(STORE.cust) || "";

  const client = new CSGClient({
    token,
    custNumber: cust,
    areaCode: settings.areaCode,
  });

  if (!token) {
    throw new Error(
      "尚无登录态。请打开「南网在线」App 随便点开用电相关页面以自动捕获 Token，或使用短信登录。"
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

async function handleLoginActions(settings) {
  const client = new CSGClient({ areaCode: settings.areaCode });
  const phone = settings.phone;
  if (!phone) throw new Error("请配置 phone/USERNAME 手机号");

  if (settings.action === "send_sms" || settings.action === "sendsms") {
    await client.sendLoginSms(phone);
    setStore(STORE.phone, phone);
    notify(NAME, "验证码已发送", `已向 ${phone} 发送登录验证码`);
    return { ok: true, action: "send_sms" };
  }

  if (settings.action === "login_sms" || settings.action === "loginsms") {
    if (!settings.smsCode) throw new Error("请在 argument 中提供 sms/code 验证码");
    const token = await client.loginWithSms(phone, settings.smsCode);
    setStore(STORE.token, token);
    setStore(STORE.phone, phone);
    await client.initialize();
    if (client.custNumber) setStore(STORE.cust, client.custNumber);
    notify(NAME, "短信登录成功", "Token 已保存，可定时查询");
    return { ok: true, action: "login_sms", token: token.slice(0, 8) + "..." };
  }

  if (
    settings.action === "login_pwd_sms" ||
    settings.action === "loginpwdsms"
  ) {
    if (!settings.password) throw new Error("请配置 password");
    if (!settings.smsCode) throw new Error("请提供 sms/code 验证码");
    const token = await client.loginWithPasswordAndSms(
      phone,
      settings.password,
      settings.smsCode
    );
    setStore(STORE.token, token);
    setStore(STORE.phone, phone);
    setStore(STORE.password, settings.password);
    await client.initialize();
    if (client.custNumber) setStore(STORE.cust, client.custNumber);
    notify(NAME, "登录成功", "Token 已保存");
    return { ok: true, action: "login_pwd_sms" };
  }

  return null;
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

function parseServiceQuery() {
  try {
    const u = new URL($request.url);
    const q = {};
    u.searchParams.forEach((v, k) => {
      q[k] = v;
    });
    return q;
  } catch (_) {
    return {};
  }
}

// -------------------- Main --------------------

async function main() {
  const settings = getSettings();
  if (settings.debug) setStore(STORE.debug, "true");

  // 1) Token capture from CSG traffic
  if (isHttpRequest()) {
    const host = requestHost();
    if (host === "95598.csg.cn") {
      captureTokenFromRequest();
      return;
    }
    if (host === REWRITE_HOST || ($request.url || "").includes("electricity/bill")) {
      try {
        settings.serviceMode = true;
        const data = await runService(settings, parseServiceQuery());
        done(serviceResponse(data));
      } catch (e) {
        log("service error", e);
        done(
          serviceResponse(
            { error: true, message: e.message || String(e) },
            500
          )
        );
      }
      return;
    }
    // unknown request
    done({});
    return;
  }

  // 2) Cron / manual run
  try {
    if (settings.action) {
      const r = await handleLoginActions(settings);
      if (r) {
        log("action result", r);
        done();
        return;
      }
    }

    if (settings.serviceMode) {
      const data = await runService(settings);
      log("service data accounts:", data.length);
      // node print
      if (isNode) console.log(JSON.stringify(data, null, 2));
      done();
      return;
    }

    await runNotify(settings);
    done();
  } catch (e) {
    log("error", e);
    notify(NAME, "❌ 执行失败", e.message || String(e));
    done();
  }
}

main();
