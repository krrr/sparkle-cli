# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "fastapi>=0.100.0",
#     "httpx>=0.25.0",
#     "uvicorn>=0.22.0",
# ]
# ///

"""
OpenCode Zen to OpenAI API Proxy
将标准的 OpenAI / AI Agent completion 请求转换为符合 OpenCode Zen 免费层规则的请求，
支持双向工具名映射 (run_shell_command, replace, glob, grep_search, read_file <-> bash, edit, glob, grep, read)、
流式及非流式响应转换、思考过程 (Reasoning) 保留。
"""

import argparse
import json
import os
import random
import string
import sys
import threading
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

# 确保在 Windows 控制台环境下正确输出 UTF-8
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 默认上游目标
UPSTREAM_BASE_URL = "https://opencode.ai/zen"
UPSTREAM_CHAT_URL = f"{UPSTREAM_BASE_URL}/v1/chat/completions"
UPSTREAM_MODELS_URL = f"{UPSTREAM_BASE_URL}/v1/models"

# 访问凭证控制 
API_KEY = "lajiopencode"

# OpenCode 匿名免费层必须的 5 个核心 Agent 工具
CORE_AGENT_TOOLS = ["bash", "edit", "glob", "grep", "read"]

# 默认客户端 -> 上游 工具名映射
DEFAULT_TOOL_MAP = {
    "run_shell_command": "bash",
    "replace": "edit",
    "glob": "glob",
    "grep_search": "grep",
    "read_file": "read",
    "bash": "bash",
    "edit": "edit",
    "grep": "grep",
    "read": "read",
}

