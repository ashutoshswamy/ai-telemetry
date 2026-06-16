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


PRICING_RULES = [
    (r'claude-opus-4|opus-4',          dict(input=15,   output=75,   cache_read=1.50,  cache_write=18.75)),
    (r'claude-sonnet-4|sonnet-4',      dict(input=3,    output=15,   cache_read=0.30,  cache_write=3.75)),
    (r'claude-haiku-4|haiku-4',        dict(input=0.80, output=4,    cache_read=0.08,  cache_write=1.00)),
    (r'claude-3-7-sonnet|3\.7-sonnet', dict(input=3,    output=15,   cache_read=0.30,  cache_write=3.75)),
    (r'claude-3-5-sonnet|3\.5-sonnet', dict(input=3,    output=15,   cache_read=0.30,  cache_write=3.75)),
    (r'claude-3-5-haiku|3\.5-haiku',   dict(input=0.80, output=4,    cache_read=0.08,  cache_write=1.00)),
    (r'claude-3-opus',                  dict(input=15,   output=75,   cache_read=1.50,  cache_write=18.75)),
    (r'claude-3-sonnet',                dict(input=3,    output=15,   cache_read=0.30,  cache_write=3.75)),
    (r'claude-3-haiku',                 dict(input=0.25, output=1.25, cache_read=0.03,  cache_write=0.30)),
    (r'gpt-4o-mini',                    dict(input=0.15, output=0.60, cache_read=0.075, cache_write=0)),
    (r'gpt-4o',                         dict(input=2.50, output=10,   cache_read=1.25,  cache_write=0)),
    (r'o4-mini|o3-mini',                dict(input=1.10, output=4.40, cache_read=0.275, cache_write=0)),
    (r'o3\b',                           dict(input=10,   output=40,   cache_read=2.50,  cache_write=0)),
]


def calc_cost(model_id, input_tok, output_tok, cache_read, cache_write):
    for pattern, rates in PRICING_RULES:
        if re.search(pattern, model_id, re.IGNORECASE):
            MTok = 1_000_000
            return (input_tok * rates['input'] + output_tok * rates['output'] +
                    cache_read * rates['cache_read'] + cache_write * rates['cache_write']) / MTok
    return 0.0


def _decode_project_name(dir_name):
    """Decode a ~/.claude/projects dir name to a short human-readable project label."""
    # Strip leading dash
    s = dir_name.lstrip("-")
    # Strip leading 'Users-<username>-'
    parts = s.split("-")
    if len(parts) >= 2 and parts[0] == "Users":
        s = "-".join(parts[2:])  # drop 'Users' and username
    # Strip common mount prefixes
    for prefix in ("Documents-", "Desktop-", "Downloads-"):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    # Take last 2 hyphen-separated tokens as "Parent/child"
    tokens = s.split("-")
    if len(tokens) >= 2:
        return tokens[-2] + "/" + tokens[-1]
    return s


