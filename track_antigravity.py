import os
import json
import sqlite3
import re
import platform
from pathlib import Path


def get_antigravity_base_dir():
    """Returns the default directory for Antigravity CLI configurations and data."""
    return Path.home() / ".gemini" / "antigravity-cli"


def parse_jsonl(file_path):
    """Safely yields dicts from a JSON Lines format file."""
    if not file_path.exists():
        return
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def get_user_info():
    """Collects basic user and environment information."""
    base_dir = get_antigravity_base_dir()
    brain_dir = base_dir / "brain"
    
    total_sessions = 0
    if brain_dir.exists():
        total_sessions = sum(1 for item in brain_dir.iterdir() if item.is_dir())
        
    # Attempt to fetch Copilot SKU
    db_path = Path.home() / "Library/Application Support/Code/User/globalStorage/state.vscdb"
    copilot_sku = "Standard"
    if db_path.exists():
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM ItemTable WHERE key = 'GitHub.copilot-chat'")
            row = cursor.fetchone()
            if row:
                data = json.loads(row[0])
                copilot_sku = data.get("exp.github.copilot.sku", "Standard").replace("_", " ").title()
            conn.close()
        except:
            pass

    return {
        "username": os.environ.get("USER", os.getlogin() if hasattr(os, "getlogin") else "Unknown"),
        "os": f"{platform.system()} {platform.release()}",
        "python_version": platform.python_version(),
        "total_sessions": total_sessions,
        "session_limit": 100,
        "limit_reset": "1st of every month",
        "copilot_sku": copilot_sku
    }

def collect_model_metrics():
    base_dir = get_antigravity_base_dir()
    brain_dir = base_dir / "brain"

    if not base_dir.exists():
        print(f"[-] Directory metadata path not found: {base_dir}")
        return

    # Dynamic model-wise usage metrics repository
    # Key: model_name -> Value: dict of aggregated counts
    model_analytics = {}

    def ensure_model_node(model_name):
        if model_name not in model_analytics:
            model_analytics[model_name] = {
                "total_turns": 0,
                "user_prompts": 0,
                "subagent_spawns": 0,
                "estimated_steps_executed": 0,
            }
        return model_analytics[model_name]

    # --- PHASE 1: Parse Local Session Folders & Transcript Streams ---
    if brain_dir.exists():
        for session_folder in brain_dir.iterdir():
            if session_folder.is_dir():
                # Transcripts reside in the internal system-generated log loop paths
                transcript_path = (
                    session_folder / ".system_generated" / "logs" / "transcript.jsonl"
                )

                if transcript_path.exists():
                    current_model = "gemini-3.5-flash-default"
                    for entry in parse_jsonl(transcript_path):
                        content = entry.get("content", "")
                        entry_type = entry.get("type", "")
                        
                        if entry_type == "USER_INPUT" and isinstance(content, str):
                            match = re.search(r"changed setting `Model Selection` from .*? to (.*?)\. No need to comment", content)
                            if match:
                                current_model = match.group(1).strip()

                        # Extract the target model declaration from root or meta dictionary layers
                        model = entry.get("model") or entry.get("meta", {}).get("model")

                        # Fallback default if unspecified in trace data
                        if not model:
                            model = current_model

                        metrics = ensure_model_node(model)
                        metrics["estimated_steps_executed"] += 1

                        # Differentiate between human interactions and agent pipelines
                        entry_type = entry.get("type", "")
                        entry_source = entry.get("source", "")

                        if entry_type == "USER_INPUT":
                            metrics["user_prompts"] += 1
                            metrics["total_turns"] += 1
                        elif entry_type == "MODEL_RESPONSE":
                            metrics["total_turns"] += 1

                        if (
                            "subagent" in str(entry_source).lower()
                            or entry_type == "SUBAGENT_SPAWN"
                        ):
                            metrics["subagent_spawns"] += 1

    # --- PHASE 2: Cross-Reference with Centralized SQLite Session DB ---
    # The CLI saves recent cross-session historical state data inside an embedded SQLite framework
    db_paths = [base_dir / "history.db", base_dir / "conversations.db"]
    for db_path in db_paths:
        if db_path.exists():
            try:
                conn = sqlite3.connect(str(db_path))
                cursor = conn.cursor()

                # Dynamic check to extract tables containing explicit model indexing strings
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                tables = [row[0] for row in cursor.fetchall()]

                if "messages" in tables:
                    # Pull queries matching model mappings directly from row states
                    cursor.execute(
                        "SELECT model, COUNT(*), SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) FROM messages WHERE model IS NOT NULL GROUP BY model;"
                    )
                    for row in cursor.fetchall():
                        m_name, total_msgs, user_msgs = row
                        metrics = ensure_model_node(m_name)
                        metrics["total_turns"] += total_msgs
                        metrics["user_prompts"] += user_msgs

                conn.close()
            except Exception:
                # Silently bypass tracking if database descriptors are locked by an active agy shell session
                pass

    return model_analytics

def collect_copilot_metrics():
    db_path = Path.home() / "Library/Application Support/Code/User/globalStorage/state.vscdb"
    copilot_analytics = {}
    if not db_path.exists():
        return copilot_analytics
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM ItemTable WHERE key = 'GitHub.copilot-chat'")
        row = cursor.fetchone()
        conn.close()
        
        if row:
            data = json.loads(row[0])
            for key, val in data.items():
                if key.startswith("lmBaseCount/"):
                    model_name = key.split("/", 1)[1]
                    count = val.get("baseCount", 0)
                    copilot_analytics[model_name] = {
                        "total_turns": count,
                        "user_prompts": count,
                        "subagent_spawns": 0,
                        "estimated_steps_executed": count * 2
                    }
    except Exception as e:
        pass
        
    return copilot_analytics

