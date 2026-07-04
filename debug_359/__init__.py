"""359度 Debug 核心子模块包。

本包按职责拆分为多个 Mixin，由 ``main.py`` 的 ``Main`` 类多继承组合。
分层结构：
  L0  utils.py        纯函数（格式化/统计/安全执行）
  L1  store.py        StoreMixin（配置/DB查询/KV/缓冲/SSE事件总线）
  L2  runtime/token/context/tool/log/plugin mixin  业务层
  L3  commands_mixin  简化指令入口
      webapi_mixin    Pages 后端 API（RESTful + SSE）

各模块均已完整实现（阶段 0–5）。
"""
