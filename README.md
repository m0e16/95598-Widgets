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

## 说明

非官方；接口可能变更。API 参考 [china_southern_power_grid_stat](https://github.com/CubicPill/china_southern_power_grid_stat)。
