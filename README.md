# 疯狂水世界 - 辅助工具

基于 [AutoJs6](https://github.com/SuperMonster003/AutoJs6) 的手游自动化辅助工具，用于"疯狂水世界"游戏。

## 截图

<img src="screenshot/截图1.png" width="200">
<img src="screenshot/截图2.png" width="200">
<img src="screenshot/截图3.png" width="200">

## 功能

- **自动种植** — 收割 → 翻地 → 播种，库存满自动切换作物（7 种可选）
- **自动锻造** — 定时检测并点击锻造按钮，支持枪械/防具/兵刃三种类型，蓝/紫/橙三种级别
- **搁浅商船** — 整点自动出征，支持"整点一次"和"持续检测"两种模式（8:00-22:00）
- **盟战** — 支持集结/进攻/防守三种模式，自动领取奖励（20:00-21:00）
- **悬浮球 + 控制面板** — 随时操控任务，配置持久化到本地
- **累计统计** — 记录每类任务的执行次数，本地持久化
- **兑换码** — 一键复制

## 运行环境

- Android 设备
- [AutoJs6](https://github.com/SuperMonster003/AutoJs6) App
- 屏幕分辨率：1080 × 2400（仅支持此分辨率）
- Android API版本 >= 24

## 运行方式

1. 将项目放到设备 `/sdcard/脚本/水世界/`
2. 在 AutoJs6 中打开 `main.js` 运行
3. 点击主界面右上角启动按钮，授予录屏权限后即可使用

## 运行日志与 AI 分析

每次脚本运行都会将业务日志追加到设备的 `/sdcard/水世界运行日志/`，使用 JSONL 格式记录时间、级别、消息、异常堆栈及可用时的错误截图路径。单个日志分段最大 2 MiB，设备仅保留最近 8 次会话；日志不在脚本同步目录内，因此定向同步代码不会覆盖诊断证据。

在 Windows 上运行以下命令可拉取 MuMu 最新会话的全部日志分段和错误截图，并生成最后 300 行的 AI 分析摘要：

```powershell
pwsh -NoProfile -File .\tools\pull-mumu-runtime-log.ps1
```

有多个 MuMu 实例时，显式指定设备序列号：

```powershell
pwsh -NoProfile -File .\tools\pull-mumu-runtime-log.ps1 -Serial emulator-5556
```

## 项目结构

```
main.js                  # 入口：UI 布局、任务调度、状态管理
modules/
  theme.js               # 颜色常量、作物配置、兑换码数据
  uiHelpers.js           # 日志、统计、导航切换、圆形图标
  floatingPanel.js       # 悬浮球、控制面板、配置持久化
  gameHelper.js          # 图像识别、叠加层显示、资源加载
  plantFood.js           # 种植任务：收割→翻地→播种
  weapon.js              # 锻造任务：检测并锻造
  fleet.js               # 舰队通用操作：空闲检测/勾选/出征
  war.js                 # 盟战任务：集结/进攻/防守
  merchantShip.js        # 搁浅商船任务
  navigate.js            # 场景检测与自动定位
img/                     # 图像识别资源
test/                    # 测试脚本
```

## License

仅供学习交流使用
