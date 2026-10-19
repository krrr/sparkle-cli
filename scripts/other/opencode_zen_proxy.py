# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "fastapi>=0.100.0",
#     "httpx>=0.25.0",
#     "uvicorn>=0.22.0",
# ]
# ///

"""
OpenCode Zen / Inference to OpenAI API Proxy
1. 适配 2026-10-14 后的 OpenCode 新指纹校验网关：
   - 上游切换至 /inference/v1/chat/completions
   - 请求头补齐 x-opencode-session-id，彻底移除被拒的 x-opencode-request
   - project 头使用 40 字符 hex
   - User-Agent 更新为 opencode/latest/2.0.29/cli
2. 支持针对 sparkle-cli (run_shell_command, read_file <-> shell, read) 的无损参数及工具名双向映射。
3. 非 sparkle-cli 调用时，保留客户端自带工具并自动补齐官方核心工具定义以满足 Gate 准入。
"""

import argparse
import hashlib
import json
import os
import sys
import threading
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple, Set

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

UPSTREAM_CHAT_URL = "https://opencode.ai/inference/v1/chat/completions"
UPSTREAM_MODELS_URL = "https://opencode.ai/zen/v1/models"
SES_ID_TTL_SEC = 600

# 访问凭证控制
API_KEY = "lajiopencode"

# OpenCode 官方 2.x 完整的 5 个核心 Agent 工具定义（从 @opencode/cli 真实抓包提取）
OPENCODE_OFFICIAL_TOOLS: Dict[str, dict] = {
    "shell": {
        "type": "function",
        "function": {
            "name": "shell",
            "description": "Execute a shell command and return its output. Commands run on Windows using powershell. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command string to execute",
                    },
                    "workdir": {
                        "type": "string",
                        "description": "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
                    },
                    "timeout": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
                    },
                    "background": {
                        "type": "boolean",
                        "description": "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
                    },
                },
                "required": ["command"],
                "additionalProperties": False,
            },
        },
    },
    "read": {
        "type": "function",
        "function": {
            "name": "read",
            "description": "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File or directory to read",
                    },
                    "offset": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "The line or directory entry to start reading from (1-based)",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    "edit": {
        "type": "function",
        "function": {
            "name": "edit",
            "description": "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. Write line breaks as \\n; the file's existing CRLF or LF line endings are matched and preserved. To change line endings themselves, make oldString and newString differ only in \\r; that edit applies to the exact bytes. If there is no exact match, the edit retries while ignoring typographic quote, dash, and space variants, then trailing whitespace on each line. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File to edit"},
                    "oldString": {"type": "string", "description": "Exact text to find and replace"},
                    "newString": {"type": "string", "description": "Text to replace oldString with (must differ from oldString)"},
                    "replaceAll": {"type": "boolean", "description": "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false."},
                },
                "required": ["path", "oldString", "newString"],
                "additionalProperties": False,
            },
        },
    },
    "glob": {
        "type": "function",
        "function": {
            "name": "glob",
            "description": "Search file paths using a glob pattern (examples: \"**/*.ts\", \"src/**/*.tsx\").",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern to match files against"},
                    "path": {"type": "string", "description": "Directory to search. Defaults to the current working directory."},
                    "limit": {"type": "integer", "exclusiveMinimum": 0, "description": "Maximum number of matching files to return (default: 100)"},
                    "hidden": {"type": "boolean", "description": "Include hidden files and directories (default: false)."},
                },
                "required": ["pattern"],
                "additionalProperties": False,
            },
        },
    },
    "grep": {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Search file contents using ripgrep's regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regular expression pattern to search for"},
                    "path": {"type": "string", "description": "File or directory to search. Defaults to the current working directory."},
                    "include": {"type": "string", "description": "Glob pattern to filter files (for example, \"*.js\" or \"*.{ts,tsx}\")"},
                    "limit": {"type": "integer", "exclusiveMinimum": 0, "description": "Maximum number of matching lines to return (default: 100)"},
                    "caseSensitive": {"type": "boolean", "description": "Use case-sensitive matching (default: true)."},
                    "literal": {"type": "boolean", "description": "Treat `pattern` as exact text instead of a regular expression (default: false)."},
                },
                "required": ["pattern"],
                "additionalProperties": False,
            },
        },
    },
}

