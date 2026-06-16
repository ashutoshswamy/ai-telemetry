# AI Telemetry

A local, privacy-first telemetry dashboard for your AI coding assistants. Parses CLI histories, session logs, and IDE databases to visualize real-time usage metrics across models and tools — all without sending a single byte off your machine.

![Dashboard Preview](https://img.shields.io/badge/stack-React%20%2B%20Flask-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Supported Tools

| Tool | Data Source |
|------|------------|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` |
| **OpenAI Codex** | `~/.codex/state_5.sqlite` + session rollouts |
| **Antigravity CLI** | `~/.gemini/antigravity-cli/brain/` + SQLite DBs |
| **GitHub Copilot** | `~/Library/Application Support/Code/User/globalStorage/state.vscdb` |

## Features

- **Multi-tool tracking** — dedicated tab per AI tool with logo, environment info, and relevant stats
- **Token analytics** — full input/output/cache-read/cache-creation breakdown for Claude Code and Codex
- **Summary cards** — aggregate turns, prompts, tool calls, and tokens at a glance per tab
- **Usage charts** — bar chart (interaction turns per model) + donut chart (model share distribution)
- **Filters** — search models by name, sort by Turns / Tokens / Prompts / Tools
- **Session quota** — visual progress bar with color coding (green → yellow → red) for Antigravity sessions
- **Refresh** — manual refresh button; no page reload needed
- **Dark / Light mode** — follows system preference with manual toggle
- **Local-first & secure** — Flask bound to `127.0.0.1` only, zero external network calls

## Architecture

```
.
├── app.py                  # Flask API server (port 5000)
├── track_antigravity.py    # Data collectors for all four tools
├── requirements.txt
└── frontend/               # React + Vite + Tailwind + Shadcn UI
    └── src/
        └── App.tsx         # Single-page dashboard
```

**Backend** (`app.py` + `track_antigravity.py`): Four independent collectors read local files and SQLite databases, aggregate metrics per model, and expose them via two REST endpoints.

**Frontend** (`frontend/`): Consumes the API through a Vite proxy, renders a tab-based dashboard on port 5173. Recharts for visualizations, Shadcn UI components, Tailwind CSS v3.

### API Endpoints

| Endpoint | Response |
|----------|----------|
| `GET /api/metrics` | `{ antigravity, copilot, claude_code, codex }` — per-model metrics for all tools |
| `GET /api/user` | username, OS, Python version, session counts, Copilot SKU |

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js v18+

### 1. Backend

```bash
pip install -r requirements.txt
python app.py
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

## Contributing

Contributions welcome. To add a new AI tool:

1. Add a collector function in `track_antigravity.py` — return `dict[model_name, ModelMetrics]`
2. Include the key in `get_all_metrics()`
3. Add a `TabId` entry and tab config in `App.tsx`
4. Drop the tool logo in `frontend/public/`

### ModelMetrics shape

```python
{
    "total_turns": int,
    "user_prompts": int,
    "subagent_spawns": int,        # tool calls / agent invocations
    "estimated_steps_executed": int,
    "input_tokens": int,           # optional, 0 if unavailable
    "output_tokens": int,          # optional, 0 if unavailable
    "cache_read_tokens": int,      # optional
    "cache_creation_tokens": int,  # optional
}
```

## Security

- No external network calls — collectors only read local paths
- Flask socket bound exclusively to `127.0.0.1`; `debug=False` in production mode
- CORS restricted to `http://localhost:5173`
- No telemetry, no analytics, no remote uploads

## License

MIT — see [LICENSE](LICENSE) for details.

---

Developed by [ashutoshswamy](https://github.com/ashutoshswamy)