def collect_codex_metrics():
    codex_dir = Path.home() / ".codex"
    state_db = codex_dir / "state_5.sqlite"
    if not state_db.exists():
        return {}

    model_analytics = {}

    def ensure_model_node(model_name):
        if model_name not in model_analytics:
            model_analytics[model_name] = {
                "total_turns": 0,
                "user_prompts": 0,
                "subagent_spawns": 0,
                "estimated_steps_executed": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_creation_tokens": 0,
            }
        return model_analytics[model_name]

    try:
        conn = sqlite3.connect(str(state_db))
        cursor = conn.cursor()
        cursor.execute(
            "SELECT rollout_path, model, tokens_used FROM threads WHERE model IS NOT NULL"
        )
        threads = cursor.fetchall()
        conn.close()
    except Exception:
        return {}

    for rollout_path, model, tokens_used in threads:
        metrics = ensure_model_node(model)
        # tokens_used is total per thread — split 80/20 as input/output estimate
        total_tok = tokens_used or 0
        metrics["input_tokens"] += int(total_tok * 0.8)
        metrics["output_tokens"] += int(total_tok * 0.2)

        path = Path(rollout_path)
        if not path.exists():
            continue

        for entry in parse_jsonl(path):
            if entry.get("type") != "response_item":
                continue
            payload = entry.get("payload", {})
            role = payload.get("role", "")
            ptype = payload.get("type", "")

            metrics["estimated_steps_executed"] += 1
            metrics["total_turns"] += 1

            if role == "user":
                metrics["user_prompts"] += 1

            if ptype in ("function_call", "tool_call"):
                metrics["subagent_spawns"] += 1
            else:
                content = payload.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") in ("tool_use", "function_call", "tool_call"):
                            metrics["subagent_spawns"] += 1

    return model_analytics


def collect_claude_code_metrics():
    projects_dir = Path.home() / ".claude" / "projects"
    if not projects_dir.exists():
        return {}

    model_analytics = {}

    def ensure_model_node(model_name):
        if model_name not in model_analytics:
            model_analytics[model_name] = {
                "total_turns": 0,
                "user_prompts": 0,
                "subagent_spawns": 0,
                "estimated_steps_executed": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_creation_tokens": 0,
            }
        return model_analytics[model_name]

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue
        for jsonl_file in project_dir.glob("*.jsonl"):
            for entry in parse_jsonl(jsonl_file):
                entry_type = entry.get("type", "")

                if entry_type == "user":
                    # Count user prompts against a placeholder until we see the model
                    ensure_model_node("claude-code")["user_prompts"] += 1

                elif entry_type == "assistant":
                    msg = entry.get("message", {})
                    model = msg.get("model", "claude-code")
                    usage = msg.get("usage", {})

                    metrics = ensure_model_node(model)
                    metrics["total_turns"] += 1
                    metrics["estimated_steps_executed"] += 1
                    metrics["input_tokens"] += usage.get("input_tokens", 0)
                    metrics["output_tokens"] += usage.get("output_tokens", 0)
                    metrics["cache_read_tokens"] += usage.get("cache_read_input_tokens", 0)
                    metrics["cache_creation_tokens"] += usage.get("cache_creation_input_tokens", 0)

                    content = msg.get("content", [])
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                metrics["subagent_spawns"] += 1

    # Remove synthetic/internal models
    model_analytics = {k: v for k, v in model_analytics.items() if k != "<synthetic>"}

    # Merge the placeholder user_prompts into real model buckets
    placeholder = model_analytics.pop("claude-code", None)
    if placeholder and model_analytics:
        first_model = next(iter(model_analytics))
        model_analytics[first_model]["user_prompts"] += placeholder["user_prompts"]
    elif placeholder:
        model_analytics["claude-code"] = placeholder

    return model_analytics


def get_all_metrics():
    return {
        "antigravity": collect_model_metrics(),
        "copilot": collect_copilot_metrics(),
        "claude_code": collect_claude_code_metrics(),
        "codex": collect_codex_metrics(),
    }

def print_metrics(model_analytics):
    print("=================================================================")
    print("           ANTIGRAVITY CLI GLOBAL MODEL INSIGHTS                 ")
    print("=================================================================")

    if not model_analytics:
        print("[-] No specific model operational metrics found.")
        print(
            "    Run a terminal agent workspace command using 'agy --model <model_id>' first."
        )
        return

    for model_id, data in model_analytics.items():
        print(f"\n🚀 MODEL ID: {model_id}")
        print(f"  ├── Total Interaction Turns (In/Out) : {data['total_turns']}")
        print(f"  ├── Direct Manual User Prompts        : {data['user_prompts']}")
        print(f"  ├── Autonomous Subagents Deployed    : {data['subagent_spawns']}")
        print(
            f"  └── Sequence Script Execution Steps  : {data['estimated_steps_executed']}"
        )

    print("\n=================================================================")


if __name__ == "__main__":
    analytics = get_all_metrics()
    print("--- Antigravity ---")
    print_metrics(analytics["antigravity"])
    print("\n--- GitHub Copilot ---")
    print_metrics(analytics["copilot"])
