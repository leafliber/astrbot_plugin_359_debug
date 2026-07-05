# 359健康检查 · AstrBot 插件

<p align="center">
  <img src="https://count.getloli.com/get/@astrbot_plugin_359_debug?theme=moebooru" alt="Visitor Count">
</p>

> 你的 AstrBot 跑了多久，你真的了解它的健康状态吗？—— 响应变慢了不知道卡在哪、Token 账单悄悄涨、缓存莫名失效每轮全量计费、插件指令冲突互相打架、会话锁死锁请求堆积无人知晓。

---

## ✨ 它能做什么

- **7 维度全面体检** —— 运行时性能 / Token 用量 / 上下文注入 / 工具调用 / 错误日志 / 插件冲突 / 会话锁死锁，一站式覆盖 AstrBot 全部健康指标。
- **一键 AI 智能诊断** —— 点一个按钮，自动采集 7 个维度数据交给 LLM 综合分析，输出体检报告与健康评分，告诉你哪里有问题、该怎么修。
- **会话锁死锁检测（独家）** —— 反射访问 AstrBot 内部 `session_lock_manager`，找出长时间持锁、请求堆积、疑似死锁的会话，before 你的 Bot 卡死用户才来投诉。
- **缓存破坏诊断** —— head / tail 双钩子快照 system_prompt，自动检测连续多轮变更导致的 prompt cache 失效（成本暴增 7-20 倍的元凶）。
- **上下文归因** —— 每轮请求拆解 system_prompt / contexts / tools / extra_parts 各占多少 token，找出谁在悄悄吃 token。
- **错误聚类** —— traceback 指纹去重，把 500 条堆栈收敛成 3 个根因，不再被日志淹没。
- **可视化 Dashboard** —— AstrBot WebUI 内嵌 React 仪表盘，8 个页面，健康分圆环 + 六维雷达图 + 模块卡片 + 告警时间线，所见即所得。
- **聊天指令即时查** —— `/debug runtime|token|ctx|tool|log|plugin|lock|all`，对话里一秒出摘要。
- **零额外依赖** —— 复用 AstrBot 自带栈，装上即跑。

---

## 📦 安装

两种安装方式（推荐方式1）：

1. 在 AstrBot 管理面板，插件 → AstrBot 插件 → 右下角 + 号 → 从链接安装，复制本页面的链接到对话框安装：
   https://github.com/leafliber/astrbot_plugin_359_debug
2. 把本插件目录直接放入 AstrBot 的 `data/plugins/`

重启 AstrBot，或通过 WebUI「插件管理」重载本插件。**无第三方依赖**，复用 AstrBot 自带环境。

> 最低版本要求：AstrBot ≥ 4.24.2

---

## 🚀 快速开始（3 分钟）

1. **装好插件** → WebUI 插件详情中出现「359健康检查」Dashboard 页面。
2. **打开 Dashboard** → 首页看到健康分圆环 + 六维雷达图 + 各模块卡片。
3. **点「一键 AI 智能体检」** → 自动采集 7 个维度数据 → LLM 综合分析 → 输出体检报告。
4. **发几条消息** → 回到 Dashboard 各详情页看数据实时刷新。
5. **在聊天里发 `/debug all`** → 一秒出 7 个维度摘要。

到这一步，你已经有了完整的 Bot 健康监控。下面的「功能详解」给出每个模块的深度玩法。

---

## 🖥 可视化面板（WebUI）

WebUI 内嵌 8 个页面，配置通过 KV 存储持久化，改动**自动保存、热生效**。

| 页面 | 功能 |
| --- | --- |
| **首页** | 健康分圆环 + 六维雷达图 + 模块卡片 + 告警时间线 + 一键 AI 体检入口 |
| **运行时** | 请求阶段耗时分布、LLM 响应 P50/P95/P99、慢请求列表、运行时事件时间线 |
| **Token** | 总调用次数 / Token 数 / 缓存命中率、按模型聚合的用量明细表 |
| **上下文** | system_prompt 内容与变更历史、Token 构成饼图、缓存破坏告警、输出链装饰追踪 |
| **工具** | 函数调用统计、失败率、Agent 执行轨迹、耗时分布 |
| **日志** | 错误聚类（指纹去重）、堆栈提取、级别分布、时间线 |
| **插件** | 指令冲突检测、插件生命周期审计、平台调用统计 |
| **会话锁** | 各会话持锁状态 / 等待者数 / 持锁时长 / 风险等级、活跃事件数、Agent Runner 状态 |
| **设置** | 6 个模块开关、4 个阈值配置、指令前缀、管理员限制、存储方式（KV 持久化） |

---

## 🎯 功能详解

### 一键 AI 智能体检

首页点击「一键 AI 智能体检」按钮，插件会：

1. **采集阶段** —— 依次采集 7 个模块的数据，每个模块三态切换（待命 → 采集中 → 完成），底部进度条实时填充。
2. **诊断阶段** —— 将 7 个维度的数据交给配置的 LLM Provider 综合分析，输出 JSON 格式的体检报告：总体评分、各模块问题、修复建议。
3. **报告展示** —— 体检结论以展开动画呈现，包含健康评分、风险项、建议操作。

