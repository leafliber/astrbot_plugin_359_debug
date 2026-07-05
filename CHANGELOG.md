# Changelog

本文件记录 359健康检查插件（`astrbot_plugin_359_debug`）的版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-07-05

首个完整版本。覆盖从数据采集、AI 智能诊断、7 维度分析到可视化的完整链路。

### 新增

#### 数据采集

- `on_llm_request` head / tail 双优先级钩子快照 system_prompt，追踪其他插件对上下文的修改。
- `on_llm_response` 钩子采集 TokenUsage（prompt / completion / total / cached），按模型聚合统计。
- `on_decorating_result` 钩子追踪 LLM 原始输出 → 最终发送之间的消息链变换。
- `on_plugin_error` 钩子捕获插件异常，traceback 指纹去重聚类。
- 运行时阶段计时（enter → llm_start → llm_end → send），计算 P50 / P95 / P99 耗时。

#### 7 维度分析

- **运行时性能** —— 请求阶段耗时分布、LLM 响应百分位、慢请求检测（可配置阈值）。
- **Token 用量** —— 总调用次数 / Token 数 / 缓存命中率，按模型聚合明细表，失败率统计。
- **上下文注入** —— system_prompt 内容与变更历史、Token 构成分解（system / contexts / tools / extra_parts）、缓存破坏检测（连续 N 轮变更告警）、输出链装饰追踪。
- **工具调用** —— 函数调用统计、失败率、Agent 执行轨迹、耗时分布。
- **错误日志** —— 错误聚类（指纹去重）、堆栈提取、级别分布、时间线。
- **插件安全** —— 指令冲突检测、插件生命周期审计、平台调用统计。
- **会话锁死锁检测** —— 反射访问 `session_lock_manager`，检测长时间持锁（>30s 警告 / >120s 高危）、请求堆积（等待者 ≥3）、活跃事件未释放、Agent Runner 未完成。

#### AI 智能体检

- 一键采集 7 个维度数据，交给配置的 LLM Provider 综合分析。
- 输出 JSON 格式体检报告：总体评分、各模块问题、修复建议。
- 两阶段进度动画：采集阶段（7 模块依次点亮 + 扩散脉冲）→ 诊断阶段（大脑图标呼吸 + 波形条跳动）。
- 配有呼吸光晕背景、CTA 流光按钮、进度条流光等完整动画效果。

#### 可视化面板（Plugin Page）

- AstrBot WebUI 内嵌 React 仪表盘，8 个页面：首页 / 运行时 / Token / 上下文 / 工具 / 日志 / 插件 / 会话锁 / 设置。
- 首页：健康分圆环 + 六维雷达图 + 模块卡片 + 告警时间线 + AI 体检入口。
- 大数字 K/M 紧凑格式化，hover 显示完整值。
- 跟随 AstrBot 深色模式。
- 配置通过 KV 存储持久化，自动保存、热生效（无需重载插件）。
- `_conf_schema.json` 仅保留总开关（实际不生效），所有详细设置在 Pages 设置页面修改。

#### 聊天指令

- `/debug runtime|token|ctx|tool|log|plugin|lock|all|help`，别名 `/359`、`/诊断`。
- 默认仅管理员可执行（可配置关闭）。

#### REST API

- 暴露 `/overview` / `/runtime` / `/token` / `/context` / `/tool` / `/log` / `/plugin` / `/lock` / `/settings` / `/theme` / `/scan` / `/ai-check` 等端点，供面板调用。

### 工程

- Mixin 架构：主类组合 `debug_359/` 下 10 个子域 Mixin，职责单一。
- 热重载安全：hook 注册幂等，惰性状态字典。
- 全链路异常降级：hook、命令、API 均捕获异常，绝不拖垮 AstrBot。
- 前端源码 `frontend/`（Vite + React + TypeScript + recharts），构建产物提交 git 以支持零构建部署。

[0.1.0]: https://github.com/leafliber/astrbot_plugin_359_debug/releases/tag/v0.1.0
