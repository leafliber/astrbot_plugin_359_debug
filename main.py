"""359度 Debug —— AstrBot 诊断插件。

架构：Mixin 多继承 + 子包模块化 + Plugin Pages
  L0  debug_359/utils.py        纯函数
  L1  debug_359/store.py        StoreMixin 基础设施
  L2  debug_359/runtime/token/context/tool/log/plugin mixin  业务层
  L3  debug_359/commands_mixin  简化指令入口
      debug_359/webapi_mixin    Pages 后端 API
      Star                      框架基类

六大模块：运行时间 / Token / 上下文注入 / 工具调用 / 错误日志 / 插件安全冲突
交互双通道：/debug 指令（摘要）+ Pages Dashboard（360°体检完整报告）

钩子签名约束（已核对 ``call_event_hook``）：
``on_llm_request`` / ``on_llm_response`` / ``on_waiting_llm_request`` 等事件
钩子走 ``call_event_hook``，其 ``assert iscoroutinefunction(handler)`` ——故这些
钩子 handler **必须是 coroutine**（``async def ... -> None``，**不能 yield**）。
``yield`` 仅用于 ``@filter.command`` 命令 handler（走 ``call_handler`` 洋葱模型）。
"""
from __future__ import annotations

from astrbot.api import star, logger
from astrbot.api.event import filter, AstrMessageEvent

from .debug_359.store import StoreMixin
from .debug_359.runtime_mixin import RuntimeMixin
from .debug_359.token_mixin import TokenMixin
from .debug_359.context_mixin import ContextMixin
from .debug_359.tool_mixin import ToolMixin
from .debug_359.log_mixin import LogMixin
from .debug_359.plugin_mixin import PluginMixin
from .debug_359.commands_mixin import CommandsMixin
from .debug_359.webapi_mixin import WebApiMixin


class Main(
    # 基础设施层（最先初始化：配置/DB/缓冲/SSE 就绪）
    StoreMixin,
    # 业务层（各自独立的采集+查询，互不依赖）
    RuntimeMixin,
    TokenMixin,
    ContextMixin,
    ToolMixin,
    LogMixin,
    PluginMixin,
    # 入口层（依赖上述所有 Mixin 的查询方法）
    CommandsMixin,
    WebApiMixin,
    # 框架基类（最后）
    star.Star,
):
    """359度 Debug 主类。

    继承顺序约定：底层存储 Mixin 在前，业务 Mixin 居中，
    命令 / Web API 等入口型 Mixin 在后，最后是 ``Star``。
    MRO 保证 StoreMixin.__init__ 最先执行（初始化 self._cfg / self._db /
    各类 deque 缓冲 / SSE 总线），供后续 Mixin 的 hook 使用。
    """

    def __init__(self, context: star.Context, config: dict | None = None):
        super().__init__(context, config)
        self.context = context
        self.config = config or {}

    async def initialize(self) -> None:
        """插件初始化。"""
        await self._store_initialize()
        logger.info("[359debug] 359度 Debug 已就绪。发送 /debug help 查看指令，"
                    "WebUI 插件详情查看 360°体检 Dashboard。")

    async def terminate(self) -> None:
        """插件卸载。"""
        await self.save_buf_to_kv()
        logger.info("[359debug] 已卸载，统计数据已持久化。")