app = FastAPI(title="OpenCode Zen OpenAI Proxy", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_id_lock = threading.Lock()
_last_ts = 0
_ctr = 0
_BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_current_ses_id = None
_current_ses_id_time = 0

def _gen_opencode_id(is_ses: bool = False) -> str:
    """
    OpenCode ID 核心生成算法：
    1. 基于毫秒时间戳与自增计数器计算 48-bit 整数 v = ts * 0x1000 + ctr
    2. 若 is_ses 为 True 则按位取反 v = ~v
    3. 取 6 字节转为 12 位 Hex 字符串
    4. 拼接 14 位基于 Base62 字符集的随机字符
    """
    global _last_ts, _ctr
    with _id_lock:
        ts = int(time.time() * 1000)
        if ts != _last_ts:
            _ctr = 1
            _last_ts = ts
        else:
            _ctr += 1
        current_ctr = _ctr

    v = ts * 0x1000 + current_ctr
    if is_ses:
        v = ~v

    time_hex = "".join(f"{(v >> (40 - 8 * i)) & 0xFF:02x}" for i in range(6))
    rnd = "".join(_BASE62_CHARS[b % 62] for b in os.urandom(14))
    return f"{time_hex}{rnd}"

def generate_opencode_id(prefix: str) -> str:
    """生成符合 OpenCode 校验规范的 ID (前缀 + '_' + 12位动态 Hex + 14位随机 Base62 字符)"""
    return f"{prefix}_{_gen_opencode_id(prefix == "ses")}"

def build_minimal_tool(name: str) -> dict:
    """构建最小化的工具定义 Schema"""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": f"Agent tool {name}",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    }

def transform_tools(
    client_tools: Optional[List[dict]],
    tool_map: Dict[str, str]
) -> Tuple[List[dict], Dict[str, str]]:
    """
    转换 tools 列表：
    1. 将客户端工具名映射为上游工具名
    2. 补齐缺失的核心 Agent 工具 (bash, edit, glob, grep, read)
    3. 返回转换后的 tools 列表与反向映射字典 (upstream_name -> client_name)
    """
    reverse_map: Dict[str, str] = {}
    transformed_tools: List[dict] = []
    declared_upstream_names = set()

    if client_tools:
        for tool in client_tools:
            if not isinstance(tool, dict):
                continue
            tool_copy = json.loads(json.dumps(tool))
            fn = tool_copy.get("function", {})
            orig_name = fn.get("name") or tool_copy.get("name")

            if orig_name:
                mapped_name = tool_map.get(orig_name, orig_name)
                # 记录反向映射（上游工具名 -> 客户端原始工具名）
                reverse_map[mapped_name] = orig_name
                declared_upstream_names.add(mapped_name)

                if "function" in tool_copy and "name" in tool_copy["function"]:
                    tool_copy["function"]["name"] = mapped_name
                elif "name" in tool_copy:
                    tool_copy["name"] = mapped_name

            transformed_tools.append(tool_copy)

    # 补齐 5 个核心工具
    for core_tool in CORE_AGENT_TOOLS:
        if core_tool not in declared_upstream_names:
            transformed_tools.append(build_minimal_tool(core_tool))
            declared_upstream_names.add(core_tool)

    return transformed_tools, reverse_map

def transform_messages(messages: List[dict], tool_map: Dict[str, str]) -> List[dict]:
    """
    转换历史对话中的 tool_calls 及 tool 响应名称
    """
    new_messages = []
    for msg in messages:
        if not isinstance(msg, dict):
            new_messages.append(msg)
            continue
        msg_copy = json.loads(json.dumps(msg))

        # 转换 assistant 的 tool_calls 里的工具名
        if "tool_calls" in msg_copy and isinstance(msg_copy["tool_calls"], list):
            for tc in msg_copy["tool_calls"]:
                fn = tc.get("function", {})
                if fn.get("name") in tool_map:
                    fn["name"] = tool_map[fn["name"]]

        # 转换 role: tool 消息里的 name 属性（若有）
        if msg_copy.get("role") == "tool" and msg_copy.get("name") in tool_map:
            msg_copy["name"] = tool_map[msg_copy["name"]]

        new_messages.append(msg_copy)
    return new_messages

def reverse_map_tool_calls(tool_calls: List[dict], reverse_map: Dict[str, str]) -> List[dict]:
    """将上游返回的 tool_calls 工具名还原为客户端定义的原始名称"""
    if not tool_calls:
        return tool_calls
    mapped = []
    for tc in tool_calls:
        tc_copy = json.loads(json.dumps(tc))
        fn = tc_copy.get("function", {})
        if fn.get("name") in reverse_map:
            fn["name"] = reverse_map[fn["name"]]
        mapped.append(tc_copy)
    return mapped

def build_upstream_headers(incoming_headers: Dict[str, str]) -> Dict[str, str]:
    """构造发送给 OpenCode Zen 的合法请求头"""
    global _current_ses_id, _current_ses_id_time
    now = time.time()
    if _current_ses_id is None or now - _current_ses_id_time > 3600:
        _current_ses_id = generate_opencode_id("ses")
    _current_ses_id_time = now

    return {
        "Accept": "text/event-stream",
        "Authorization": "Bearer public",
        "Content-Type": "application/json",
        "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
        "x-opencode-client": "cli",
        "x-opencode-project": "test",
        "x-opencode-request": generate_opencode_id("msg"),
        "x-opencode-session": _current_ses_id,
    }

async def stream_generator(
    response: httpx.Response,
    reverse_map: Dict[str, str],
    client_model: str
) -> AsyncGenerator[bytes, None]:
    """流式转发响应并实时逆向映射工具名"""
    buffer = bytearray()
    async for chunk in response.aiter_bytes():
        buffer.extend(chunk)
        while b"\n" in buffer:
            line_bytes, _, remaining = buffer.partition(b"\n")
            buffer = bytearray(remaining)
            line = line_bytes.decode("utf-8", errors="replace").strip()

            if not line:
                continue

            if line.startswith("data: "):
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    yield b"data: [DONE]\n\n"
                    break

                try:
                    data = json.loads(data_str)
                    # 替换返回的 model 名称为客户端请求的模型名称
                    if client_model:
                        data["model"] = client_model

                    choices = data.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        # 兼容 reasoning_content 字段
                        if "reasoning" in delta and "reasoning_content" not in delta:
                            delta["reasoning_content"] = delta["reasoning"]

                        # 逆向映射工具调用名称
                        if "tool_calls" in delta and isinstance(delta["tool_calls"], list):
                            delta["tool_calls"] = reverse_map_tool_calls(delta["tool_calls"], reverse_map)

                    yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")
                except json.JSONDecodeError:
                    yield f"data: {data_str}\n\n".encode("utf-8")
            else:
                pass

async def collapse_stream_to_json(
    response: httpx.Response,
    reverse_map: Dict[str, str],
    client_model: str
) -> Dict[str, Any]:
    """将上游强制流式 (SSE) 的响应折叠并聚合成标准单体 JSON 响应 (Non-streaming)"""
    resp_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created_ts = int(time.time())
    text_content = ""
    reasoning_content = ""
    tool_calls_dict: Dict[int, dict] = {}
    finish_reason = "stop"

    buffer = bytearray()
    async for chunk in response.aiter_bytes():
        buffer.extend(chunk)
        while b"\n" in buffer:
            line_bytes, _, remaining = buffer.partition(b"\n")
            buffer = bytearray(remaining)
            line = line_bytes.decode("utf-8", errors="replace").strip()

            if not line or not line.startswith("data: "):
                continue

            data_str = line[6:].strip()
            if data_str == "[DONE]":
                break

            try:
                data = json.loads(data_str)
                if data.get("id"):
                    resp_id = data["id"]
                if data.get("created"):
                    created_ts = data["created"]

                choices = data.get("choices", [])
                if choices:
                    c0 = choices[0]
                    if c0.get("finish_reason"):
                        finish_reason = c0["finish_reason"]

                    delta = c0.get("delta", {})
                    if delta.get("content"):
                        text_content += delta["content"]
                    if delta.get("reasoning"):
                        reasoning_content += delta["reasoning"]

                    tcs = delta.get("tool_calls")
                    if tcs and isinstance(tcs, list):
                        finish_reason = "tool_calls"
                        for tc in tcs:
                            idx = tc.get("index", 0)
                            if idx not in tool_calls_dict:
                                tool_calls_dict[idx] = {
                                    "id": tc.get("id") or f"call_{uuid.uuid4().hex[:8]}",
                                    "type": "function",
                                    "function": {
                                        "name": tc.get("function", {}).get("name", ""),
                                        "arguments": tc.get("function", {}).get("arguments", ""),
                                    },
                                }
                            else:
                                fn = tc.get("function", {})
                                if fn.get("name"):
                                    tool_calls_dict[idx]["function"]["name"] = fn["name"]
                                if fn.get("arguments"):
                                    tool_calls_dict[idx]["function"]["arguments"] += fn["arguments"]

            except json.JSONDecodeError:
                continue

    # 排序并逆向映射 tool_calls
    sorted_tool_calls = [tool_calls_dict[k] for k in sorted(tool_calls_dict.keys())] if tool_calls_dict else None
    if sorted_tool_calls:
        sorted_tool_calls = reverse_map_tool_calls(sorted_tool_calls, reverse_map)

    message_body: Dict[str, Any] = {
        "role": "assistant",
        "content": text_content if text_content else (None if sorted_tool_calls else ""),
    }
    if reasoning_content:
        message_body["reasoning_content"] = reasoning_content
    if sorted_tool_calls:
        message_body["tool_calls"] = sorted_tool_calls

    return {
        "id": resp_id,
        "object": "chat.completion",
        "created": created_ts,
        "model": client_model,
        "choices": [
            {
                "index": 0,
                "message": message_body,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": len(text_content.split()),
            "total_tokens": len(text_content.split()),
        },
    }

def check_api_key(request: Request):
    """校验客户端 API Key"""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    else:
        token = auth.strip() or request.headers.get("x-api-key", "").strip()

    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")

@app.get("/health")
@app.get("/")
async def health_check():
    return {
        "status": "healthy",
        "service": "opencode-zen-proxy",
        "tool_mapping": DEFAULT_TOOL_MAP,
        "core_tools": CORE_AGENT_TOOLS,
    }

@app.get("/v1/models")
@app.get("/models")
async def list_models(request: Request):
    """
    从上游动态获取模型列表，并过滤掉所有非 -free 结尾的模型
    """
    check_api_key(request)
    headers_dict = dict(request.headers)
    upstream_headers = {
        "Accept": "application/json",
        "Authorization": "Bearer public",
        "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(UPSTREAM_MODELS_URL, headers=upstream_headers)
            if resp.status_code == 200:
                raw_data = resp.json()
                models_list = raw_data.get("data", [])

                # 仅保留以 -free 结尾的模型
                filtered_models = [
                    m for m in models_list
                    if isinstance(m, dict) and m.get("id", "").endswith("-free")
                ]
                return {"object": "list", "data": filtered_models}
            else:
                print(f"[!] 上游获取 models 失败，HTTP {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[!] 请求上游 models 异常: {e}")

    # 异常兜底 fallback 列表（全部为 -free 结尾模型）
    fallback_ids = [
        "mimo-v2.6-flash-free",
        "mimo-v2.5-free",
        "deepseek-v4-flash-free",
        "jev-1.13-free",
        "space-bunny-free",
        "longcat-2.5-preview-free",
        "ling-3.0-flash-fin-free",
        "nemotron-3-ultra-free",
        "nemotron-3.5-lightning-free",
        "muse-spark-1.3-contributor-free",
        "muse-spark-1.2-contributor-free",
    ]
    return {
        "object": "list",
        "data": [
            {
                "id": mid,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "opencode",
                "permission": [],
                "root": mid,
                "parent": None,
            }
            for mid in fallback_ids
        ],
    }

@app.post("/v1/chat/completions")
@app.post("/chat/completions")
async def chat_completions(request: Request):
    """处理 OpenAI 格式的 chat completions 请求"""
    check_api_key(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    client_stream = body.get("stream", False)
    client_model = body.get("model", "mimo-v2.6-flash-free")

    # 模型名称映射
    upstream_model = client_model if client_model.endswith("-free") else client_model + '-free'

    # 工具映射与补齐
    incoming_tools = body.get("tools")
    transformed_tools, reverse_map = transform_tools(incoming_tools, DEFAULT_TOOL_MAP)

    # 历史消息中的工具名映射
    incoming_messages = body.get("messages", [])
    transformed_messages = transform_messages(incoming_messages, DEFAULT_TOOL_MAP)

    # 组装上游 payload（强制 stream: True）
    upstream_payload = {
        "model": upstream_model,
        "stream": True,
        "messages": transformed_messages,
        "tools": transformed_tools,
    }

    # 保留其它可选参数
    for opt_key in ["temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty", "reasoning_effort", "thinking"]:
        if opt_key in body:
            upstream_payload[opt_key] = body[opt_key]

    headers_dict = dict(request.headers)
    upstream_headers = build_upstream_headers(headers_dict)

    print(f"[{time.strftime('%X')}] 收到请求 -> 模型: {client_model} -> 映射: {upstream_model}, 工具数: {len(transformed_tools)}, 流式: {client_stream}")

    client = httpx.AsyncClient(timeout=120.0)
    req = client.build_request("POST", UPSTREAM_CHAT_URL, headers=upstream_headers, json=upstream_payload)
    upstream_resp = await client.send(req, stream=True)

    if upstream_resp.status_code != 200:
        error_body = await upstream_resp.aread()
        await client.aclose()
        print(f"[!] 上游错误 ({upstream_resp.status_code}): {error_body.decode('utf-8', errors='replace')}")
        return Response(
            content=error_body,
            status_code=upstream_resp.status_code,
            media_type="application/json",
        )

    # 如果客户端请求流式，则直接以 SSE 模式流式转发
    if client_stream:
        async def response_wrapper():
            try:
                async for chunk in stream_generator(upstream_resp, reverse_map, client_model):
                    yield chunk
            finally:
                await upstream_resp.aclose()
                await client.aclose()

        return StreamingResponse(
            response_wrapper(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        # 如果客户端请求非流式，则折叠聚合流数据后返回 JSON
        try:
            result_json = await collapse_stream_to_json(upstream_resp, reverse_map, client_model)
            return JSONResponse(content=result_json)
        finally:
            await upstream_resp.aclose()
            await client.aclose()

def main():
    parser = argparse.ArgumentParser(description="OpenCode Zen OpenAI Proxy")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定监听地址 (默认 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8131, help="绑定端口 (默认 8131)")
    parser.add_argument("--workers", type=int, default=1, help="工作线程数")
    args = parser.parse_args()

    print("=" * 65)
    print("OpenCode Zen OpenAI 兼容代理服务器已启动")
    print(f"  服务地址: http://{args.host}:{args.port}")
    print(f"  API Key:         {API_KEY}")
    print(f"  OpenAI 接口路径: http://{args.host}:{args.port}/v1/chat/completions")
    print(f"  模型列表路径:   http://{args.host}:{args.port}/v1/models")
    print("  Agent 工具映射: ")
    for k, v in DEFAULT_TOOL_MAP.items():
        if k != v:
            print(f"    {k} -> {v}")
    print("=" * 65)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

if __name__ == "__main__":
    main()
