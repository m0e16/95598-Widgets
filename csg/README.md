# 南方电网 · Surge + Scriptable

面向 **中国南方电网**（广东 / 广西 / 云南 / 贵州 / 海南）用户的电费电量查询方案。

对标 [网上国网 95598 任务](https://github.com/Yuheng0101/X/blob/main/Tasks/95598/README.md) 的用法：

| 组件 | 作用 |
|------|------|
| **Surge 模块** | 捕获登录态、定时通知、给小组件提供接口 |
| **Scriptable 小组件** | 桌面展示余额 / 本月用电 / 近五日 |

> 南网登录 **不能** 像国网那样只靠账号密码长期自动重登。  
> 官方接口需要 **短信验证码** 或 **扫码**。本方案以 **捕获 Token** 为主，短信登录为辅。

API 逻辑参考开源实现 [CubicPill/china_southern_power_grid_stat](https://github.com/CubicPill/china_southern_power_grid_stat)（GPL-3.0）。本目录脚本为独立编写，便于 Surge / Scriptable 使用。

---

## 目录

```
csg/
├── csg.js                      # Surge 主脚本
├── profiles/
│   └── csg.surge.sgmodule      # Surge 模块
├── scriptable/
│   └── csg-widget.js           # Scriptable 小组件
└── README.md
```

---

## 一、Surge 安装

### 1. 安装模块（推荐）

Surge → **模块** → 安装，订阅地址：

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/profiles/csg.surge.sgmodule
```

模块默认 `SCRIPT` 已指向本仓库 raw 脚本，一般不用再手动粘贴 `csg.js`。

若要改成本地脚本：把 `csg.js` 粘贴进 Surge 新建脚本，再把模块参数 `SCRIPT` 改成该脚本名。

### 2. 模块参数

| 参数 | 建议 |
|------|------|
| `SCRIPT` | 默认本仓库 raw；可改成本地脚本名 |
| `CRONEXP` | `0 9 * * *`（每天 9 点） |
| `AREA` | 你的省份：`广东` / `广西` / `云南` / `贵州` / `海南` |
| `PHONE` | 南网手机号（仅短信登录需要） |
| `近期用量` | `true` 可看近五日 |
| `通知全部户号` | 多户号设 `true` |
| `TIMEOUT` | `120` |

### 3. 打开开关

- 开启 **MitM**、**脚本**、**模块**
- 已安装并信任 Surge CA 证书
- 模块列表中 **南方电网** 为启用状态

模块会追加 MITM 主机：

- `95598.csg.cn`（捕获 Token）
- `api.csg-rewrite.com`（小组件接口，本地重写）

---

## 二、登录（获取 Token）

### 推荐：App 自动捕获

1. iPhone 保持 **Surge 接管**（VPN 开着）
2. 打开 **南网在线** App，登录
3. 进入 **电费 / 用电量** 等相关页面点几下
4. 成功时会弹出通知：`登录态已更新`
5. Surge 脚本里执行一次 **南方电网**，应能收到电费通知

Token 保存在 Surge `$persistentStore`：

- `csg_auth_token`
- `csg_cust_number`

登录态过期后（接口返回未登录），重新打开 App 走一遍即可。

### 备选：短信登录

在 Surge 中手动执行脚本（或改 cron 的 argument）——

**1）发验证码**

```text
action=send_sms&phone=你的手机号&area=广东
```

**2）带验证码登录**

```text
action=login_sms&phone=你的手机号&code=短信验证码&area=广东
```

**密码 + 短信**（可选）：

```text
action=login_pwd_sms&phone=手机号&password=密码&code=验证码&area=广东
```

---

## 三、Scriptable 小组件

1. 打开 Scriptable → 新建脚本  
2. 粘贴下面内容（或从 raw 导入）并保存：

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg/scriptable/csg-widget.js
```

3. 桌面添加 Scriptable 小组件，选中该脚本  
4. **保持 Surge 开启**（小组件通过重写域名拉数）

### 可选参数（小组件 Parameter）

```json
{
  "url": "https://api.csg-rewrite.com/electricity/bill/all",
  "index": 0,
  "showRecent": true
}
```

- `index`：多户号时选第几个（从 0 开始）  
- `showRecent`：是否显示近五日  

### 小组件数据流

```
Scriptable ──GET──► https://api.csg-rewrite.com/electricity/bill/all
                         │
                    Surge 重写
                         │
                      csg.js（用已保存 Token 调 95598.csg.cn）
                         │
                      返回 JSON 数组
```

---

## 四、通知内容示例

```text
户号: 03xxxxxxxxxxxxx
地址: 广东省xx市...
余额: 128.50 元
本月: 186.00 kWh / 98.30 元
上月: 210.00 kWh / 112.00 元
本年: 980.00 kWh / 520.00 元
昨日: 6.20 kWh
阶梯: 第1档 剩余 120.00 kWh 单价 0.59
```

---

## 五、服务模式 JSON 结构

接口：`GET/POST https://api.csg-rewrite.com/electricity/bill/all`

成功时返回数组，每项大致为：

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

字段命名尽量贴近国网小组件习惯，便于以后扩展 UI。

---

## 六、常见问题

**1. 小组件一直报错 / 无数据**

- Surge VPN 是否开启  
- 模块、MitM、脚本是否开启  
- 是否已捕获 Token（先在 App 里打开用电页面）  
- 在 Surge 里手动跑一次「南方电网」看通知  

**2. Token 经常失效**

南网 App 端 Token 比网页久，但仍会过期。过期后重新打开「南网在线」触发捕获即可。脚本 **不会** 在后台自动收短信重登。

**3. 和国网 95598 脚本冲突吗？**

不冲突。主机与路径都不同（`95598.csg.cn` vs 国网域名）。

**4. 区号不对？**

模块参数 `AREA` 填省份名，或直接填：

| 省 | areaCode |
|----|----------|
| 广东 | 030000 |
| 广西 | 040000 |
| 云南 | 050000 |
| 贵州 | 060000 |
| 海南 | 070000 |

**5. 调试**

模块「调试模式」设 `true`，在 Surge 脚本控制台查看请求日志。

---

## 七、风险说明

- 非官方实现，接口变更、风控都可能导致失效  
- Token / 账号信息保存在本机 Surge 存储中，请勿分享调试日志  
- 仅供个人学习与自动化；请遵守南网服务条款与当地法规  

---

## 八、后续可做

- BoxJs 配置面板  
- 多账号切换 UI  
- 桌面小组件深色 / 透明主题  
- 青龙 / Node 环境适配（脚本已留 Node 分支骨架）
