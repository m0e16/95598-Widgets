# 95598-Widgets

南方电网（粤 / 桂 / 滇 / 黔 / 琼）电费 **Scriptable 小组件**，经 **Surge** 捕获 Token 并提供接口。

```
csg.js · csg.surge.sgmodule · scriptable/csg-widget.js
```

## 安装

**Surge 模块**

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/csg.surge.sgmodule
```

开启 MitM / 脚本 / 模块，信任 CA。参数：`TIMEOUT`（建议 120）、`调试模式`。

**Scriptable**

```text
https://raw.githubusercontent.com/m0e16/95598-Widgets/main/scriptable/csg-widget.js
```

可选 Parameter：`{"index":0,"showRecent":true,"refreshMinutes":60}`

## 使用

1. Surge 开启 → 打开「南网在线」电费页，捕获 Token  
2. 桌面添加 Scriptable 小组件，刷新时保持 Surge 开启  
3. Token 过期后重复步骤 1  

接口：`https://api.csg-rewrite.com/electricity/bill/all`

诊断：`https://api.csg-rewrite.com/electricity/bill/diag`（只返回头名与掩码值，不含完整凭据）

## 更新日志

**v1.3.0** — 适配 mPaaS 版「南网在线」

App 升级为 mPaaS 小程序容器后，网关路径统一增加了 `/mp` 前缀（如 `/mp/ucs/ma/zt/...`、
`/mp/w2/wx/...`），导致旧版模块的抓取规则 `^https?://95598\.csg\.cn/ucs/ma/` 无法匹配，
Token 永远捕获不到、小组件报「尚无登录态」。

- Token 捕获规则放宽为 `^https?://[^/]*\.csg\.cn/`，不再依赖具体路径前缀
- 接口请求支持 `/mp/ucs/ma/zt/` 与 `/ucs/ma/zt/` 自动回退
- Token 头名候选扩展至 8 个，并记录诊断信息
- 新增 `diag` 诊断入口

> 域名 `95598.csg.cn` 与鉴权头 `x-auth-token` 均未变更。

## 说明

非官方；接口可能变更。API 参考 [china_southern_power_grid_stat](https://github.com/CubicPill/china_southern_power_grid_stat)。
