"""AI 智能体检 Mixin

一键 AI 体检功能：收集所有模块的诊断数据，调用 AstrBot 默认 LLM Provider
进行专业分析，输出结构化的健康结论与改进建议。

方案选择：数据注入上文（非 Agent+Tools）
  - Pages 场景无真实 event，tool_loop_agent 不可用
  - 一次性 llm_generate 调用，快速可靠
  - LLM 扮演"体检医生"角色，逐一分析各模块数据
"""

import json
import time
import traceback
from typing import Any

from astrbot.api import logger


class AiCheckMixin:
    """AI 智能体检功能。"""

    def _get_default_provider_id(self) -> str | None:
        """获取 AstrBot 默认聊天 Provider ID。"""
        try:
            from astrbot.core.provider.manager import ProviderType
            prov = self.context.provider_manager.get_using_provider(
                provider_type=ProviderType.CHAT_COMPLETION,
                umo=None,
            )
            if prov:
                return prov.meta().id
        except Exception:
            pass
        # 回退：取第一个可用的 chat provider
        try:
            for p in self.context.provider_manager.provider_insts:
                meta = p.meta()
                if meta.type == "chat_completion":
                    return meta.id
        except Exception:
            pass
        return None

    def _get_provider_display_name(self, provider_id: str | None) -> str:
        """获取 Provider 的显示名称（模型名 + ID）。"""
        if not provider_id:
            return "未配置"
        try:
            for p in self.context.provider_manager.provider_insts:
                meta = p.meta()
                if meta.id == provider_id:
                    model = getattr(meta, "model_name", None) or provider_id
                    return f"{model} ({provider_id})"
        except Exception:
            pass
        return provider_id

    async def _collect_module_data(self) -> dict[str, Any]:
        """收集所有模块的诊断数据快照。"""
        modules: dict[str, Any] = {}

        # 1. 运行时
        try:
            modules["runtime"] = {
                "score": self.get_runtime_health(),
                "detail": await self.get_runtime_detail(),
            }
        except Exception as e:
            modules["runtime"] = {"score": -1, "error": str(e)}

        # 2. Token
        try:
            modules["token"] = {
                "score": self.get_token_health(),
                "detail": await self.get_token_report(),
            }
        except Exception as e:
            modules["token"] = {"score": -1, "error": str(e)}

        # 3. 上下文
        try:
            modules["context"] = {
                "score": self.get_context_health(),
                "detail": await self.get_context_detail(),
            }
        except Exception as e:
            modules["context"] = {"score": -1, "error": str(e)}

        # 4. 工具
        try:
            modules["tool"] = {
                "score": self.get_tool_health(),
                "detail": self.get_tool_report(),
            }
        except Exception as e:
            modules["tool"] = {"score": -1, "error": str(e)}

        # 5. 日志
        try:
            modules["log"] = {
                "score": self.get_log_health(),
                "detail": await self.get_log_detail(limit=50),
            }
        except Exception as e:
            modules["log"] = {"score": -1, "error": str(e)}

        # 6. 插件
        try:
            modules["plugin"] = {
                "score": self.get_plugin_health(),
                "detail": await self.get_plugin_detail(),
            }
        except Exception as e:
            modules["plugin"] = {"score": -1, "error": str(e)}

        # 7. 会话锁
        try:
            modules["lock"] = {
                "score": self.get_lock_health(),
                "detail": await self.get_lock_detail(),
            }
        except Exception as e:
            modules["lock"] = {"score": -1, "error": str(e)}

        return modules

    def _build_checkup_prompt(self, modules: dict[str, Any]) -> tuple[str, str]:
        """构造 system prompt 和 user prompt。

        返回 (system_prompt, user_prompt)
        """
        system_prompt = (
            "你是 AstrBot 的专业体检医生，负责对机器人运行状态进行全面健康诊断。\n"
            "你将收到7个维度的体检数据，请逐一分析并给出专业结论。\n\n"
            "输出要求（严格 JSON 格式，不要包裹在 markdown 代码块中）：\n"
            "{\n"
            '  "overall": "整体评价（1-2句话概括健康状态）",\n'
            '  "overall_score": 85,\n'
            '  "highlights": ["做得好的方面1", "做得好的方面2"],\n'
            '  "risks": [\n'
            '    {"module": "模块名", "level": "high/medium/low", '
            '"issue": "问题描述", "advice": "改进建议"}\n'
            "  ],\n"
            '  "summary": "总结性建议（1-2句话）"\n'
            "}\n\n"
            "评分标准：90+优秀，75-89良好，60-74需关注，<60需修复。\n"
            "请基于实际数据分析，不要凭空臆测。如果数据不足，如实说明。"
        )

        # 构造各模块数据摘要
        module_sections = []
        module_names = {
            "runtime": "运行时性能",
            "token": "Token 用量",
            "context": "上下文管理",
            "tool": "工具调用",
            "log": "日志错误",
            "plugin": "插件安全",
            "lock": "会话锁",
        }
        for key in ("runtime", "token", "context", "tool", "log", "plugin", "lock"):
            info = modules.get(key, {})
            score = info.get("score", -1)
            name = module_names.get(key, key)
            if score < 0:
                module_sections.append(f"## {name}\n状态：数据获取失败（{info.get('error', '未知错误')}）\n")
                continue
            detail = info.get("detail", {})
            # 精简数据，避免 prompt 过长
            compact = self._compact_module_data(key, detail)
            module_sections.append(
                f"## {name}（健康分：{score}）\n{compact}\n"
            )

        user_prompt = (
            "请对以下 AstrBot 体检数据进行全面诊断分析，输出 JSON 结论：\n\n"
            + "\n".join(module_sections)
        )
        return system_prompt, user_prompt

    def _compact_module_data(self, key: str, detail: dict) -> str:
        """将模块详细数据压缩为 LLM 易读的摘要文本。"""
        try:
            if key == "runtime":
                stages = detail.get("stages", {})
                total_stage = stages.get("total", {})
                total_records = detail.get("total_records", 0)
                return (
                    f"总请求数：{total_stage.get('n', total_records)}，"
                    f"平均耗时：{total_stage.get('avg', 0):.0f}ms，"
                    f"P95耗时：{total_stage.get('p95', 0):.0f}ms\n"
                    f"阶段明细：{json.dumps(stages, ensure_ascii=False)[:500]}"
                )
            elif key == "token":
                t = detail.get("total", {})
                return (
                    f"调用数：{t.get('calls', 0)}，"
                    f"总Token：{t.get('total', 0)}，"
                    f"缓存命中：{t.get('input_cached', 0)}，"
                    f"缓存率：{detail.get('cache_hit_ratio', 0):.1f}%"
                )
            elif key == "context":
                alerts = detail.get("cache_alerts", [])
                diffs = detail.get("prompt_diff", [])
                changes = sum(1 for d in diffs if isinstance(d, dict) and d.get("changed"))
                breakdown = detail.get("token_breakdown", {})
                return (
                    f"缓存告警：{len(alerts)}条，"
                    f"Prompt变更：{changes}次，"
                    f"System Prompt Token：{breakdown.get('total', 0)}\n"
                    f"告警样例：{json.dumps(alerts[:3], ensure_ascii=False)[:400]}"
                )
            elif key == "tool":
                ranking = detail.get("ranking", [])
                fails = sum(1 for r in ranking if r.get("failure_rate", 0) > 0)
                top = ranking[:5]
                return (
                    f"工具数：{len(ranking)}，"
                    f"有失败的工具：{fails}个\n"
                    f"Top工具：{json.dumps(top, ensure_ascii=False)[:500]}"
                )
            elif key == "log":
                by_level = detail.get("total_by_level", {})
                clusters = detail.get("clusters", [])
                return (
                    f"错误统计：{json.dumps(by_level, ensure_ascii=False)}，"
                    f"聚类数：{len(clusters)}\n"
                    f"高频错误：{json.dumps(clusters[:3], ensure_ascii=False)[:500]}"
                )
            elif key == "plugin":
                conflicts = detail.get("conflicts", [])
                lifecycle = detail.get("lifecycle_log", [])
                return (
                    f"冲突数：{len(conflicts)}，"
                    f"生命周期事件：{len(lifecycle)}条\n"
                    f"冲突：{json.dumps(conflicts[:3], ensure_ascii=False)[:400]}"
                )
            elif key == "lock":
                summary = detail.get("summary", {})
                sessions = detail.get("sessions", [])
                danger_sessions = [s for s in sessions if s.get("level") == "danger"]
                warn_sessions = [s for s in sessions if s.get("level") == "warn"]
                return (
                    f"活跃会话：{summary.get('total_sessions', 0)}，"
                    f"高危：{summary.get('danger', 0)}，"
                    f"警告：{summary.get('warning', 0)}，"
                    f"等待者：{summary.get('total_waiters', 0)}，"
                    f"最长持锁：{summary.get('max_hold_secs', 0)}s\n"
                    f"高危会话：{json.dumps(danger_sessions[:3], ensure_ascii=False)[:400]}\n"
                    f"警告会话：{json.dumps(warn_sessions[:3], ensure_ascii=False)[:300]}"
                )
        except Exception:
            pass
        return json.dumps(detail, ensure_ascii=False)[:600]

    async def run_ai_checkup(self) -> dict[str, Any]:
        """执行 AI 智能体检。

        流程：
        1. 获取默认 Provider
        2. 收集所有模块数据
        3. 构造 prompt，调用 LLM
        4. 解析结论，返回结构化结果
        """
        result: dict[str, Any] = {
            "timestamp": int(time.time()),
            "provider_id": None,
            "provider_name": None,
            "modules": {},
            "conclusion": None,
            "raw_text": None,
            "error": None,
        }

        # 1. 获取 Provider
        provider_id = self._get_default_provider_id()
        result["provider_id"] = provider_id
        result["provider_name"] = self._get_provider_display_name(provider_id)
        if not provider_id:
            result["error"] = "未找到可用的聊天模型 Provider，请在 AstrBot 配置中添加 LLM 提供商。"
            return result

        # 2. 收集模块数据
        logger.info("[359debug] AI体检：开始收集模块数据...")
        modules = await self._collect_module_data()
        result["modules"] = {
            k: {"score": v.get("score", -1)}
            for k, v in modules.items()
        }

        # 3. 构造 prompt 并调用 LLM
        system_prompt, user_prompt = self._build_checkup_prompt(modules)
        logger.info(f"[359debug] AI体检：调用 LLM ({provider_id})...")

        try:
            llm_resp = await self.context.llm_generate(
                chat_provider_id=provider_id,
                prompt=user_prompt,
                system_prompt=system_prompt,
            )
            raw_text = llm_resp.completion_text or ""
            result["raw_text"] = raw_text

            # 4. 解析 JSON 结论
            conclusion = self._parse_conclusion(raw_text)
            result["conclusion"] = conclusion

            if conclusion:
                logger.info(
                    f"[359debug] AI体检完成：总分 {conclusion.get('overall_score', '?')}"
                )
            else:
                logger.warning("[359debug] AI体检：LLM 返回内容无法解析为 JSON")

        except Exception as e:
            err_msg = f"{type(e).__name__}: {e}"
            result["error"] = err_msg
            logger.error(f"[359debug] AI体检失败：{err_msg}\n{traceback.format_exc()}")

        return result

    def _parse_conclusion(self, text: str) -> dict | None:
        """从 LLM 返回文本中解析 JSON 结论。

        兼容三种情况：
        - 纯 JSON
        - ```json ... ``` 代码块包裹
        - 混杂其他文本（提取第一个 JSON 对象）
        """
        text = text.strip()

        # 方案1：直接解析
        try:
            return json.loads(text)
        except Exception:
            pass

        # 方案2：提取 ```json ... ``` 代码块
        import re
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            try:
                return json.loads(m.group(1).strip())
            except Exception:
                pass

        # 方案3：提取第一个 { ... } 块
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass

        return None