# 核心 Agent 工具集：Gate 仅硬性校验 shell 和 read（包含官方完整定义即可通过）
CORE_AGENT_TOOLS = ["shell", "read"]

# 名称不以 -free 结尾的特殊模型
NON_FREE_SUFFIX_MODELS = ['big-pickle']

app = FastAPI(title="OpenCode Zen OpenAI Proxy", version="2.0.0")

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
    2. 若 is_ses 为 True 则按位取反 v = ~v (Gate 要求 session 保持倒序编码)
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
    return f"{prefix}_{_gen_opencode_id(prefix == 'ses')}"


def is_sparkle_client(request: Request, body: dict) -> bool:
    """
    判断当前请求是否来自 sparkle-cli：
    1. User-Agent 包含 'sparkle' (SparkleCLI 在 openAiCompatibleGenerator 中固定发送)
    2. 请求体 tools 列表中包含 'run_shell_command' 或 'read_file'
    """
    ua = request.headers.get("user-agent", "").lower()
    if "sparkle" in ua:
        return True

    tools = body.get("tools", [])
    if isinstance(tools, list):
        for t in tools:
            if isinstance(t, dict):
                fn = t.get("function", {})
                name = fn.get("name") or t.get("name")
                if name in ("run_shell_command", "read_file"):
                    return True
    return False


def prepare_tools(client_tools: Optional[List[dict]], is_sparkle: bool) -> List[dict]:
    """
    准备发送给上游的 tools 列表：
    - 若为 sparkle-cli：
      将 run_shell_command 映射为官方 shell 定义；
      将 read_file 映射为官方 read 定义；
      其余客户端工具原样保留。
    - 若非 sparkle-cli：
      客户端所有已有工具原样保留。
    - 最终确保核心工具集（尤其是 shell 和 read）存在官方完整定义以满足 Gate 准入。
    """
    transformed_tools: List[dict] = []
    declared_names: Set[str] = set()

    if client_tools:
        for tool in client_tools:
            if not isinstance(tool, dict):
                continue
            tool_copy = json.loads(json.dumps(tool))
            fn = tool_copy.get("function", {})
            orig_name = fn.get("name") or tool_copy.get("name")

            if is_sparkle and orig_name == "run_shell_command":
                tool_copy = json.loads(json.dumps(OPENCODE_OFFICIAL_TOOLS["shell"]))
                declared_names.add("shell")
            elif is_sparkle and orig_name == "read_file":
                tool_copy = json.loads(json.dumps(OPENCODE_OFFICIAL_TOOLS["read"]))
                declared_names.add("read")
            else:
                if orig_name:
                    declared_names.add(orig_name)

            transformed_tools.append(tool_copy)

    # 补齐缺失的核心 Agent 工具（Gate 要求必须包含 shell 和 read）
    for core_tool in CORE_AGENT_TOOLS:
        if core_tool not in declared_names:
            transformed_tools.append(json.loads(json.dumps(OPENCODE_OFFICIAL_TOOLS[core_tool])))
            declared_names.add(core_tool)

    return transformed_tools


def map_sparkle_args_to_upstream(tool_name: str, args_str: str) -> str:
    """将 Sparkle 格式的参数 JSON 转换为 OpenCode 上游格式"""
    if not args_str:
        return args_str
    try:
        args = json.loads(args_str)
        if not isinstance(args, dict):
            return args_str
        if tool_name == "shell":
            if "dir_path" in args:
                args["workdir"] = args.pop("dir_path")
            if "is_background" in args:
                args["background"] = args.pop("is_background")
        elif tool_name == "read":
            if "file_path" in args:
                args["path"] = args.pop("file_path")
            start = 1
            if "start_line" in args:
                start = args.pop("start_line")
                args["offset"] = start
            if "end_line" in args:
                end = args.pop("end_line")
                args["limit"] = max(1, end - start + 1)
        return json.dumps(args, ensure_ascii=False)
    except Exception:
        return args_str


