"""
359度 Debug · L3 Pages 后端 API Mixin

注册 Web API 端点供前端 Dashboard 调用。
所有端点注册时带 /{PLUGIN_NAME}/ 前缀；前端 bridge.apiGet("xxx") 自动补全。
"""
from __future__ import annotations

import json
from typing import Any

from astrbot.api import logger

PLUGIN_NAME = "astrbot_plugin_359_debug"


class WebApiMixin:
    """Pages 后端 API。依赖所有 L2 Mixin 的查询方法。"""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._register_web_apis()

    def _register_web_apis(self) -> None:
        """注册所有 API 端点。"""
        ctx = self.context
        endpoints = [
            ("/overview", self._api_overview, ["GET"], "359体检总览"),
            ("/runtime", self._api_runtime, ["GET"], "运行时间详情"),
            ("/token", self._api_token, ["GET"], "Token详情"),
            ("/context", self._api_context, ["GET"], "上下文详情"),
            ("/tool", self._api_tool, ["GET"], "工具调用详情"),
            ("/log", self._api_log, ["GET"], "日志详情"),
            ("/plugin", self._api_plugin, ["GET"], "插件分析详情"),
            ("/hooks", self._api_hooks, ["GET"], "钩子全景与冲突"),
            ("/lock", self._api_lock, ["GET"], "会话锁详情"),
            ("/settings", self._api_get_settings, ["GET"], "读取配置"),
            ("/settings", self._api_save_settings, ["POST"], "保存配置"),
            ("/theme", self._api_get_theme, ["GET"], "读取主题"),
            ("/theme", self._api_save_theme, ["POST"], "保存主题"),
            ("/scan", self._api_scan, ["POST"], "手动触发扫描"),
            ("/ai_provider", self._api_ai_provider, ["GET"], "查询默认AI Provider"),
            ("/ai_checkup", self._api_ai_checkup, ["POST"], "AI智能体检"),
            ("/live", self._api_live, ["GET"], "实时告警SSE"),
            ("/diag", self._api_diag, ["GET"], "钩子链路诊断"),
        ]
        for route, handler, methods, desc in endpoints:
            try:
                ctx.register_web_api(
                    f"/{PLUGIN_NAME}{route}", handler, methods, desc
                )
            except Exception as e:
                logger.warning(f"[359debug] 注册 API {route} 失败: {e}")

    # ==================== API 端点实现 ====================

    async def _api_overview(self) -> Any:
        """359 体检总览。"""
        try:
            from quart import jsonify
        except ImportError:
            return {"error": "quart not available"}

        radar = {
            "runtime": self.get_runtime_health(),
            "token": self.get_token_health(),
            "context": self.get_context_health(),
            "tool": self.get_tool_health(),
            "log": self.get_log_health(),
            "plugin": await self.get_plugin_health(),
            "lock": self.get_lock_health(),
        }
        score = round(sum(radar.values()) / len(radar)) if radar else 0
        level = "优秀" if score >= 90 else "良好" if score >= 75 else "一般" if score >= 60 else "需关注"

        def _status(s: int) -> str:
            return "ok" if s >= 80 else "warn" if s >= 60 else "error"

        def _summary(oneliner: str) -> str:
            """从一行摘要中提取简短描述。"""
            try:
                return oneliner.split("▸")[-1].split("|")[0].strip()
            except Exception:
                return ""

        modules = [
            {"key": "runtime", "title": "运行时", "score": radar["runtime"],
             "summary": _summary(self.fmt_runtime_oneline()),
             "status": _status(radar["runtime"]), "detailRoute": "/runtime",
             "icon": "⏱"},
            {"key": "token", "title": "Token", "score": radar["token"],
             "summary": _summary(self.fmt_token_oneline()),
             "status": _status(radar["token"]), "detailRoute": "/token",
             "icon": "🪙"},
            {"key": "context", "title": "上下文", "score": radar["context"],
             "summary": _summary(self.fmt_context_oneline()),
             "status": _status(radar["context"]), "detailRoute": "/context",
             "icon": "📝"},
            {"key": "tool", "title": "工具", "score": radar["tool"],
             "summary": _summary(self.fmt_tool_oneline()),
             "status": _status(radar["tool"]), "detailRoute": "/tool",
             "icon": "🔧"},
            {"key": "log", "title": "日志", "score": radar["log"],
             "summary": _summary(self.fmt_log_oneline()),
             "status": _status(radar["log"]), "detailRoute": "/log",
             "icon": "📋"},
            {"key": "plugin", "title": "插件", "score": radar["plugin"],
             "summary": "见详情",
             "status": _status(radar["plugin"]), "detailRoute": "/plugin",
             "icon": "🧩"},
            {"key": "lock", "title": "会话锁", "score": radar["lock"],
             "summary": _summary(self.fmt_lock_oneline()),
             "status": _status(radar["lock"]), "detailRoute": "/lock",
             "icon": "🔒"},
        ]
        return jsonify({
            "score": score,
            "level": level,
            "radar": radar,
            "modules": modules,
            "alerts": self.recent_alerts(20),
        })

    async def _api_runtime(self) -> Any:
        from quart import jsonify, request
        umo = request.args.get("umo")
        since = float(request.args.get("since", 0)) or None
        return jsonify(await self.get_runtime_detail(umo=umo, since=since))

    async def _api_token(self) -> Any:
        from quart import jsonify, request
        provider = request.args.get("provider")
        since = float(request.args.get("since", 0)) or None
        group_by = request.args.get("group_by", "model")
        report = await self.get_token_report(provider=provider, since=since, group_by=group_by)
        return jsonify(report)

    async def _api_context(self) -> Any:
        from quart import jsonify, request
        umo = request.args.get("umo")
        limit = int(request.args.get("limit", 20))
        return jsonify(await self.get_context_detail(umo=umo, limit=limit))

    async def _api_tool(self) -> Any:
        from quart import jsonify, request
        name = request.args.get("name")
        since = float(request.args.get("since", 0)) or None
        report = self.get_tool_report(name=name, since=since)
        report["agent_trajectories"] = self.get_agent_trajectory()
        return jsonify(report)

    async def _api_log(self) -> Any:
        from quart import jsonify, request
        level = request.args.get("level")
        plugin = request.args.get("plugin")
        raw_limit = request.args.get("limit", "500")
        if raw_limit == "all":
            limit = -1  # -1 表示读取全部
        else:
            try:
                limit = int(raw_limit)
            except ValueError:
                limit = 500
        return jsonify(await self.get_log_detail(level=level, plugin=plugin, limit=limit))

    async def _api_plugin(self) -> Any:
        from quart import jsonify
        return jsonify(await self.get_plugin_detail())

    async def _api_hooks(self) -> Any:
        """钩子全景图与冲突检测。"""
        from quart import jsonify
        try:
            from quart import request
            include_self = request.args.get("include_self", "false").lower() in ("1", "true", "yes")
            return jsonify(self.scan_hooks(include_self=include_self))
        except Exception as e:
            return jsonify({"error": str(e), "groups": [], "conflicts": []})

    async def _api_lock(self) -> Any:
        from quart import jsonify
        return jsonify(await self.get_lock_detail())

    async def _api_get_settings(self) -> Any:
        from quart import jsonify
        return jsonify({"config": dict(self._cfg)})

    async def _api_save_settings(self) -> Any:
        from quart import jsonify, request
        try:
            data = await request.get_json()
            new_config = data.get("config", data)
            updated = await self.update_config(new_config)
            return jsonify({"ok": True, "config": updated})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    async def _api_get_theme(self) -> Any:
        from quart import jsonify
        theme = await self.get_theme()
        return jsonify({"theme": theme})

    async def _api_save_theme(self) -> Any:
        from quart import jsonify, request
        try:
            data = await request.get_json()
            theme = data.get("theme", "light")
            saved = await self.save_theme(theme)
            return jsonify({"ok": True, "theme": saved})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    async def _api_scan(self) -> Any:
        from quart import jsonify, request
        try:
            data = await request.get_json()
            scan_type = data.get("type", "security")
            if scan_type == "security":
                alerts = self.scan_security()
                return jsonify({"alerts": alerts})
            return jsonify({"error": f"未知扫描类型: {scan_type}"})
        except Exception as e:
            return jsonify({"error": str(e)})

    async def _api_ai_provider(self) -> Any:
        """查询当前默认 AI Provider（用于按钮下方小字展示）。"""
        from quart import jsonify
        try:
            provider_id = self._get_default_provider_id()
            provider_name = self._get_provider_display_name(provider_id)
            return jsonify({
                "provider_id": provider_id,
                "provider_name": provider_name,
                "available": provider_id is not None,
            })
        except Exception as e:
            return jsonify({
                "provider_id": None,
                "provider_name": None,
                "available": False,
                "error": str(e),
            })

    async def _api_ai_checkup(self) -> Any:
        """执行 AI 智能体检。"""
        from quart import jsonify
        try:
            result = await self.run_ai_checkup()
            return jsonify(result)
        except Exception as e:
            return jsonify({
                "error": f"{type(e).__name__}: {e}",
                "timestamp": int(__import__("time").time()),
            })

    async def _api_live(self) -> Any:
        """SSE 实时告警推送。"""
        from quart import Response
        async def stream():
            async for event in self.subscribe_alerts():
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        return Response(stream(), mimetype="text/event-stream")

    async def _api_diag(self) -> Any:
        """钩子链路诊断报告。"""
        from quart import jsonify
        try:
            report = self.diagnose_hooks()
            return jsonify(report)
        except Exception as e:
            from astrbot.api import logger
            logger.error(f"[359debug] diag 异常: {e}", exc_info=True)
            return jsonify({"error": f"{type(e).__name__}: {e}"})
