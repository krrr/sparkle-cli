# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "requests>=2.28.0",
# ]
# ///

import json
import os
import random
import string
import sys
import time
import requests

# 确保在 Windows 控制台环境下正确输出 UTF-8 字符
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 接口配置
API_URL = "https://opencode.ai/zen/v1/chat/completions"

# OpenCode 匿名免费层 (Public Free Tier) 必须包含的 5 个核心 Agent 工具
# 来源: PR #31 (Upstream requires stream:true + core agent tools: bash, edit, glob, grep, read)
CORE_AGENT_TOOLS = ["bash", "edit", "glob", "grep", "read"]

_last_ts = 0
_ctr = 0
_BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

def gen_opencode_id(desc: bool = False) -> str:
    """
    OpenCode ID 核心生成算法：
    1. 基于毫秒时间戳与自增计数器计算 48-bit 整数 v = ts * 0x1000 + ctr
    2. 若 desc 为 True 则按位取反 v = ~v
    3. 取 6 字节转为 12 位 Hex 字符串
    4. 拼接 14 位基于 Base62 字符集的随机字符
    """
    global _last_ts, _ctr
    ts = int(time.time() * 1000)
    if ts != _last_ts:
        _ctr = 1
        _last_ts = ts
    else:
        _ctr += 1

    v = ts * 0x1000 + _ctr
    if desc:
        v = ~v

    time_hex = "".join(f"{(v >> (40 - 8 * i)) & 0xFF:02x}" for i in range(6))
    rnd = "".join(_BASE62_CHARS[b % 62] for b in os.urandom(14))
    return f"{time_hex}{rnd}"

def generate_opencode_id(prefix: str, desc: bool = None) -> str:
    """
    生成符合 OpenCode 校验规范的 ID (前缀 + '_' + 12位动态 Hex + 14位随机 Base62 字符)
    """
    if desc is None:
        desc = (prefix == "ses")
    return f"{prefix}_{gen_opencode_id(desc=desc)}"

def build_tool(name: str) -> dict:
    """构建最小化的工具定义 Schema"""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": f"Agent tool {name}",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    }

def ensure_core_tools(custom_tools: list = None) -> list:
    """
    检查并自动补齐 5 个核心 Agent 工具 (bash, edit, glob, grep, read)
    """
    tools = list(custom_tools) if custom_tools else []
    declared_names = set()
    for t in tools:
        if isinstance(t, dict):
            fn = t.get("function", {})
            name = fn.get("name") or t.get("name")
            if name:
                declared_names.add(name)

    for core_tool in CORE_AGENT_TOOLS:
        if core_tool not in declared_names:
            tools.append(build_tool(core_tool))
            declared_names.add(core_tool)

    return tools

def iter_sse_events(response):
    """
    健壮的 SSE 流解析器：
    正确处理跨行、多行 data 块以及 UTF-8 多字节字符拼接
    """
    buffer = []
    for raw_line in response.iter_lines(decode_unicode=False):
        if not raw_line:
            if buffer:
                combined_data = b"\n".join(buffer).decode("utf-8", errors="replace").strip()
                if combined_data:
                    yield combined_data
                buffer = []
            continue

        if raw_line.startswith(b"data: "):
            buffer.append(raw_line[6:])
        elif raw_line.startswith(b"data:"):
            buffer.append(raw_line[5:])
        else:
            # 兼容非 data: 开头的多行续写
            if buffer:
                buffer.append(raw_line)

    if buffer:
        combined_data = b"\n".join(buffer).decode("utf-8", errors="replace").strip()
        if combined_data:
            yield combined_data

def call_opencode_mimo(
    prompt: str = "你好，请用一句话回答：1+1等于几？",
    model: str = "mimo-v2.6-flash-free",
    show_reasoning: bool = True
):
    headers = {
        "Accept": "text/event-stream",
        "Authorization": "Bearer public",
        "Content-Type": "application/json",
        "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
        "x-opencode-client": "cli",
        "x-opencode-project": "global",
        "x-opencode-request": generate_opencode_id("msg", desc=False),
        "x-opencode-session": generate_opencode_id("ses", desc=True),
    }

    # 构造满足规则的 tools 数组（必须包含 bash、edit、glob、grep、read）
    tools = ensure_core_tools()

    payload = {
        "model": model,
        "stream": True,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ],
        "tools": tools
    }

    print(f"[*] 目标 URL   : {API_URL}")
    print(f"[*] 模型名称   : {payload['model']}")
    print(f"[*] 流式传输   : {payload['stream']}")
    print(f"[*] tools 列表 : {[t['function']['name'] for t in payload['tools']]}")
    print(f"[*] 用户问题   : {prompt}")
    print("-" * 60)

    try:
        response = requests.post(
            API_URL,
            headers=headers,
            json=payload,
            stream=True,
            timeout=60
        )

        print(f"[*] HTTP 状态码: {response.status_code}")

        if response.status_code != 200:
            print(f"[!] 请求失败，HTTP 状态码: {response.status_code}")
            print(f"[!] 响应内容: {response.text}")
            return

        in_reasoning = False
        in_content = False

        for data_str in iter_sse_events(response):
            if data_str == "[DONE]":
                break

            try:
                data = json.loads(data_str)
                choices = data.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})

                # 1. 深度思考 / 推理过程 (reasoning)
                reasoning = delta.get("reasoning")
                if reasoning and show_reasoning:
                    if not in_reasoning:
                        print("\n[思考过程]:\n", end="", flush=True)
                        in_reasoning = True
                    sys.stdout.write(reasoning)
                    sys.stdout.flush()

                # 2. 回答内容 (content)
                content = delta.get("content")
                if content:
                    if in_reasoning and not in_content:
                        print("\n\n[回答内容]:\n", end="", flush=True)
                        in_content = True
                    elif not in_content:
                        print("\n[回答内容]:\n", end="", flush=True)
                        in_content = True
                    sys.stdout.write(content)
                    sys.stdout.flush()

                # 3. 工具调用 (tool_calls)
                tool_calls = delta.get("tool_calls")
                if tool_calls:
                    print(f"\n[Tool Call] {json.dumps(tool_calls, ensure_ascii=False)}")

            except json.JSONDecodeError:
                # 遇到非标准 JSON 时打印原始信息
                print(f"\n[Raw Data] {data_str}")

        print("\n" + "=" * 60)
        print("[*] 流式响应完成。")

    except requests.exceptions.RequestException as e:
        print(f"\n[!] 网络请求异常: {e}")

if __name__ == "__main__":
    prompt_arg = sys.argv[1] if len(sys.argv) > 1 else "请写一个Python快速排序函数"
    model_arg = sys.argv[2] if len(sys.argv) > 2 else "mimo-v2.6-flash-free"
    call_opencode_mimo(prompt=prompt_arg, model=model_arg)