def collect_claude_code_details():
    from datetime import datetime, timezone, timedelta

    projects_dir = Path.home() / ".claude" / "projects"
    if not projects_dir.exists():
        return {"sessions": [], "projects": {}, "daily": [], "hourly": []}

    now_utc = datetime.now(timezone.utc)
    cutoff_60d = now_utc - timedelta(days=60)
    cutoff_30d = now_utc - timedelta(days=30)

    # Accumulators
    sessions_list = []
    projects_agg = {}

    # daily: date_str -> {input, output, cache_read, cache_create}
    daily_agg = {}
    # hourly: hour -> {total_output, total_turns, day_set}
    hourly_agg = {h: {"total_output": 0, "total_turns": 0, "days": set()} for h in range(24)}

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue
        project_name = _decode_project_name(project_dir.name)

        for jsonl_file in project_dir.glob("*.jsonl"):
            session_id = jsonl_file.stem  # UUID
            session_id_short = session_id[:8]

            # Session-level accumulators
            s_input = s_output = s_cache_read = s_cache_create = 0
            s_turns = s_user_prompts = 0
            s_first_ts = s_last_ts = None
            model_counts = {}

            for entry in parse_jsonl(jsonl_file):
                entry_type = entry.get("type", "")
                ts_str = entry.get("timestamp")
                ts = None
                if ts_str:
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except Exception:
                        pass

                if entry_type == "user":
                    s_user_prompts += 1
                    if ts:
                        if s_first_ts is None or ts < s_first_ts:
                            s_first_ts = ts
                        if s_last_ts is None or ts > s_last_ts:
                            s_last_ts = ts

                elif entry_type == "assistant":
                    msg = entry.get("message", {})
                    model = msg.get("model", "unknown")
                    usage = msg.get("usage", {})
                    inp = usage.get("input_tokens", 0)
                    out = usage.get("output_tokens", 0)
                    cr = usage.get("cache_read_input_tokens", 0)
                    cc = usage.get("cache_creation_input_tokens", 0)

                    s_turns += 1
                    s_input += inp
                    s_output += out
                    s_cache_read += cr
                    s_cache_create += cc
                    model_counts[model] = model_counts.get(model, 0) + 1

                    if ts:
                        if s_first_ts is None or ts < s_first_ts:
                            s_first_ts = ts
                        if s_last_ts is None or ts > s_last_ts:
                            s_last_ts = ts

                    # Daily / hourly — only last 60 days
                    if ts and ts >= cutoff_60d:
                        date_str = ts.strftime("%Y-%m-%d")
                        if date_str not in daily_agg:
                            daily_agg[date_str] = {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0}
                        daily_agg[date_str]["input"] += inp
                        daily_agg[date_str]["output"] += out
                        daily_agg[date_str]["cache_read"] += cr
                        daily_agg[date_str]["cache_create"] += cc

                        hour = ts.hour
                        hourly_agg[hour]["total_output"] += out
                        hourly_agg[hour]["total_turns"] += 1
                        hourly_agg[hour]["days"].add(date_str)

            if s_turns == 0 and s_user_prompts == 0:
                continue

            # Most frequent model
            primary_model = max(model_counts, key=lambda k: model_counts[k]) if model_counts else "unknown"
            cost = calc_cost(primary_model, s_input, s_output, s_cache_read, s_cache_create)

            last_active = s_last_ts.isoformat().replace("+00:00", "Z") if s_last_ts else None
            duration_min = 0.0
            if s_first_ts and s_last_ts and s_last_ts > s_first_ts:
                duration_min = round((s_last_ts - s_first_ts).total_seconds() / 60, 1)

            sessions_list.append({
                "session_id": session_id_short,
                "project": project_name,
                "last_active": last_active,
                "duration_minutes": duration_min,
                "model": primary_model,
                "turns": s_turns,
                "user_prompts": s_user_prompts,
                "input_tokens": s_input,
                "output_tokens": s_output,
                "cache_read_tokens": s_cache_read,
                "cache_creation_tokens": s_cache_create,
                "cost": cost,
                "_last_ts": s_last_ts,  # temp for sorting
            })

            # Project aggregation
            if project_name not in projects_agg:
                projects_agg[project_name] = {
                    "sessions": 0, "turns": 0, "user_prompts": 0,
                    "input_tokens": 0, "output_tokens": 0,
                    "cache_read_tokens": 0, "cache_creation_tokens": 0,
                    "cost": 0.0,
                }
            p = projects_agg[project_name]
            p["sessions"] += 1
            p["turns"] += s_turns
            p["user_prompts"] += s_user_prompts
            p["input_tokens"] += s_input
            p["output_tokens"] += s_output
            p["cache_read_tokens"] += s_cache_read
            p["cache_creation_tokens"] += s_cache_create
            p["cost"] += cost

    # Sort sessions by last_active desc, take top 30
    sessions_list.sort(key=lambda x: x["_last_ts"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    sessions_list = sessions_list[:30]
    for s in sessions_list:
        s.pop("_last_ts", None)

    # Build daily series — last 30 days, oldest first
    daily = []
    for i in range(29, -1, -1):
        d = cutoff_30d + timedelta(days=i + 1)
        date_str = d.strftime("%Y-%m-%d")
    # Rebuild: iterate from oldest (30 days ago) to today
    daily = []
    start_30d = now_utc - timedelta(days=29)
    for i in range(30):
        d = start_30d + timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        agg = daily_agg.get(date_str, {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0})
        daily.append({
            "date": date_str,
            "input": agg["input"],
            "output": agg["output"],
            "cache_read": agg["cache_read"],
            "cache_create": agg["cache_create"],
        })

    # Build hourly averages
    hourly = []
    for h in range(24):
        agg = hourly_agg[h]
        n_days = len(agg["days"]) or 1
        hourly.append({
            "hour": h,
            "avg_output": round(agg["total_output"] / n_days),
            "avg_turns": round(agg["total_turns"] / n_days, 1),
        })

    return {
        "sessions": sessions_list,
        "projects": projects_agg,
        "daily": daily,
        "hourly": hourly,
    }


def collect_codex_details():
    from datetime import datetime, timezone, timedelta

    codex_dir = Path.home() / ".codex"
    state_db = codex_dir / "state_5.sqlite"
    if not state_db.exists():
        return {"sessions": [], "projects": {}, "daily": [], "hourly": []}

    now_utc = datetime.now(timezone.utc)
    cutoff_60d = now_utc - timedelta(days=60)
    start_30d = now_utc - timedelta(days=29)

    def project_from_cwd(cwd):
        if not cwd:
            return "unknown"
        parts = [p for p in cwd.replace("\\", "/").split("/") if p]
        if len(parts) >= 2:
            return parts[-2] + "/" + parts[-1]
        return parts[-1] if parts else "unknown"

    try:
        conn = sqlite3.connect(str(state_db))
        cur = conn.cursor()
        cur.execute("""
            SELECT id, model, tokens_used, cwd, created_at_ms, updated_at_ms
            FROM threads
            WHERE model IS NOT NULL AND created_at_ms IS NOT NULL
            ORDER BY created_at_ms DESC
        """)
        threads = cur.fetchall()
        conn.close()
    except Exception:
        return {"sessions": [], "projects": {}, "daily": [], "hourly": []}

    sessions_list = []
    projects_agg = {}
    daily_agg = {}
    hourly_agg = {h: {"total_output": 0, "total_turns": 0, "days": set()} for h in range(24)}

    for thread_id, model, tokens_used, cwd, created_ms, updated_ms in threads:
        project = project_from_cwd(cwd)
        tokens = tokens_used or 0
        input_tok = tokens // 2
        output_tok = tokens - input_tok

        created_dt = datetime.fromtimestamp(created_ms / 1000, tz=timezone.utc) if created_ms else None
        updated_dt = datetime.fromtimestamp(updated_ms / 1000, tz=timezone.utc) if updated_ms else None

        duration_min = 0.0
        if created_ms and updated_ms and updated_ms > created_ms:
            duration_min = round((updated_ms - created_ms) / 60000, 1)

        cost = calc_cost(model or "", input_tok, output_tok, 0, 0)
        last_active = updated_dt.isoformat().replace("+00:00", "Z") if updated_dt else None

        sessions_list.append({
            "session_id": (thread_id or "")[:8],
            "project": project,
            "last_active": last_active,
            "duration_minutes": duration_min,
            "model": model or "unknown",
            "turns": 0,
            "user_prompts": 0,
            "input_tokens": input_tok,
            "output_tokens": output_tok,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "cost": cost,
            "_created_dt": created_dt,
        })

        if project not in projects_agg:
            projects_agg[project] = {
                "sessions": 0, "turns": 0, "user_prompts": 0,
                "input_tokens": 0, "output_tokens": 0,
                "cache_read_tokens": 0, "cache_creation_tokens": 0, "cost": 0.0,
            }
        p = projects_agg[project]
        p["sessions"] += 1
        p["input_tokens"] += input_tok
        p["output_tokens"] += output_tok
        p["cost"] += cost

        if created_dt and created_dt >= cutoff_60d:
            date_str = created_dt.strftime("%Y-%m-%d")
            if date_str not in daily_agg:
                daily_agg[date_str] = {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0}
            daily_agg[date_str]["input"] += input_tok
            daily_agg[date_str]["output"] += output_tok

            hour = created_dt.hour
            hourly_agg[hour]["total_output"] += output_tok
            hourly_agg[hour]["total_turns"] += 1
            hourly_agg[hour]["days"].add(date_str)

    sessions_list.sort(
        key=lambda x: x["_created_dt"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    sessions_list = sessions_list[:30]
    for s in sessions_list:
        s.pop("_created_dt", None)

    daily = []
    for i in range(30):
        d = start_30d + timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        agg = daily_agg.get(date_str, {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0})
        daily.append({"date": date_str, **agg})

    hourly = []
    for h in range(24):
        agg = hourly_agg[h]
        n = len(agg["days"]) or 1
        hourly.append({
            "hour": h,
            "avg_output": round(agg["total_output"] / n),
            "avg_turns": round(agg["total_turns"] / n, 1),
        })

    return {"sessions": sessions_list, "projects": projects_agg, "daily": daily, "hourly": hourly}


def collect_antigravity_details():
    from datetime import datetime, timezone, timedelta

    base_dir = get_antigravity_base_dir()
    brain_dir = base_dir / "brain"
    if not brain_dir.exists():
        return {"sessions": [], "projects": {}, "daily": [], "hourly": []}

    now_utc = datetime.now(timezone.utc)
    cutoff_60d = now_utc - timedelta(days=60)
    start_30d = now_utc - timedelta(days=29)
    path_pat = re.compile(r'/(?:Users|home)/[^\s"<>\n,\\]+')

    sessions_list = []
    projects_agg = {}
    daily_agg = {}
    hourly_agg = {h: {"total_turns": 0, "days": set()} for h in range(24)}

    for session_folder in brain_dir.iterdir():
        if not session_folder.is_dir():
            continue
        transcript_path = session_folder / ".system_generated" / "logs" / "transcript.jsonl"
        if not transcript_path.exists():
            continue

        s_first_ts = s_last_ts = None
        s_turns = s_user_prompts = 0
        project = "unknown"

        for entry in parse_jsonl(transcript_path):
            ts_str = entry.get("created_at")
            ts = None
            if ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except Exception:
                    pass

            if ts:
                if s_first_ts is None or ts < s_first_ts:
                    s_first_ts = ts
                if s_last_ts is None or ts > s_last_ts:
                    s_last_ts = ts

            etype = entry.get("type", "")

            if project == "unknown":
                raw = json.dumps(entry)
                for m in path_pat.findall(raw):
                    m = m.rstrip('",\\/')
                    parts = [p for p in m.split("/") if p and p not in ("Users", "home")]
                    if len(parts) >= 2 and parts[0] not in ("etc", "usr", "var", "tmp", "private", "Library"):
                        project = parts[-2] + "/" + parts[-1]
                        break

            if etype == "USER_INPUT":
                s_user_prompts += 1
                s_turns += 1
            elif etype in ("MODEL_RESPONSE", "PLANNER_RESPONSE"):
                s_turns += 1

            if ts and ts >= cutoff_60d and etype in ("USER_INPUT", "MODEL_RESPONSE"):
                date_str = ts.strftime("%Y-%m-%d")
                if date_str not in daily_agg:
                    daily_agg[date_str] = {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0}
                daily_agg[date_str]["output"] += 1
                hour = ts.hour
                hourly_agg[hour]["total_turns"] += 1
                hourly_agg[hour]["days"].add(date_str)

        if s_last_ts is None:
            continue

        duration_min = 0.0
        if s_first_ts and s_last_ts and s_last_ts > s_first_ts:
            duration_min = round((s_last_ts - s_first_ts).total_seconds() / 60, 1)

        sessions_list.append({
            "session_id": session_folder.name[:8],
            "project": project,
            "last_active": s_last_ts.isoformat().replace("+00:00", "Z"),
            "duration_minutes": duration_min,
            "model": "gemini",
            "turns": s_turns,
            "user_prompts": s_user_prompts,
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "cost": 0.0,
            "_last_ts": s_last_ts,
        })

        if project not in projects_agg:
            projects_agg[project] = {
                "sessions": 0, "turns": 0, "user_prompts": 0,
                "input_tokens": 0, "output_tokens": 0,
                "cache_read_tokens": 0, "cache_creation_tokens": 0, "cost": 0.0,
            }
        p = projects_agg[project]
        p["sessions"] += 1
        p["turns"] += s_turns
        p["user_prompts"] += s_user_prompts

    sessions_list.sort(
        key=lambda x: x["_last_ts"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    sessions_list = sessions_list[:30]
    for s in sessions_list:
        s.pop("_last_ts", None)

    daily = []
    for i in range(30):
        d = start_30d + timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        agg = daily_agg.get(date_str, {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0})
        daily.append({"date": date_str, **agg})

    hourly = []
    for h in range(24):
        agg = hourly_agg[h]
        n = len(agg["days"]) or 1
        hourly.append({"hour": h, "avg_output": 0, "avg_turns": round(agg["total_turns"] / n, 1)})

    return {"sessions": sessions_list, "projects": projects_agg, "daily": daily, "hourly": hourly}


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
