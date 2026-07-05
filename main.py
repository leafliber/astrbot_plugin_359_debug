"""359度 Debug —— AstrBot 诊断插件。

架构：Mixin 多继承 + 子包模块化 + Plugin Pages
  L0  debug_359/utils.py        纯函数
  L1  debug_359/store.py        StoreMixin 基础设施
  L2  debug_359/runtime/token/context/tool/log/plugin mixin  业务层
  L3  debug_359/commands_mixin  简化指令入口
      debug_359/webapi_mixin    Pages 后端 API
      Star                      框架基类

六大模块：运行时间 / Token / 上下文注入 / 工具调用 / 错误日志 / 插件安全冲突
交互双通道：/debug 指令（摘要）+ Pages Dashboard（359°体检完整报告）

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
from .debug_359.session_lock_mixin import SessionLockMixin
from .debug_359.commands_mixin import CommandsMixin
from .debug_359.ai_check_mixin import AiCheckMixin
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
    SessionLockMixin,
    # 入口层（依赖上述所有 Mixin 的查询方法）
    CommandsMixin,
    AiCheckMixin,
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
                    "WebUI 插件详情查看 359°体检 Dashboard。")

    async def terminate(self) -> None:
        """插件卸载。"""
        await self.save_buf_to_kv()
        logger.info("[359debug] 已卸载，统计数据已持久化。")


# === AstrBot Mixin 钩子模块路径修复 ==========================================
# 问题：Mixin 文件中用 @filter 注册的钩子，其 handler.__module__ 指向 Mixin 模块
# （如 data.plugins.xxx.debug_359.runtime_mixin），而非主模块（main）。
# AstrBot 的 get_handlers_by_event_type() 通过 star_map[handler_module_path]
# 查找插件激活状态 —— Mixin 模块路径不在 star_map 中，导致全部钩子被跳过。
# 同理 get_handlers_by_module_name() 用精确匹配做 self 绑定，也找不到 Mixin 钩子。
#
# 修复：模块导入完成（所有 Mixin 的 @filter 已注册）后，将本插件包前缀下
# 所有 handler 的 handler_module_path 统一为主模块路径。
# 时机：此类定义之后、star_manager 处理之前（仍在模块级导入阶段）。
try:
    from astrbot.core.star.star_handler import star_handlers_registry as _shr

    _main_mod = Main.__module__
    _pkg_prefix = _main_mod.rsplit(".", 1)[0] + "."
    _patched = 0
    _all_ours = []
    for _h in list(_shr):
        if _h.handler_module_path.startswith(_pkg_prefix):
            _all_ours.append((_h.handler_name, _h.handler_module_path, _h.event_type.name if _h.event_type else "?"))
            if _h.handler_module_path != _main_mod:
                _h.handler_module_path = _main_mod
                _patched += 1
    if _patched:
        logger.info(
            f"[359debug] ✓ 已修复 {_patched} 个 Mixin 钩子的模块路径 "
            f"(主模块={_main_mod}, 包前缀={_pkg_prefix})"
        )
    elif _all_ours:
        logger.info(f"[359debug] 钩子模块路径无需修复（{len(_all_ours)}个钩子已在主模块下）")
    else:
        logger.warning(
            f"[359debug] ⚠ 未找到任何属于本包的钩子！主模块={_main_mod}, 前缀={_pkg_prefix}。"
            f"这意味着 Mixin 的 @filter 装饰器可能未执行。"
        )
except Exception as _e:
    logger.warning(f"[359debug] Mixin 钩子模块路径修复失败: {_e}", exc_info=True)
# === end fix =================================================================
