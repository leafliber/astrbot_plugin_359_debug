"""
359度 Debug · L3 指令入口 Mixin

简化指令：仅输出一行摘要，引导用户去 Pages 看详情。
指令组: /debug [runtime|token|ctx|tool|log|plugin|lock|help]  别名: /359, /诊断
"""
from __future__ import annotations

from astrbot.api.event import filter, AstrMessageEvent


class CommandsMixin:
    """简化指令入口。依赖所有 L2 Mixin 的查询方法。"""

    @filter.command_group("debug", alias={"359", "诊断"})
    def debug_group(self):
        """359度 Debug 诊断指令组"""
        pass

    @debug_group.command("help", alias={"帮助", "?"})
    async def cmd_help(self, event: AstrMessageEvent):
        """显示帮助"""
        yield event.plain_result(
            "359度 Debug · 诊断指令\n"
            "  /debug runtime  运行时间分析\n"
            "  /debug token    Token 使用分析\n"
            "  /debug ctx      上下文注入分析\n"
            "  /debug tool     工具调用分析\n"
            "  /debug log      错误日志分析\n"
            "  /debug plugin   插件分析（安全/冲突）\n"
            "  /debug lock     会话锁分析（死锁检测）\n"
            "  /debug all      全部摘要一览\n"
            "—— 完整 360°体检报告请见 WebUI → 插件详情 → Pages"
        )

    @debug_group.command("runtime", alias={"运行", "时间"})
    async def cmd_runtime(self, event: AstrMessageEvent):
        """运行时间分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(self.fmt_runtime_oneline())

    @debug_group.command("token", alias={"令牌", "token"})
    async def cmd_token(self, event: AstrMessageEvent):
        """Token 使用分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(self.fmt_token_oneline())

    @debug_group.command("ctx", alias={"上下文", "context"})
    async def cmd_ctx(self, event: AstrMessageEvent):
        """上下文注入分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(self.fmt_context_oneline())

    @debug_group.command("tool", alias={"工具", "tools"})
    async def cmd_tool(self, event: AstrMessageEvent):
        """工具调用分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(self.fmt_tool_oneline())

    @debug_group.command("log", alias={"日志", "logs"})
    async def cmd_log(self, event: AstrMessageEvent):
        """错误日志分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(self.fmt_log_oneline())

    @debug_group.command("plugin", alias={"插件", "plugins"})
    async def cmd_plugin(self, event: AstrMessageEvent):
        """插件分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(await self.fmt_plugin_oneline())

    @debug_group.command("lock", alias={"锁", "会话锁", "死锁"})
    async def cmd_lock(self, event: AstrMessageEvent):
        """会话锁分析"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        yield event.plain_result(self.fmt_lock_oneline())

    @debug_group.command("all", alias={"全部", "体检"})
    async def cmd_all(self, event: AstrMessageEvent):
        """全部摘要一览"""
        if self._check_admin(event):
            yield event.plain_result("无权限：仅管理员可执行诊断指令。")
            return
        lines = ["359度 Debug · 摘要一览", "─" * 30]
        lines.append(self.fmt_runtime_oneline())
        lines.append(self.fmt_token_oneline())
        lines.append(self.fmt_context_oneline())
        lines.append(self.fmt_tool_oneline())
        lines.append(self.fmt_log_oneline())
        lines.append(await self.fmt_plugin_oneline())
        lines.append(self.fmt_lock_oneline())
        lines.append("─" * 30)
        lines.append("完整 360°体检报告请见 WebUI → 插件详情 → Pages")
        lines.append("钩子链路自诊断请见 WebUI → 插件详情 → Pages → 设置 顶部")
        yield event.plain_result("\n".join(lines))

    def _check_admin(self, event: AstrMessageEvent) -> bool:
        """检查管理员权限，返回 True 表示无权限。"""
        if not self.cfg("admin_only", True):
            return False
        try:
            return not event.is_admin()
        except Exception:
            return False
