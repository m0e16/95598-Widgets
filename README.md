# 95598-Widgets

iPhone 电费 **Scriptable 小组件**（经 Surge 提供接口）。

面向 **中国南方电网**（广东 / 广西 / 云南 / 贵州 / 海南）：

| 组件 | 作用 |
|------|------|
| **Surge 模块** | 捕获登录态 + 为小组件提供本地接口 |
| **Scriptable 小组件** | 桌面展示余额 / 本月用电 / 近五日 |

> 登录：保持 Surge 开启，打开 **南网在线 App** 进入电费页自动捕获 Token。  
> 无定时通知，仅服务小组件拉数。

API 逻辑参考 [CubicPill/china_southern_power_grid_stat](https://github.com/CubicPill/china_southern_power_grid_stat)（GPL-3.0）。

---

## 目录

```
.
├── csg.js                 # Surge 主脚本
├── csg.surge.sgmodule     # Surge 模块
├── scriptable/
│   ├── csg-widget.js      # Scriptable 小组件
│   └── assets/            # Logo（浅色 / 深色）
└── README.md
```

---

## 安装

### Surge 模块

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg.surge.sgmodule
```

参数：

| 参数 | 作用 |
|------|------|
| `TIMEOUT` | 小组件拉数超时秒数，建议 `120` |
| `调试模式` | `true` 输出详细请求日志 |

模块脚本：

| 脚本 | 作用 |
|------|------|
| **南网Token捕获** | 拦截 `95598.csg.cn`，保存 `x-auth-token` |
| **南网小组件接口** | 重写 `api.csg-rewrite.com/electricity/bill/all` |

请开启 **MitM**、**脚本**、**模块**，并信任 CA。MITM 主机：`95598.csg.cn`、`api.csg-rewrite.com`。

### Scriptable 小组件

新建脚本，粘贴：

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/scriptable/csg-widget.js
```

刷新时保持 Surge 开启。

可选 Parameter（JSON）：

```json
{
  "index": 0,
  "showRecent": true,
  "refreshMinutes": 60
}
```

- `index`：多户号序号（从 0 起）  
- `showRecent`：是否显示近五日  
- `refreshMinutes`：提示 iOS 刷新间隔（仅建议）  

Logo：浅色 `scriptable/assets/csg.png`，深色 `scriptable/assets/csg-white.png`。

---

## 捕获 Token

1. Surge VPN 开启  
2. 打开 **南网在线** → 电费/用电页  
3. 提示「登录态已更新」后即可用小组件  

Token 存于 Surge：`csg_auth_token`、`csg_cust_number`。过期后重新打开 App 即可。

---

## 接口

`GET https://api.csg-rewrite.com/electricity/bill/all`  

返回全部绑定户号的 JSON 数组（余额、用电、年累计等）。字段为 `null` 时小组件不展示该行。

---

## 风险说明

非官方实现，接口变更可能导致失效；Token 仅存本机，勿泄露调试日志。仅供个人学习自用。