体检过程配有完整动画：呼吸光晕背景、CTA 流光按钮、模块扩散脉冲、进度条流光、大脑图标诊断动画。

### 会话锁死锁检测

AstrBot 通过 `session_lock_manager` 对每个会话的 LLM 请求串行化。当 LLM Provider 网络挂起、工具调用卡住或 MCP 执行无返回时，该锁可能被长时间持有，导致同会话后续消息全部堆积。

本模块通过只读反射访问 AstrBot 内部数据结构（不修改任何状态），检测：

- **长时间持锁** —— 持锁超过 30s 警告，超过 120s 高危。
- **请求堆积** —— 等待者数 ≥ 3 视为锁堆积。
- **活跃事件未释放** —— 事件长期不释放 = pipeline 卡住。
- **Agent Runner 未完成** —— LLM/工具循环卡住。

风险等级：`danger`（疑似死锁）/ `warn`（锁堆积）/ `ok`（正常）。会话标识（UMO）已脱敏显示。

### 缓存破坏诊断

在 `on_llm_request` 的 head / tail 双优先级钩子中快照 system_prompt：

- **head 钩子**（priority=100000）—— 其他插件修改前记录原态。
- **tail 钩子**（priority=-100000）—— 其他插件修改后记录最终状态。
- 连续 N 轮（可配置，默认 3）system_prompt 各不相同 → 触发缓存破坏告警。

### 上下文归因

每轮 LLM 请求拆解四部分 token 占比：

| 部分 | 来源 | 估算方式 |
| --- | --- | --- |
| system_prompt | `req.system_prompt` | 中英文混合估算 |
| contexts | `req.contexts`（对话历史） | JSON 序列化后估算 |
| tools | `req.func_tool` 工具名称列表 | 拼接后估算 |
| extra_parts | `req.extra_user_content_parts` | 逐段估算求和 |

### 错误聚类

- `on_plugin_error` 钩子捕获插件异常。
- traceback 指纹去重：去除行号、内存地址、时间戳等变化部分，取稳定 MD5 哈希。
- 相同指纹的错误归为一类，展示最近出现时间和累计次数。

### 聊天指令

```
/debug help      显示帮助
/debug runtime   运行时摘要
/debug token     Token 摘要
/debug ctx       上下文摘要
/debug tool      工具调用摘要
/debug log       日志摘要
/debug plugin    插件分析摘要
/debug lock      会话锁摘要
/debug all       全部摘要一览
```

> 指令前缀可在设置页修改，默认 `debug`。别名：`/359`、`/诊断`。
> 默认仅管理员可执行（可在设置页关闭）。

---

## ⚙️ 配置

在 WebUI → 插件详情 → Pages → 设置 页面修改，自动保存、热生效。

框架配置面板（`_conf_schema.json`）仅保留一个总开关（实际不生效），所有详细设置请在 Pages 设置页面修改。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enable_runtime_analysis` | `true` | 运行时性能监控开关 |
| `enable_token_analysis` | `true` | Token 用量统计开关 |
| `enable_context_dump` | `true` | 上下文追踪开关 |
| `enable_tool_analysis` | `true` | 工具调用监控开关 |
| `enable_log_analysis` | `true` | 日志分析开关 |
| `enable_plugin_analysis` | `true` | 插件健康检测开关 |
| `command_prefix` | `debug` | 聊天指令前缀 |
| `admin_only` | `true` | 仅管理员可执行指令 |
| `slow_response_threshold` | `10.0` | 慢响应阈值（秒） |
| `token_alert_threshold` | `10000` | 单次请求 Token 告警阈值 |
| `cache_disruption_rounds` | `3` | 缓存破坏检测轮数 |
| `log_tail_lines` | `500` | 日志读取行数 |
| `token_persist_to` | `kv` | Token 数据持久化方式 |

---

## 🏗 架构

```
main.py                    # 主类，Mixin 组合入口
├── debug_359/
│   ├── store.py           # StoreMixin：配置/KV/缓冲/SSE 总线
│   ├── utils.py           # L0 纯函数工具层（无状态）
│   ├── runtime_mixin.py   # L1 运行时性能
│   ├── token_mixin.py     # L1 Token 用量
│   ├── context_mixin.py   # L2 上下文注入
│   ├── tool_mixin.py      # L3 工具调用
│   ├── log_mixin.py       # L4 日志分析
│   ├── plugin_mixin.py    # L5 插件安全
│   ├── session_lock_mixin.py  # L7 会话锁
│   ├── commands_mixin.py  # 聊天指令
│   ├── ai_check_mixin.py  # AI 智能体检
│   └── webapi_mixin.py    # Web API + Page 路由
├── frontend/              # React + TypeScript + Vite
│   └── src/pages/         # 8 个详情页
├── _conf_schema.json      # 框架面板（仅总开关）
└── metadata.yaml
```

**Mixin 架构**：主类组合 10 个子域 Mixin，职责单一。底层 `StoreMixin` 最先初始化（配置 / KV / 缓冲 / SSE 就绪），业务 Mixin 各自独立采集 + 查询，入口层（指令 / API）依赖上述方法。

**全链路异常降级**：所有 hook、命令、API 均捕获异常，绝不拖垮 AstrBot 主流程。

---

## 📝 许可证

同 AstrBot 主项目。

