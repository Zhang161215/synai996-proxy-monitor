# Synai996 Proxy Monitor

Chrome / Edge 浏览器扩展，一键查看 NewAPI 账户状态。

## 功能

- 钱包余额概览
- 订阅套餐状态与到期时间
- 认证（Session）到期时间显示
- 每日用量趋势图（7 天 / 30 天）
- 今日模型用量分布（甜甜圈图）
- 每日排名
- 三节点连通性检测与延迟测速
- 图标徽章显示剩余百分比（钱包 / 订阅可配置）
- 浅色 / 深色 / 跟随系统主题
- NewAPI Frosted Glass 设计风格

## 安装

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目目录

## 零配置使用

插件支持零配置自动检测：

1. 在浏览器中打开 [synai996.space](https://synai996.space) 并登录
2. 点击插件图标，自动检测登录状态并拉取数据

插件通过 Content Script 自动注入 `synai996.space` 页面，读取 `localStorage.user` 获取用户信息，无需手动配置。

## 手动配置

如果自动检测失败，可以打开插件设置页手动填写：

- **API 服务器地址**：通常为 `https://api.synai996.space`
- **用户 ID**：数字用户 ID
- **Access Token**（可选）：作为 Session 失效时的备用认证方式

也可以点击「从标签页导入」按钮，从已登录的 NewAPI 标签页自动导入。

## 项目结构

```
manifest.json          — MV3 扩展配置
background/
  service-worker.js    — 后台服务（定时刷新、Badge 更新、消息处理）
content/
  detector.js          — Content Script（自动检测登录状态）
popup/
  popup.html           — 弹出面板 HTML
  popup.css            — 弹出面板样式（Frosted Glass 设计系统）
  popup.js             — 弹出面板逻辑（图表、测速、渲染）
options/
  options.html         — 设置页 HTML
  options.css          — 设置页样式
  options.js           — 设置页逻辑
shared/
  api.js               — API 封装（认证、请求、工具函数）
lib/
  chart.min.js         — Chart.js 4.4.7
icons/                 — 扩展图标（16/32/48/128px）
```

## 使用的 API

- `/api/user/self` — 用户资料与余额
- `/api/subscription/self` — 订阅信息
- `/api/subscription/plans` — 套餐列表（名称映射）
- `/api/token/` — API 令牌列表
- `/api/data/self` — 每日用量统计
- `/api/log/self` — 请求日志（模型分布）
- `/api/analytics/daily-ranking` — 每日排名

## 说明

- 本插件不会修改任何 NewAPI 数据，仅做只读查询
- 数据本地缓存，每 5 分钟自动刷新
- 弹出面板支持手动刷新