def map_upstream_args_to_sparkle(tool_name: str, args_str: str) -> str:
    """将 OpenCode 上游格式的参数 JSON 转换为 Sparkle 格式"""
    if not args_str:
        return args_str
    try:
        args = json.loads(args_str)
        if not isinstance(args, dict):
            return args_str
        if tool_name == "shell":
            if "workdir" in args:
                args["dir_path"] = args.pop("workdir")
            if "background" in args:
                args["is_background"] = args.pop("background")
        elif tool_name == "read":
            if "path" in args:
                args["file_path"] = args.pop("path")
            start = 1
            if "offset" in args:
                start = args.pop("offset")
                args["start_line"] = start
            if "limit" in args:
                limit = args.pop("limit")
                args["end_line"] = start + limit - 1
        return json.dumps(args, ensure_ascii=False)
    except Exception:
        return args_str


def transform_messages(messages: List[dict], is_sparkle: bool) -> List[dict]:
    """
    转换历史对话中的 tool_calls 及 tool 响应名称与参数：
    如果是 sparkle-cli，将历史中客户端名称转换为上游 shell / read 格式。
    """
    if not is_sparkle or not messages:
        return messages

    new_messages = []
    for msg in messages:
        if not isinstance(msg, dict):
            new_messages.append(msg)
            continue
        msg_copy = json.loads(json.dumps(msg))

        # 转换 assistant 的 tool_calls 里的工具名及参数
        if msg_copy.get("role") == "assistant" and "tool_calls" in msg_copy:
            tcs = msg_copy.get("tool_calls")
            if isinstance(tcs, list):
                for tc in tcs:
                    fn = tc.get("function", {})
                    fn_name = fn.get("name")
                    if fn_name == "run_shell_command":
                        fn["name"] = "shell"
                        if "arguments" in fn:
                            fn["arguments"] = map_sparkle_args_to_upstream("shell", fn["arguments"])
                    elif fn_name == "read_file":
                        fn["name"] = "read"
                        if "arguments" in fn:
                            fn["arguments"] = map_sparkle_args_to_upstream("read", fn["arguments"])

        # 转换 role: tool 消息里的 name 属性
        if msg_copy.get("role") == "tool":
            if msg_copy.get("name") == "run_shell_command":
                msg_copy["name"] = "shell"
            elif msg_copy.get("name") == "read_file":
                msg_copy["name"] = "read"

        new_messages.append(msg_copy)
    return new_messages


def reverse_map_sparkle_tool_call(tc: dict) -> dict:
    """将单条 tool_call 从上游 shell/read 还原为 Sparkle run_shell_command/read_file"""
    tc_copy = json.loads(json.dumps(tc))
    fn = tc_copy.get("function", {})
    name = fn.get("name", "")
    args_str = fn.get("arguments", "")

    if name == "shell":
        fn["name"] = "run_shell_command"
        if args_str:
            fn["arguments"] = map_upstream_args_to_sparkle("shell", args_str)
    elif name == "read":
        fn["name"] = "read_file"
        if args_str:
            fn["arguments"] = map_upstream_args_to_sparkle("read", args_str)

    return tc_copy


def build_upstream_headers(incoming_headers: Dict[str, str]) -> Dict[str, str]:
    """
    构造发送给 OpenCode Inference 的合法请求头（完全对齐 2026-10-14 Gate 指纹要求）：
    1. User-Agent: opencode/latest/2.0.29/cli
    2. Authorization: Bearer public
    3. x-opencode-session 和 x-opencode-session-id 均必须存在且为 descending-encoded ses_ ID
    4. x-opencode-project 必须为 40-char 纯小写 hex 字符串
    5. 严禁发送 x-opencode-request 头（非空值会导致 403 FreeTierError）
    """
    global _current_ses_id, _current_ses_id_time
    now = time.time()
    if _current_ses_id is None or now - _current_ses_id_time > SES_ID_TTL_SEC:
        _current_ses_id = generate_opencode_id("ses")
        _current_ses_id_time = now

    project_hash = hashlib.sha256(b"opencode-project\x00default").hexdigest()[:40]

    return {
        "Accept": "text/event-stream, application/json",
        "Authorization": "Bearer public",
        "Content-Type": "application/json",
        "User-Agent": "opencode/latest/2.0.29/cli",
        "x-opencode-client": "cli",
        "x-opencode-project": project_hash,
        "x-opencode-session": _current_ses_id,
        "x-opencode-session-id": _current_ses_id,
    }


