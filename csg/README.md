# 南方电网 · Scriptable 小组件

面向 **中国南方电网**（广东 / 广西 / 云南 / 贵州 / 海南）的电费桌面小组件方案。

| 组件 | 作用 |
|------|------|
| **Surge 模块** | 捕获登录态 + 为小组件提供本地接口 |
| **Scriptable 小组件** | 桌面展示余额 / 本月用电 / 近五日 |

> 登录方式只有一种：保持 Surge 开启，打开 **南网在线 App** 自动捕获 Token。  
> 本模块 **不做定时通知**，只服务小组件拉数。

API 逻辑参考 [CubicPill/china_southern_power_grid_stat](https://github.com/CubicPill/china_southern_power_grid_stat)（GPL-3.0）。

---

## 目录

```
csg/
├── csg.js                      # Surge 脚本（远程引用）
├── profiles/
│   └── csg.surge.sgmodule      # Surge 模块
├── scriptable/
│   └── csg-widget.js           # Scriptable 小组件
└── README.md
```

---

## 一、安装 Surge 模块

Surge → **模块** → 安装：

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/profiles/csg.surge.sgmodule
```

脚本地址已写死在模块内（本仓库 raw），无需再配 `SCRIPT`。

### 模块参数

| 参数 | 作用 |
|------|------|
| `TIMEOUT` | 小组件拉数时脚本超时秒数，建议 `120` |
| `调试模式` | `true` 时在脚本控制台输出详细请求日志 |

### 模块内脚本

| 脚本 | 作用 |
|------|------|
| **南网Token捕获** | 拦截 `95598.csg.cn`，保存 `x-auth-token` |
| **南网小组件接口** | 重写 `api.csg-rewrite.com/electricity/bill/all`，返回 JSON |

### 打开开关

- 开启 **MitM**、**脚本**、**模块**
- 已安装并信任 Surge CA
- MITM 主机含：`95598.csg.cn`、`api.csg-rewrite.com`

---

## 二、捕获 Token

1. iPhone 保持 **Surge 接管**
2. 打开 **南网在线** App 并登录
3. 进入 **电费 / 用电量** 页面点几下
4. 成功会提示：`登录态已更新`

Token 存在 Surge `$persistentStore`：

- `csg_auth_token`
- `csg_cust_number`

过期后重新打开 App 走一遍即可。

---

## 三、Scriptable 小组件

1. Scriptable 新建脚本，粘贴：

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/scriptable/csg-widget.js
```

2. 桌面添加小组件并选中该脚本  
3. **刷新时保持 Surge 开启**

### 可选参数（Parameter）

```json
{
  "url": "https://api.csg-rewrite.com/electricity/bill/all",
  "index": 0,
  "showRecent": true,
  "refreshMinutes": 60
}
```

- `index`：多户号时选第几个（从 0 开始；接口返回全部户号）  
- `showRecent`：中/大尺寸是否显示近五日柱状图  
- `refreshMinutes`：提示 iOS 约多少分钟后再刷新（默认 60，仅建议）  

Logo 使用仓库内 `scriptable/assets/csg.png`（首次运行会下载并缓存到本机）。  
支持系统 **浅色 / 深色** 外观自动切换。空字段（如本月电费为 null）不再显示 `--`。  

### 数据流

```
Scriptable ──GET──► https://api.csg-rewrite.com/electricity/bill/all
                         │
                    Surge 重写
                         │
                      csg.js（已存 Token → 调 95598.csg.cn）
                         │
                      返回 JSON 数组
```

---

## 四、接口 JSON

`GET/POST https://api.csg-rewrite.com/electricity/bill/all`

默认返回 **全部绑定户号**。结构示例：

```json
[
  {
    "userInfo": {
      "accountNumber": "缴费号",
      "userName": "户名",
      "address": "用电地址",
      "areaCode": "030000",
      "eleCustId": "bindingId"
    },
    "eleBill": {
      "balance": 128.5,
      "arrears": 0,
      "sumMoney": 128.5,
      "historyOwe": 0
    },
    "dayElecQuantity": {
      "yesterday": 6.2,
      "recent": [{ "date": "2026-07-15", "kwh": 5.1 }]
    },
    "dayElecQuantity31": { "byDay": [] },
    "monthElecQuantity": {
      "totalKwh": 186,
      "totalCost": 98.3,
      "year": { "yearKwh": 980, "yearCost": 520, "byMonth": [] },
      "lastMonth": { "totalKwh": 210, "totalCost": 112 }
    },
    "stepElecQuantity": {
      "ladder": 1,
      "remainKwh": 120,
      "tariff": 0.59
    },
    "arrearsOfFees": false
  }
]
```

---

## 五、常见问题

**小组件无数据**

- Surge VPN / MitM / 脚本 / 模块是否开启  
- 是否已在南网 App 里触发 Token 捕获  

**Token 失效**

重新打开「南网在线」进入用电页即可。

**调试**

模块「调试模式」设 `true`，看 Surge 脚本控制台。

---

## 六、风险说明

- 非官方实现，接口变更可能导致失效  
- Token 保存在本机 Surge 中，勿泄露调试日志  
- 仅供个人学习与自用  