async def stream_generator(
    response: httpx.Response,
    is_sparkle: bool,
    client_model: str
) -> AsyncGenerator[bytes, None]:
    """
    流式转发响应：
    - 若为 sparkle-cli，对 shell/read 进行名称逆向映射，并在 arguments 完整时映射参数字段名
    - 若非 sparkle-cli，原样流式转发工具调用与思考内容
    """
    buffer = bytearray()
    sparkle_call_buffers: Dict[int, Dict[str, Any]] = {}
    tool_names: Dict[int, str] = {}

    def flush_sparkle_tools() -> List[dict]:
        flushed_chunks = []
        for idx in sorted(sparkle_call_buffers.keys()):
            data = sparkle_call_buffers[idx]
            raw_name = data.get("name", "")
            raw_args = data.get("args", "")
            mapped_args = map_upstream_args_to_sparkle(raw_name, raw_args)
            chunk = {
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": idx,
                                    "function": {
                                        "arguments": mapped_args
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
            if client_model:
                chunk["model"] = client_model
            flushed_chunks.append(chunk)
        sparkle_call_buffers.clear()
        return flushed_chunks

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
                    if is_sparkle and sparkle_call_buffers:
                        for flushed in flush_sparkle_tools():
                            yield f"data: {json.dumps(flushed, ensure_ascii=False)}\n\n".encode("utf-8")
                    yield b"data: [DONE]\n\n"
                    break

                try:
                    data = json.loads(data_str)
                    if client_model:
                        data["model"] = client_model

                    choices = data.get("choices", [])
                    if choices:
                        c0 = choices[0]
                        delta = c0.get("delta", {})
                        finish_reason = c0.get("finish_reason")

                        # 兼容 reasoning_content
                        if "reasoning" in delta and "reasoning_content" not in delta:
                            delta["reasoning_content"] = delta["reasoning"]

                        if is_sparkle:
                            tcs = delta.get("tool_calls")
                            if tcs and isinstance(tcs, list):
                                direct_tcs = []
                                for tc in tcs:
                                    idx = tc.get("index", 0)
                                    fn = tc.get("function", {})
                                    fn_name = fn.get("name")
                                    if fn_name:
                                        tool_names[idx] = fn_name
                                        if fn_name in ("shell", "read"):
                                            if idx not in sparkle_call_buffers:
                                                sparkle_call_buffers[idx] = {"name": fn_name, "args": "", "id": tc.get("id")}
                                            mapped_tc = {
                                                "index": idx,
                                                "type": "function",
                                                "function": {
                                                    "name": "run_shell_command" if fn_name == "shell" else "read_file"
                                                }
                                            }
                                            if tc.get("id"):
                                                mapped_tc["id"] = tc["id"]
                                            direct_tcs.append(mapped_tc)
                                        else:
                                            direct_tcs.append(tc)

                                    fn_args = fn.get("arguments")
                                    if fn_args is not None:
                                        current_name = tool_names.get(idx, "")
                                        if current_name in ("shell", "read"):
                                            if idx not in sparkle_call_buffers:
                                                sparkle_call_buffers[idx] = {"name": current_name, "args": "", "id": tc.get("id")}
                                            sparkle_call_buffers[idx]["args"] += fn_args
                                        else:
                                            direct_tcs.append(tc)

                                delta["tool_calls"] = direct_tcs if direct_tcs else None
                                if delta["tool_calls"] is None:
                                    del delta["tool_calls"]

                            if finish_reason:
                                if sparkle_call_buffers:
                                    for flushed in flush_sparkle_tools():
                                        yield f"data: {json.dumps(flushed, ensure_ascii=False)}\n\n".encode("utf-8")

                    if choices and not choices[0].get("delta") and not choices[0].get("finish_reason"):
                        continue

                    yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")
                except json.JSONDecodeError:
                    yield f"data: {data_str}\n\n".encode("utf-8")


async def collapse_stream_to_json(
    response: httpx.Response,
    is_sparkle: bool,
    client_model: str
) -> Dict[str, Any]:
    """将上游强制流式 (SSE) 响应聚合为标准单体 JSON 响应 (Non-streaming)"""
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

    sorted_tool_calls = [tool_calls_dict[k] for k in sorted(tool_calls_dict.keys())] if tool_calls_dict else None
    if sorted_tool_calls and is_sparkle:
        sorted_tool_calls = [reverse_map_sparkle_tool_call(tc) for tc in sorted_tool_calls]

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
        "upstream_inference": UPSTREAM_CHAT_URL,
        "core_tools": CORE_AGENT_TOOLS,
        "sparkle_support": True,
    }


@app.get("/v1/models")
@app.get("/models")
async def list_models(request: Request):
    """
    从上游获取可用模型列表（走 legacy Zen console 接口），过滤出 -free 结尾及白名单免费模型
    """
    check_api_key(request)
    upstream_headers = {
        "Accept": "application/json",
        "Authorization": "Bearer public",
        "User-Agent": "opencode/latest/2.0.29/cli",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(UPSTREAM_MODELS_URL, headers=upstream_headers)
            if resp.status_code == 200:
                raw_data = resp.json()
                models_list = raw_data.get("data", [])

                filtered_models = [
                    m for m in models_list
                    if isinstance(m, dict) and (m.get("id", "").endswith("-free") or m.get("id", "") in NON_FREE_SUFFIX_MODELS)
                ]
                return {"object": "list", "data": filtered_models}
            else:
                print(f"[!] 上游获取 models 失败，HTTP {resp.status_code}: {resp.text}")
                raise HTTPException(
                    status_code=502,
                    detail=f"上游获取 models 失败，HTTP {resp.status_code}",
                )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[!] 请求上游 models 异常: {e}")
        raise HTTPException(status_code=500, detail=f"请求上游 models 异常: {e}")


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
    upstream_model = client_model if client_model.endswith("-free") or client_model in NON_FREE_SUFFIX_MODELS else client_model + '-free'

    # 判断是否来自 sparkle-cli
    is_sparkle = is_sparkle_client(request, body)

    # 工具映射与补齐
    incoming_tools = body.get("tools")
    transformed_tools = prepare_tools(incoming_tools, is_sparkle)

    # 历史消息中的工具名与参数映射
    incoming_messages = body.get("messages", [])
    transformed_messages = transform_messages(incoming_messages, is_sparkle)

    # 组装上游 payload（上游强制 stream: True）
    upstream_payload = {
        "model": upstream_model,
        "stream": True,
        "messages": transformed_messages,
        "tools": transformed_tools,
    }

    # 保留其它可选生成参数
    for opt_key in ["temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty", "reasoning_effort", "thinking"]:
        if opt_key in body:
            upstream_payload[opt_key] = body[opt_key]

    headers_dict = dict(request.headers)
    upstream_headers = build_upstream_headers(headers_dict)

    client_type = "sparkle-cli" if is_sparkle else "standard"
    print(f"[{time.strftime('%X')}] 收到请求 ({client_type}) -> 模型: {client_model} -> 映射: {upstream_model}, 工具数: {len(transformed_tools)}, 流式: {client_stream}")

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

    # 如果客户端请求流式，则以 SSE 模式流式转发
    if client_stream:
        async def response_wrapper():
            try:
                async for chunk in stream_generator(upstream_resp, is_sparkle, client_model):
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
        # 如果客户端请求非流式，聚合 SSE 流后返回单体 JSON
        try:
            result_json = await collapse_stream_to_json(upstream_resp, is_sparkle, client_model)
            return JSONResponse(content=result_json)
        finally:
            await upstream_resp.aclose()
            await client.aclose()


def main():
    parser = argparse.ArgumentParser(description="OpenCode Zen/Inference OpenAI Proxy")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定监听地址 (默认 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8131, help="绑定端口 (默认 8131)")
    parser.add_argument("--workers", type=int, default=1, help="工作线程数")
    args = parser.parse_args()

    print("=" * 65)
    print("OpenCode Zen / Inference OpenAI 兼容代理服务器已启动")
    print(f"  服务地址:        http://{args.host}:{args.port}")
    print(f"  API Key:         {API_KEY}")
    print(f"  OpenAI 接口路径: http://{args.host}:{args.port}/v1/chat/completions")
    print(f"  模型列表路径:   http://{args.host}:{args.port}/v1/models")
    print("  Sparkle-CLI 映射模式: run_shell_command <-> shell, read_file <-> read")
    print("  标准客户端模式:  原样放行客户端工具，自动补齐官方核心工具集")
    print("=" * 65)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

