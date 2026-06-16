import { useEffect, useState, useCallback, useRef, createContext, useContext } from "react"
import type { CSSProperties } from "react"
import {
  Activity, Moon, Sun, RefreshCw,
  ChevronUp, ChevronDown, ChevronsUpDown, Database,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart, Line,
} from "recharts"
import { useTheme } from "./components/theme-provider"

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "antigravity" | "copilot" | "claude_code" | "codex"
type SortKey = "turns" | "prompts" | "tools" | "input" | "output" | "cache_read" | "cache_create" | "steps" | "cost"
type SortDir = "asc" | "desc"
type DateRange = "today" | "week" | "month" | "prev_month" | "7d" | "30d" | "all"

interface ModelMetrics {
  total_turns: number
  user_prompts: number
  subagent_spawns: number
  estimated_steps_executed: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
}

interface UserInfo {
  username: string
  os: string
  python_version: string
  total_sessions: number
  session_limit: number
  limit_reset: string
  copilot_sku: string
}

interface AllMetrics {
  antigravity: Record<string, ModelMetrics>
  copilot: Record<string, ModelMetrics>
  claude_code: Record<string, ModelMetrics>
  codex: Record<string, ModelMetrics>
}

interface SessionEntry {
  session_id: string
  project: string
  last_active: string
  duration_minutes: number
  model: string
  turns: number
  user_prompts: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost: number
}

interface ProjectStats {
  sessions: number
  turns: number
  user_prompts: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost: number
}

interface DailyEntry {
  date: string
  input: number
  output: number
  cache_read: number
  cache_create: number
}

interface HourlyEntry {
  hour: number
  avg_output: number
  avg_turns: number
}

interface ClaudeDetails {
  sessions: SessionEntry[]
  projects: Record<string, ProjectStats>
  daily: DailyEntry[]
  hourly: HourlyEntry[]
}

// ─── Color Palettes ───────────────────────────────────────────────────────────

const C_DARK = {
  bg: "#0d0d0d",
  bgCard: "#141414",
  bgRow: "#111111",
  border: "#1e1e1e",
  borderHover: "#2e2e2e",
  text: "#e0e0e0",
  textMuted: "#555555",
  textDim: "#333333",
  blue: "#4aaeff",
  orange: "#e8734a",
  green: "#4caf7d",
  purple: "#9b6dff",
  gold: "#e8c84a",
  red: "#ef5555",
  cyan: "#00c9a7",
  tooltipBg: "#1c1c1c",
  tableHeader: "#111",
  tableRowAlt: "#111",
  modelTag: "#1c1c1c",
  modelTagBorder: "#242424",
  modelTagText: "#bbb",
  headerBg: "rgba(13,13,13,0.92)",
  footerBg: "#0a0a0a",
  footerBorder: "#131313",
  footerText: "#2a2a2a",
  footerTextAlt: "#333",
  quotaTrack: "#1c1c1c",
  scrollTrack: "#0d0d0d",
  scrollThumb: "#2a2a2a",
  scrollThumbHover: "#3a3a3a",
}

const C_LIGHT = {
  bg: "#f4f4f5",
  bgCard: "#ffffff",
  bgRow: "#fafafa",
  border: "#e4e4e7",
  borderHover: "#a1a1aa",
  text: "#18181b",
  textMuted: "#a1a1aa",
  textDim: "#d4d4d8",
  blue: "#2563eb",
  orange: "#c2410c",
  green: "#16a34a",
  purple: "#7c3aed",
  gold: "#b45309",
  red: "#dc2626",
  cyan: "#0891b2",
  tooltipBg: "#ffffff",
  tableHeader: "#f9f9fa",
  tableRowAlt: "#f4f4f5",
  modelTag: "#f4f4f5",
  modelTagBorder: "#e4e4e7",
  modelTagText: "#52525b",
  headerBg: "rgba(244,244,245,0.92)",
  footerBg: "#f9f9fa",
  footerBorder: "#e4e4e7",
  footerText: "#a1a1aa",
  footerTextAlt: "#71717a",
  quotaTrack: "#e4e4e7",
  scrollTrack: "#f4f4f5",
  scrollThumb: "#d4d4d8",
  scrollThumbHover: "#a1a1aa",
}

type ColorPalette = typeof C_DARK

const ColorsCtx = createContext<ColorPalette>(C_DARK)
const useColors = () => useContext(ColorsCtx)

const PIE_COLORS = [C_DARK.blue, C_DARK.orange, C_DARK.green, C_DARK.purple, C_DARK.gold, C_DARK.cyan, C_DARK.red, "#ff6b9d"]

const TABS: { id: TabId; label: string; logo: string }[] = [
  { id: "claude_code", label: "Claude Code", logo: "/claudecode_logo.png" },
  { id: "codex", label: "Codex", logo: "/codex_logo.png" },
  { id: "antigravity", label: "Antigravity", logo: "/antigravity_logo.png" },
  { id: "copilot", label: "Copilot", logo: "/github_logo.png" },
]

// ─── Service capabilities (what metrics are actually tracked per service) ─────

interface ServiceCap {
  turns: boolean; prompts: boolean; tools: boolean
  tokens: boolean; cache: boolean; cost: boolean; steps: boolean
  sessionTurns: boolean   // detail sessions have real turn counts
  dailyChart: boolean     // daily chart has real data to display
  projectMetric: "tokens" | "turns" | "sessions"  // what the projects bar chart shows
}

const SERVICE_CAPS: Record<TabId, ServiceCap> = {
  //            turns  prompts tools  tokens cache  cost   steps  sessTurns  daily  projectMetric
  claude_code: { turns: true,  prompts: true,  tools: true,  tokens: true,  cache: true,  cost: true,  steps: false, sessionTurns: true,  dailyChart: true,  projectMetric: "tokens"   },
  codex:       { turns: true,  prompts: true,  tools: true,  tokens: false, cache: false, cost: false, steps: false, sessionTurns: false, dailyChart: false, projectMetric: "sessions" },
  antigravity: { turns: true,  prompts: true,  tools: true,  tokens: false, cache: false, cost: false, steps: true,  sessionTurns: true,  dailyChart: true,  projectMetric: "turns"    },
  copilot:     { turns: true,  prompts: true,  tools: false, tokens: false, cache: false, cost: false, steps: false, sessionTurns: false, dailyChart: false, projectMetric: "turns"    },
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

interface PriceRate {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const PRICING: [RegExp, PriceRate][] = [
  [/claude-opus-4|opus-4/i,          { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 }],
  [/claude-sonnet-4|sonnet-4/i,      { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  }],
  [/claude-haiku-4|haiku-4/i,        { input: 0.80, output: 4,    cacheRead: 0.08,  cacheWrite: 1.00  }],
  [/claude-3-7-sonnet|3\.7-sonnet/i, { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  }],
  [/claude-3-5-sonnet|3\.5-sonnet/i, { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  }],
  [/claude-3-5-haiku|3\.5-haiku/i,   { input: 0.80, output: 4,    cacheRead: 0.08,  cacheWrite: 1.00  }],
  [/claude-3-opus|3-opus/i,          { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 }],
  [/claude-3-sonnet|3-sonnet/i,      { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  }],
  [/claude-3-haiku|3-haiku/i,        { input: 0.25, output: 1.25, cacheRead: 0.03,  cacheWrite: 0.30  }],
  [/gpt-4o-mini/i,                   { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0     }],
  [/gpt-4o/i,                        { input: 2.50, output: 10,   cacheRead: 1.25,  cacheWrite: 0     }],
  [/o3-mini/i,                       { input: 1.10, output: 4.40, cacheRead: 0.55,  cacheWrite: 0     }],
  [/o3/i,                            { input: 10,   output: 40,   cacheRead: 2.50,  cacheWrite: 0     }],
  [/o4-mini/i,                       { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 0     }],
]

function getPrice(modelId: string): PriceRate | null {
  for (const [re, rate] of PRICING) {
    if (re.test(modelId)) return rate
  }
  return null
}

function calcCost(modelId: string, m: ModelMetrics): number {
  const r = getPrice(modelId)
  if (!r) return 0
  const MTok = 1_000_000
  return (
    (m.input_tokens ?? 0) * r.input / MTok +
    (m.output_tokens ?? 0) * r.output / MTok +
    (m.cache_read_tokens ?? 0) * r.cacheRead / MTok +
    (m.cache_creation_tokens ?? 0) * r.cacheWrite / MTok
  )
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString()
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  if (n === 0) return "0"
  return n.toString()
}

function fmtTokensRaw(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

function fmtCost(n: number): string {
  if (n === 0) return "—"
  if (n < 0.0001) return "<$0.0001"
  if (n < 0.01) return "$" + n.toFixed(6)
  if (n < 1) return "$" + n.toFixed(4)
  return "$" + n.toFixed(4)
}

function fmtCostStat(n: number): string {
  if (n === 0) return "$0.00"
  return "$" + n.toFixed(2)
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  return `${months[d.getMonth()]} ${d.getDate()} ${h}:${m}`
}

function fmtDateShort(dateStr: string): string {
  const [, mm, dd] = dateStr.split("-")
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${months[parseInt(mm) - 1]} ${parseInt(dd)}`
}

function fmtHour(h: number): string {
  return h.toString().padStart(2, "0")
}

// ─── Date Range Filter ────────────────────────────────────────────────────────

const DATE_RANGE_LABELS: { id: DateRange; label: string }[] = [
  { id: "today",      label: "Today" },
  { id: "week",       label: "This Week" },
  { id: "month",      label: "This Month" },
  { id: "prev_month", label: "Prev Month" },
  { id: "7d",         label: "7d" },
  { id: "30d",        label: "30d" },
  { id: "all",        label: "All" },
]

function getDateCutoff(range: DateRange): { from: Date; to: Date } | null {
  const now = new Date()
  if (range === "all") return null
  if (range === "today") {
    const from = new Date(now); from.setHours(0, 0, 0, 0)
    return { from, to: now }
  }
  if (range === "week") {
    const from = new Date(now)
    from.setDate(now.getDate() - ((now.getDay() + 6) % 7))  // Monday
    from.setHours(0, 0, 0, 0)
    return { from, to: now }
  }
  if (range === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from, to: now }
  }
  if (range === "prev_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    return { from, to }
  }
  if (range === "7d") {
    const from = new Date(now); from.setDate(now.getDate() - 7)
    return { from, to: now }
  }
  if (range === "30d") {
    const from = new Date(now); from.setDate(now.getDate() - 30)
    return { from, to: now }
  }
  return null
}

// ─── Animated Number ──────────────────────────────────────────────────────────

function AnimNumber({ value, fmt = fmtNum }: { value: number; fmt?: (n: number) => string }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const start = Date.now()
    const duration = 1000
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      const e = 1 - Math.pow(1 - p, 4)
      setDisplay(value * e)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value])

  return <>{fmt(display)}</>
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; fill?: string; color?: string }[]
  label?: string
}) {
  const C = useColors()
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: C.tooltipBg,
      border: `1px solid ${C.border}`,
      borderRadius: 7,
      padding: "10px 14px",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
    }}>
      <div style={{ color: C.textMuted, marginBottom: 8, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
          <span style={{ color: C.textMuted }}>{p.name}</span>
          <span style={{ color: p.fill || p.color || C.text }}>{fmtTokensRaw(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, color, fmt, subtitle,
}: {
  label: string
  value: number
  color: string
  fmt?: (n: number) => string
  subtitle?: string
}) {
  const C = useColors()
  return (
    <div className="stat-card" style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: 9,
      padding: "16px 18px 14px",
      minWidth: 130,
      flex: "1 1 130px",
      transition: "border-color 0.15s",
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderHover)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      <div style={{
        fontSize: "0.58rem",
        textTransform: "uppercase",
        letterSpacing: "0.13em",
        color: C.textMuted,
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        marginBottom: 10,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "1.55rem",
        fontWeight: 600,
        color: C.text,
        lineHeight: 1,
        marginBottom: 10,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.02em",
      }}>
        <AnimNumber value={value} fmt={fmt ?? fmtNum} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ height: 2, width: 28, background: color, borderRadius: 1, opacity: 0.85 }} />
        {subtitle && (
          <span style={{ fontSize: "0.6rem", color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{subtitle}</span>
        )}
      </div>
    </div>
  )
}

// ─── Sort Icon ────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  const C = useColors()
  if (!active) return <ChevronsUpDown size={10} style={{ color: C.textDim, flexShrink: 0 }} />
  return dir === "desc"
    ? <ChevronDown size={10} style={{ color: C.blue, flexShrink: 0 }} />
    : <ChevronUp size={10} style={{ color: C.blue, flexShrink: 0 }} />
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const C = useColors()
  const isDark = theme !== "light"
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      style={{
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "7px 9px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderHover)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun size={14} style={{ color: C.textMuted }} /> : <Moon size={14} style={{ color: C.textMuted }} />}
    </button>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { theme } = useTheme()
  const C = theme === "light" ? C_LIGHT : C_DARK

  const [data, setData] = useState<AllMetrics | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("claude_code")
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [claudeDetails, setClaudeDetails] = useState<ClaudeDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("turns")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [dateRange, setDateRange] = useState<DateRange>("all")
  const [modelFilter, setModelFilter] = useState<string>("all")

  const fetchData = useCallback(async (tab: TabId, isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else { setLoading(true); setClaudeDetails(null) }
    setError(null)
    const detailsEndpoint =
      tab === "claude_code" ? "/api/claude_details"
      : tab === "codex" ? "/api/codex_details"
      : tab === "antigravity" ? "/api/antigravity_details"
      : null
    try {
      const detailsPromise = detailsEndpoint
        ? fetch(detailsEndpoint).then(r => r.json())
        : Promise.resolve(null)
      const [metricsRes, userRes, detailsRes] = await Promise.all([
        fetch("/api/metrics").then(r => r.json()),
        fetch("/api/user").then(r => r.json()),
        detailsPromise,
      ])
      if (metricsRes.status === "success" && userRes.status === "success") {
        setData(metricsRes.data)
        setUserInfo(userRes.data)
        setLastUpdated(new Date())
      } else {
        setError(metricsRes.message || userRes.message || "Unknown error")
      }
      if (detailsRes?.status === "success") {
        setClaudeDetails(detailsRes.data)
      }
    } catch (_err) {
      setError("Failed to connect to backend")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData("claude_code") }, [fetchData])

  const btnStyle: CSSProperties = {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "7px 9px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "border-color 0.15s",
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg, gap: 20 }}>
        <style>{`
          @keyframes pulse-dot {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
            40% { transform: scale(1); opacity: 1; }
          }
        `}</style>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: "50%",
              background: C.blue,
              animation: `pulse-dot 1.2s ease-in-out ${i * 0.18}s infinite`,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: "'Space Grotesk', sans-serif", textTransform: "uppercase", letterSpacing: "0.18em", fontWeight: 600 }}>
          Loading telemetry
        </span>
      </div>
    )
  }

  // ── Error ──
  if (error) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <div style={{ background: theme === "light" ? "#fff0f0" : "#180a0a", border: `1px solid ${theme === "light" ? "#fca5a5" : "#3a1212"}`, borderRadius: 10, padding: "28px 36px", textAlign: "center", maxWidth: 380 }}>
          <div style={{ fontSize: 12, color: C.red, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Connection Error
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>{error}</div>
        </div>
      </div>
    )
  }

  // ── Data ──
  const currentData = data ? (data[activeTab] ?? {}) : {}
  const caps = SERVICE_CAPS[activeTab]
  const showTokens = caps.tokens
  const allModels = Object.entries(currentData) as [string, ModelMetrics][]

  const totTurns = allModels.reduce((s, [, m]) => s + m.total_turns, 0)
  const totPrompts = allModels.reduce((s, [, m]) => s + m.user_prompts, 0)
  const totTools = allModels.reduce((s, [, m]) => s + m.subagent_spawns, 0)
  const totInput = allModels.reduce((s, [, m]) => s + (m.input_tokens ?? 0), 0)
  const totOutput = allModels.reduce((s, [, m]) => s + (m.output_tokens ?? 0), 0)
  const totCacheRead = allModels.reduce((s, [, m]) => s + (m.cache_read_tokens ?? 0), 0)
  const totCacheCreate = allModels.reduce((s, [, m]) => s + (m.cache_creation_tokens ?? 0), 0)
  const totSteps = allModels.reduce((s, [, m]) => s + m.estimated_steps_executed, 0)
  const totCost = allModels.reduce((s, [id, m]) => s + calcCost(id, m), 0)
  const hasPricing = showTokens && allModels.some(([id]) => getPrice(id) !== null)

  // ── Date + Model filtering ──
  const cutoff = getDateCutoff(dateRange)
  const useDateFilter = dateRange !== "all"
  const useAnyFilter = useDateFilter || modelFilter !== "all"

  // Model filter applied to model table / charts (all-time aggregates)
  const visibleModels = modelFilter === "all" ? allModels : allModels.filter(([id]) => id === modelFilter)

  const filteredSessions = claudeDetails
    ? claudeDetails.sessions.filter(s => {
        if (modelFilter !== "all" && s.model !== modelFilter) return false
        if (!cutoff || !s.last_active) return true
        const d = new Date(s.last_active)
        return d >= cutoff.from && d <= cutoff.to
      })
    : []

  const filteredDaily = claudeDetails
    ? claudeDetails.daily.filter(d => {
        if (!cutoff) return true
        const dt = new Date(d.date)
        return dt >= cutoff.from && dt <= cutoff.to
      })
    : []

  // Projects derived from filteredSessions when any filter active (daily has no model/date split by project)
  const filteredProjects: Record<string, ProjectStats> = useAnyFilter && claudeDetails
    ? filteredSessions.reduce((acc, s) => {
        if (!acc[s.project]) acc[s.project] = { sessions: 0, turns: 0, user_prompts: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost: 0 }
        const p = acc[s.project]
        p.sessions++; p.turns += s.turns; p.user_prompts += s.user_prompts
        p.input_tokens += s.input_tokens; p.output_tokens += s.output_tokens
        p.cache_read_tokens += s.cache_read_tokens; p.cache_creation_tokens += s.cache_creation_tokens
        p.cost += s.cost
        return acc
      }, {} as Record<string, ProjectStats>)
    : (claudeDetails?.projects ?? {})

  // Stat card values — tokens from filteredDaily when date-filtered, from visibleModels otherwise
  // Turns/cost/sessions from filteredSessions (respect both date + model filter)
  const vmInput       = visibleModels.reduce((s, [, m]) => s + (m.input_tokens ?? 0), 0)
  const vmOutput      = visibleModels.reduce((s, [, m]) => s + (m.output_tokens ?? 0), 0)
  const vmCacheRead   = visibleModels.reduce((s, [, m]) => s + (m.cache_read_tokens ?? 0), 0)
  const vmCacheCreate = visibleModels.reduce((s, [, m]) => s + (m.cache_creation_tokens ?? 0), 0)
  const vmTurns       = visibleModels.reduce((s, [, m]) => s + m.total_turns, 0)
  const vmPrompts     = visibleModels.reduce((s, [, m]) => s + m.user_prompts, 0)
  const vmTools       = visibleModels.reduce((s, [, m]) => s + m.subagent_spawns, 0)
  const vmSteps       = visibleModels.reduce((s, [, m]) => s + m.estimated_steps_executed, 0)
  const vmCost        = visibleModels.reduce((s, [id, m]) => s + calcCost(id, m), 0)

  const fdInput       = filteredDaily.reduce((s, d) => s + d.input, 0)
  const fdOutput      = filteredDaily.reduce((s, d) => s + d.output, 0)
  const fdCacheRead   = filteredDaily.reduce((s, d) => s + d.cache_read, 0)
  const fdCacheCreate = filteredDaily.reduce((s, d) => s + d.cache_create, 0)

  const statInput       = useDateFilter ? fdInput       : vmInput
  const statOutput      = useDateFilter ? fdOutput      : vmOutput
  const statCacheRead   = useDateFilter ? fdCacheRead   : vmCacheRead
  const statCacheCreate = useDateFilter ? fdCacheCreate : vmCacheCreate
  const statCost        = useAnyFilter && claudeDetails ? filteredSessions.reduce((s, x) => s + x.cost, 0) : vmCost
  const statSessions    = claudeDetails ? filteredSessions.length : 0

  // Turns: from filteredSessions when session data has turns, from filteredDaily for antigravity
  const statTurns = useDateFilter && claudeDetails
    ? (activeTab === "antigravity" ? fdOutput : filteredSessions.reduce((s, x) => s + x.turns, 0))
    : vmTurns
  const statPrompts = useDateFilter && claudeDetails ? filteredSessions.reduce((s, x) => s + x.user_prompts, 0) : vmPrompts
  const statTools   = vmTools   // can't date-filter from aggregate
  const statSteps   = vmSteps   // can't date-filter from aggregate

  const statCostHasPricing = caps.cost && (claudeDetails ? filteredSessions.some(x => x.cost > 0) : hasPricing)

  const getVal = (id: string, m: ModelMetrics, key: SortKey): number => {
    const map: Record<SortKey, number> = {
      turns: m.total_turns,
      prompts: m.user_prompts,
      tools: m.subagent_spawns,
      input: m.input_tokens ?? 0,
      output: m.output_tokens ?? 0,
      cache_read: m.cache_read_tokens ?? 0,
      cache_create: m.cache_creation_tokens ?? 0,
      steps: m.estimated_steps_executed,
      cost: calcCost(id, m),
    }
    return map[key] ?? 0
  }

  const sortedModels = [...visibleModels].sort((a, b) => {
    const diff = getVal(a[0], a[1], sortKey) - getVal(b[0], b[1], sortKey)
    return sortDir === "desc" ? -diff : diff
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(key); setSortDir("desc") }
  }

  const barData = [...visibleModels]
    .sort((a, b) => b[1].total_turns - a[1].total_turns)
    .slice(0, 10)
    .map(([name, m]) => ({
      name: name
        .replace(/^claude-/, "")
        .replace(/^gemini-/, "")
        .split("-").slice(0, 3).join("-"),
      fullName: name,
      Input: m.input_tokens ?? 0,
      Output: m.output_tokens ?? 0,
      "Cache R": m.cache_read_tokens ?? 0,
      "Cache C": m.cache_creation_tokens ?? 0,
      Turns: m.total_turns,
    }))

  const pieData = visibleModels
    .map(([name, m]) => ({
      name: name.replace(/^claude-/, "").replace(/^gemini-/, ""),
      value: m.total_turns,
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const thBase: CSSProperties = {
    padding: "10px 14px",
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.11em",
    color: C.textMuted,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    transition: "color 0.12s",
  }

  const tdBase = (align: "left" | "right" = "right", color = C.textMuted): CSSProperties => ({
    padding: "10px 14px",
    fontSize: 12,
    color,
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: align,
    borderBottom: `1px solid ${C.border}`,
    fontVariantNumeric: "tabular-nums",
  })

  const sectionLabel: CSSProperties = {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.11em",
    color: C.textMuted,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
  }

  return (
    <ColorsCtx.Provider value={C}>
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg) } }
          @keyframes fadeUp { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
          .tr-hover:hover td { background: ${C.bgRow} !important; }
          .th-sort:hover { color: ${C.text} !important; }

          @media (max-width: 767px) {
            .charts-grid { grid-template-columns: 1fr !important; }
            .main-pad { padding: 16px 12px 32px !important; }
            .header-inner { padding: 0 12px !important; gap: 10px !important; }
          }
          @media (max-width: 599px) {
            .tab-label { display: none !important; }
            .header-timestamp { display: none !important; }
            .tab-btn { padding: 6px 8px !important; }
            .stat-card { flex: 1 1 calc(50% - 4px) !important; min-width: calc(50% - 4px) !important; }
            .stat-cards-grid { gap: 6px !important; }
          }
          @media (max-width: 380px) {
            .header-logo-text { display: none !important; }
          }
        `}</style>

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          background: C.headerBg,
          borderBottom: `1px solid ${C.border}`,
          backdropFilter: "blur(12px)",
        }}>
          <div className="header-inner" style={{
            maxWidth: 1320, margin: "0 auto", padding: "0 20px",
            height: 52, display: "flex", alignItems: "center", gap: 20,
          }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
              <div style={{
                width: 26, height: 26,
                background: "linear-gradient(135deg, rgba(74,174,255,0.15), rgba(155,109,255,0.15))",
                border: `1px solid ${C.border}`, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Activity size={13} style={{ color: C.blue }} />
              </div>
              <span className="header-logo-text" style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.02em", color: C.text }}>
                AI Telemetry
              </span>
            </div>

            {/* Service Tabs */}
            <div style={{ display: "flex", flex: 1, justifyContent: "center", gap: 2 }}>
              {TABS.map(tab => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    className="tab-btn"
                    onClick={() => { setActiveTab(tab.id); setSortKey("turns"); setSortDir("desc"); setClaudeDetails(null); setDateRange("all"); setModelFilter("all"); fetchData(tab.id) }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 12px",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      letterSpacing: "0.03em",
                      transition: "all 0.15s",
                      background: active ? C.bgCard : "transparent",
                      color: active ? C.text : C.textMuted,
                      boxShadow: active ? `inset 0 -2px 0 ${C.blue}` : "none",
                    }}
                  >
                    <img src={tab.logo} alt="" style={{ width: 14, height: 14, objectFit: "contain", opacity: active ? 1 : 0.35 }} />
                    <span className="tab-label">{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {lastUpdated && (
                <span className="header-timestamp" style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                  {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <button
                onClick={() => fetchData(activeTab, true)}
                disabled={refreshing}
                style={{ ...btnStyle, opacity: refreshing ? 0.4 : 1 }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderHover)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                aria-label="Refresh"
              >
                <RefreshCw size={14} style={{ color: C.textMuted, animation: refreshing ? "spin 0.7s linear infinite" : "none" }} />
              </button>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* ── Main ───────────────────────────────────────────────────────────── */}
        <main className="main-pad" style={{
          maxWidth: 1320, margin: "0 auto", padding: "24px 20px 40px",
          animation: "fadeUp 0.25s ease",
        }}>

          {/* ── User Context Bar ── */}
          {userInfo && (
            <div style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              flexWrap: "wrap", gap: 16,
              padding: "0 0 20px",
              marginBottom: 24,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                {[
                  { label: "User", value: userInfo.username },
                  { label: "Platform", value: userInfo.os },
                  ...(activeTab === "antigravity" ? [
                    { label: "Quota", value: `${userInfo.total_sessions} / ${userInfo.session_limit}` },
                    { label: "Resets", value: userInfo.limit_reset },
                  ] : []),
                  ...(activeTab === "copilot" ? [
                    { label: "Plan", value: userInfo.copilot_sku || "Standard", color: C.green },
                  ] : []),
                  ...(activeTab === "claude_code" ? [
                    { label: "Source", value: "~/.claude/projects/", mono: true },
                  ] : []),
                  ...(activeTab === "codex" ? [
                    { label: "Source", value: "~/.codex/", mono: true },
                  ] : []),
                ].map(({ label, value, color, mono }) => (
                  <div key={label}>
                    <div style={{ ...sectionLabel, marginBottom: 4 }}>{label}</div>
                    <div style={{
                      fontSize: 12,
                      color: color || C.textMuted,
                      fontFamily: mono ? "'JetBrains Mono', monospace" : "'Space Grotesk', sans-serif",
                      fontWeight: 600,
                    }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quota bar for Antigravity */}
              {activeTab === "antigravity" && userInfo.session_limit > 0 && (
                <div style={{ minWidth: 180 }}>
                  <div style={{ ...sectionLabel, marginBottom: 6 }}>Session Quota</div>
                  <div style={{ height: 3, background: C.quotaTrack, borderRadius: 2, overflow: "hidden", marginBottom: 5 }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min((userInfo.total_sessions / userInfo.session_limit) * 100, 100)}%`,
                      background: userInfo.total_sessions / userInfo.session_limit > 0.8 ? C.red : C.green,
                      transition: "width 1.2s cubic-bezier(0.22,1,0.36,1)",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                    <span>{((userInfo.total_sessions / userInfo.session_limit) * 100).toFixed(0)}% used</span>
                    <span>{userInfo.session_limit - userInfo.total_sessions} left</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Filter Bar ── */}
          {allModels.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
              {/* Model dropdown */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.11em", color: C.textMuted, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, flexShrink: 0 }}>Models</span>
                <select
                  value={modelFilter}
                  onChange={e => setModelFilter(e.target.value)}
                  style={{
                    background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.text, fontSize: 11, padding: "5px 26px 5px 10px",
                    fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", outline: "none",
                    appearance: "none", WebkitAppearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23555' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
                  }}
                >
                  <option value="all">All models</option>
                  {allModels.map(([id]) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>

              {/* Date range pills */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.11em", color: C.textMuted, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, flexShrink: 0 }}>Range</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {DATE_RANGE_LABELS.map(({ id, label }) => {
                    const active = dateRange === id
                    return (
                      <button
                        key={id}
                        onClick={() => setDateRange(id)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 5,
                          border: `1px solid ${active ? C.blue : C.border}`,
                          background: active ? "rgba(74,174,255,0.12)" : "transparent",
                          color: active ? C.blue : C.textMuted,
                          fontSize: 11,
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontWeight: active ? 700 : 500,
                          cursor: "pointer",
                          transition: "all 0.1s",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Stat Cards ── */}
          {allModels.length > 0 && (
            <div className="stat-cards-grid" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
              {caps.turns    && <StatCard label="Turns"       value={statTurns}       color={C.blue} />}
              {caps.prompts  && !useDateFilter && <StatCard label="Prompts"    value={statPrompts}    color={C.orange} />}
              {caps.tools    && !useDateFilter && <StatCard label="Tool Calls" value={statTools}      color={C.purple} />}
              {caps.tokens   && <StatCard label="Input"       value={statInput}       color={C.blue}   fmt={fmtTokens} subtitle="tokens" />}
              {caps.tokens   && <StatCard label="Output"      value={statOutput}      color={C.orange} fmt={fmtTokens} subtitle="tokens" />}
              {caps.cache    && <StatCard label="Cache Read"  value={statCacheRead}   color={C.green}  fmt={fmtTokens} subtitle="tokens" />}
              {caps.cache    && <StatCard label="Cache Write" value={statCacheCreate}  color={C.purple} fmt={fmtTokens} subtitle="tokens" />}
              {caps.steps    && !useDateFilter && <StatCard label="Steps"      value={statSteps}      color={C.gold} />}
              {caps.cost && statCostHasPricing && <StatCard label="Est. Cost" value={statCost} color={C.gold} fmt={fmtCostStat} />}
            </div>
          )}

          {/* ── Daily Chart ── */}
          {caps.dailyChart && claudeDetails && claudeDetails.daily.length > 0 && (() => {
            const isAntigravity = activeTab === "antigravity"
            const hasCache = activeTab === "claude_code"
            return (
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 20px 16px", marginBottom: 12 }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                    {isAntigravity ? "Daily Activity — Last 30 Days" : "Daily Token Usage — Last 30 Days"}
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {isAntigravity ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: C.orange }} />
                        <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>Activity (turns)</span>
                      </div>
                    ) : [
                      { label: "Input", color: C.blue },
                      { label: "Output", color: C.orange },
                      ...(hasCache ? [
                        { label: "Cache Read", color: C.green },
                        { label: "Cache Create", color: C.purple },
                      ] : []),
                    ].map(l => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: l.color }} />
                        <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(filteredDaily.length > 0 ? filteredDaily : claudeDetails.daily).map(d => ({ ...d, label: fmtDateShort(d.date) }))}
                      margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                      barCategoryGap="20%"
                    >
                      <XAxis
                        dataKey="label"
                        axisLine={false} tickLine={false}
                        tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                        dy={6}
                        interval={4}
                      />
                      <YAxis
                        axisLine={false} tickLine={false}
                        tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                        tickFormatter={v => isAntigravity ? String(Math.round(v)) : fmtTokensRaw(v)}
                      />
                      <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(128,128,128,0.06)" }} />
                      {isAntigravity ? (
                        <Bar dataKey="output" name="Activity" fill={C.orange} radius={[3, 3, 0, 0]} maxBarSize={32} />
                      ) : (
                        <>
                          <Bar dataKey="input" name="Input" stackId="a" fill={C.blue} maxBarSize={32} />
                          <Bar dataKey="output" name="Output" stackId="a" fill={C.orange} maxBarSize={32} />
                          {hasCache && <Bar dataKey="cache_read" name="Cache Read" stackId="a" fill={C.green} maxBarSize={32} />}
                          {hasCache && <Bar dataKey="cache_create" name="Cache Create" stackId="a" fill={C.purple} radius={[3, 3, 0, 0]} maxBarSize={32} />}
                        </>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )
          })()}

          {/* ── Hourly Distribution Chart ── */}
          {claudeDetails && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 20px 16px", marginBottom: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Average Hourly Distribution</span>
                  <span style={{ ...sectionLabel, fontSize: "0.52rem", color: C.textDim }}>last 30 days · not affected by range filter</span>
                </div>
                <div style={{ display: "flex", gap: 14 }}>
                  {caps.tokens && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: 2, background: C.orange }} />
                      <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>Avg Output Tokens</span>
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: C.blue }} />
                    <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>Avg Turns</span>
                  </div>
                </div>
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={claudeDetails.hourly.map(h => ({ ...h, label: fmtHour(h.hour) }))}
                    margin={{ top: 4, right: 40, left: -18, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="label"
                      axisLine={false} tickLine={false}
                      tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                      dy={6}
                    />
                    {caps.tokens && (
                      <YAxis
                        yAxisId="left"
                        axisLine={false} tickLine={false}
                        tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                        tickFormatter={v => fmtTokensRaw(v)}
                      />
                    )}
                    <YAxis
                      yAxisId={caps.tokens ? "right" : "left"}
                      orientation={caps.tokens ? "right" : "left"}
                      axisLine={false} tickLine={false}
                      tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: C.tooltipBg,
                        border: `1px solid ${C.border}`,
                        borderRadius: 7,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: C.text,
                      }}
                    />
                    <Bar yAxisId={caps.tokens ? "right" : "left"} dataKey="avg_turns" name="Avg Turns" fill={C.blue} opacity={0.6} maxBarSize={20} radius={[2, 2, 0, 0]} />
                    {caps.tokens && <Line yAxisId="left" type="monotone" dataKey="avg_output" name="Avg Output" stroke={C.orange} strokeWidth={2} dot={{ r: 2, fill: C.orange }} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Charts ── */}
          {allModels.length > 0 && (
            <div className="charts-grid" style={{
              display: "grid",
              gridTemplateColumns: allModels.length > 1 ? "1fr 340px" : "1fr",
              gap: 12,
              marginBottom: 24,
            }}>
              {/* Bar Chart */}
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 20px 16px" }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                    {showTokens ? "Token Usage by Model" : "Turns by Model"}
                  </div>
                  {showTokens && (
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {[
                        { label: "Input", color: C.blue },
                        { label: "Output", color: C.orange },
                        { label: "Cache Read", color: C.green },
                        { label: "Cache Create", color: C.purple },
                      ].map(l => (
                        <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: 2, background: l.color }} />
                          <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>{l.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {showTokens ? (
                      <BarChart data={barData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="30%">
                        <XAxis
                          dataKey="name" axisLine={false} tickLine={false}
                          tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                          dy={6}
                        />
                        <YAxis
                          axisLine={false} tickLine={false}
                          tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                          tickFormatter={v => fmtTokensRaw(v)}
                        />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(128,128,128,0.06)" }} />
                        <Bar dataKey="Input" stackId="a" fill={C.blue} maxBarSize={36} />
                        <Bar dataKey="Output" stackId="a" fill={C.orange} maxBarSize={36} />
                        <Bar dataKey="Cache R" stackId="a" fill={C.green} maxBarSize={36} />
                        <Bar dataKey="Cache C" stackId="a" fill={C.purple} radius={[3, 3, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    ) : (
                      <BarChart data={barData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="35%">
                        <XAxis
                          dataKey="name" axisLine={false} tickLine={false}
                          tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                          dy={6}
                        />
                        <YAxis
                          axisLine={false} tickLine={false}
                          tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                        />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(128,128,128,0.06)" }} />
                        <Bar dataKey="Turns" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Donut Chart */}
              {allModels.length > 1 && (
                <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 20px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>By Model</div>
                  <div style={{ ...sectionLabel, fontSize: "0.55rem", marginBottom: 12 }}>Share of total turns</div>

                  <div style={{ position: "relative", height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%" cy="50%"
                          innerRadius={56} outerRadius={80}
                          dataKey="value"
                          paddingAngle={2}
                          stroke="none"
                          startAngle={90}
                          endAngle={-270}
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: C.tooltipBg,
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 11,
                            color: C.text,
                          }}
                          formatter={(v) => [fmtNum(Number(v)) + " turns"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      pointerEvents: "none",
                    }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 18, fontWeight: 600, color: C.text,
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {fmtTokens(totTurns)}
                      </span>
                      <span style={{ ...sectionLabel, fontSize: "0.52rem", marginTop: 3 }}>turns</span>
                    </div>
                  </div>

                  {/* Legend */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                    {pieData.slice(0, 6).map((d, i) => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <div style={{ width: 5, height: 5, borderRadius: 1, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                          <span style={{
                            fontSize: 10, color: C.textMuted,
                            fontFamily: "'JetBrains Mono', monospace",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {d.name}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, color: PIE_COLORS[i % PIE_COLORS.length], fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                          {totTurns > 0 ? ((d.value / totTurns) * 100).toFixed(1) : "0"}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Model Table ── */}
          {allModels.length > 0 ? (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Model Details</span>
                  <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>
                    {sortedModels.length} {sortedModels.length === 1 ? "model" : "models"} · click headers to sort
                    {useAnyFilter && " · all-time aggregates"}
                  </span>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.tableHeader }}>
                      <th style={{ ...thBase, textAlign: "left", paddingLeft: 18, cursor: "default" }}>Model</th>
                      {caps.turns   && <th className="th-sort" style={{ ...thBase, textAlign: "right" }} onClick={() => handleSort("turns")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Turns<SortIcon active={sortKey === "turns"} dir={sortDir} /></div></th>}
                      {caps.prompts && <th className="th-sort" style={{ ...thBase, textAlign: "right" }} onClick={() => handleSort("prompts")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Prompts<SortIcon active={sortKey === "prompts"} dir={sortDir} /></div></th>}
                      {caps.tools   && <th className="th-sort" style={{ ...thBase, textAlign: "right" }} onClick={() => handleSort("tools")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Tool Calls<SortIcon active={sortKey === "tools"} dir={sortDir} /></div></th>}
                      {caps.tokens  && <th className="th-sort" style={{ ...thBase, textAlign: "right", color: C.blue + "88" }} onClick={() => handleSort("input")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Input<SortIcon active={sortKey === "input"} dir={sortDir} /></div></th>}
                      {caps.tokens  && <th className="th-sort" style={{ ...thBase, textAlign: "right", color: C.orange + "88" }} onClick={() => handleSort("output")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Output<SortIcon active={sortKey === "output"} dir={sortDir} /></div></th>}
                      {caps.cache   && <th className="th-sort" style={{ ...thBase, textAlign: "right", color: C.green + "88" }} onClick={() => handleSort("cache_read")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Cache Read<SortIcon active={sortKey === "cache_read"} dir={sortDir} /></div></th>}
                      {caps.cache   && <th className="th-sort" style={{ ...thBase, textAlign: "right", color: C.purple + "88" }} onClick={() => handleSort("cache_create")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Cache Write<SortIcon active={sortKey === "cache_create"} dir={sortDir} /></div></th>}
                      {caps.steps   && <th className="th-sort" style={{ ...thBase, textAlign: "right", color: C.gold + "88" }} onClick={() => handleSort("steps")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Steps<SortIcon active={sortKey === "steps"} dir={sortDir} /></div></th>}
                      {caps.cost && hasPricing && <th className="th-sort" style={{ ...thBase, textAlign: "right", color: C.gold + "aa" }} onClick={() => handleSort("cost")}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>Est. Cost<SortIcon active={sortKey === "cost"} dir={sortDir} /></div></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.map(([modelId, m], idx) => (
                      <tr key={modelId} className="tr-hover" style={{ background: idx % 2 === 0 ? C.bgCard : C.tableRowAlt }}>
                        <td style={{ ...tdBase("left", C.text), paddingLeft: 18 }}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontFamily: "'JetBrains Mono', monospace",
                            background: C.modelTag,
                            border: `1px solid ${C.modelTagBorder}`,
                            color: C.modelTagText,
                          }}>
                            {modelId}
                          </span>
                        </td>
                        {caps.turns   && <td style={tdBase()}>{fmtNum(m.total_turns)}</td>}
                        {caps.prompts && <td style={tdBase()}>{fmtNum(m.user_prompts)}</td>}
                        {caps.tools   && <td style={tdBase()}>{fmtNum(m.subagent_spawns)}</td>}
                        {caps.tokens  && <td style={tdBase("right", (m.input_tokens ?? 0) > 0 ? C.blue : C.textDim)}>{fmtTokensRaw(m.input_tokens ?? 0)}</td>}
                        {caps.tokens  && <td style={tdBase("right", (m.output_tokens ?? 0) > 0 ? C.orange : C.textDim)}>{fmtTokensRaw(m.output_tokens ?? 0)}</td>}
                        {caps.cache   && <td style={tdBase("right", (m.cache_read_tokens ?? 0) > 0 ? C.green : C.textDim)}>{fmtTokensRaw(m.cache_read_tokens ?? 0)}</td>}
                        {caps.cache   && <td style={tdBase("right", (m.cache_creation_tokens ?? 0) > 0 ? C.purple : C.textDim)}>{fmtTokensRaw(m.cache_creation_tokens ?? 0)}</td>}
                        {caps.steps   && <td style={tdBase("right", m.estimated_steps_executed > 0 ? C.gold : C.textDim)}>{fmtNum(m.estimated_steps_executed)}</td>}
                        {caps.cost && hasPricing && (() => {
                          const cost = calcCost(modelId, m)
                          return <td style={tdBase("right", cost > 0 ? C.gold : C.textDim)}>{fmtCost(cost)}</td>
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "80px 20px" }}>
              <Database size={28} style={{ color: C.textDim, margin: "0 auto 14px", display: "block" }} />
              <div style={{ fontSize: 13, color: C.textDim, fontFamily: "'Space Grotesk', sans-serif" }}>No telemetry data for this service</div>
            </div>
          )}

          {/* ── Copilot note ── */}
          {activeTab === "copilot" && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "28px 24px", marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.textDim, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                Session-level data not available for Copilot — model breakdown above is sourced from VS Code telemetry logs.
              </span>
            </div>
          )}

          {/* ── Top Projects ── */}
          {claudeDetails && Object.keys(filteredProjects).length > 0 && (() => {
            const pm = caps.projectMetric
            const topProjects = Object.entries(filteredProjects)
              .map(([name, p]) => ({
                name,
                Input: p.input_tokens,
                Output: p.output_tokens,
                Turns: p.turns,
                Sessions: p.sessions,
                total: pm === "tokens" ? (p.input_tokens + p.output_tokens) : pm === "turns" ? p.turns : p.sessions,
              }))
              .sort((a, b) => b.total - a.total)
              .slice(0, 10)
            const chartTitle = pm === "tokens" ? "Top Projects by Tokens" : pm === "turns" ? "Top Projects by Turns" : "Top Projects by Sessions"
            return (
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 20px 16px", marginTop: 12 }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>{chartTitle}</div>
                  <div style={{ display: "flex", gap: 14 }}>
                    {pm === "tokens" ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: 2, background: C.blue }} />
                          <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>Input</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: 2, background: C.orange }} />
                          <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>Output</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: C.blue }} />
                        <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>{pm === "turns" ? "Turns" : "Sessions"}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ height: Math.max(180, topProjects.length * 36) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={topProjects}
                      margin={{ top: 0, right: 20, left: 10, bottom: 0 }}
                      barCategoryGap="25%"
                    >
                      <XAxis
                        type="number"
                        axisLine={false} tickLine={false}
                        tick={{ fill: C.textMuted, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                        tickFormatter={v => pm === "tokens" ? fmtTokensRaw(v) : String(Math.round(v))}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        axisLine={false} tickLine={false}
                        tick={{ fill: C.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
                        width={110}
                      />
                      <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(128,128,128,0.06)" }} />
                      {pm === "tokens" ? (
                        <>
                          <Bar dataKey="Input" stackId="a" fill={C.blue} maxBarSize={18} />
                          <Bar dataKey="Output" stackId="a" fill={C.orange} radius={[0, 3, 3, 0]} maxBarSize={18} />
                        </>
                      ) : pm === "turns" ? (
                        <Bar dataKey="Turns" fill={C.blue} radius={[0, 3, 3, 0]} maxBarSize={18} />
                      ) : (
                        <Bar dataKey="Sessions" fill={C.cyan} radius={[0, 3, 3, 0]} maxBarSize={18} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )
          })()}

          {/* ── Recent Sessions Table ── */}
          {claudeDetails && claudeDetails.sessions.length > 0 && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginTop: 12 }}>
              <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Recent Sessions</span>
                  <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>
                    {filteredSessions.length} {dateRange !== "all" || modelFilter !== "all" ? "matching" : "most recent"}
                  </span>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  {(() => {
                    const showTokenCols = caps.tokens
                    const showTurnCol = caps.sessionTurns
                    const cols = ["Session","Project","Last Active","Duration","Model",
                      ...(showTurnCol ? ["Turns"] : []),
                      ...(showTokenCols ? ["Input","Output"] : []),
                      ...(showTokenCols && caps.cost ? ["Est. Cost"] : [])
                    ]
                    return (
                      <>
                        <thead>
                          <tr style={{ background: C.tableHeader }}>
                            {cols.map(col => (
                              <th key={col} style={{ ...thBase, textAlign: col === "Session" || col === "Project" || col === "Model" ? "left" : "right", paddingLeft: col === "Session" ? 18 : undefined, cursor: "default" }}>
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSessions.map((s, idx) => (
                            <tr key={s.session_id + idx} className="tr-hover" style={{ background: idx % 2 === 0 ? C.bgCard : C.tableRowAlt }}>
                              <td style={{ ...tdBase("left", C.text), paddingLeft: 18 }}>
                                <span style={{
                                  display: "inline-block",
                                  padding: "2px 7px",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontFamily: "'JetBrains Mono', monospace",
                                  background: C.modelTag,
                                  border: `1px solid ${C.modelTagBorder}`,
                                  color: C.modelTagText,
                                  letterSpacing: "0.04em",
                                }}>
                                  {s.session_id}
                                </span>
                              </td>
                              <td style={{ ...tdBase("left", C.textMuted), maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {s.project}
                              </td>
                              <td style={tdBase("right", C.textMuted)}>
                                {s.last_active ? fmtDate(s.last_active) : "—"}
                              </td>
                              <td style={tdBase("right", C.textMuted)}>{s.duration_minutes}m</td>
                              <td style={{ ...tdBase("left") }}>
                                <span style={{
                                  display: "inline-block",
                                  padding: "2px 7px",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontFamily: "'JetBrains Mono', monospace",
                                  background: C.modelTag,
                                  border: `1px solid ${C.modelTagBorder}`,
                                  color: /sonnet/i.test(s.model) ? C.blue : /opus/i.test(s.model) ? C.purple : /haiku/i.test(s.model) ? C.green : C.modelTagText,
                                }}>
                                  {s.model.replace("claude-", "").replace("claude-code", "claude")}
                                </span>
                              </td>
                              {showTurnCol && <td style={tdBase("right", C.textMuted)}>{fmtNum(s.turns)}</td>}
                              {showTokenCols && <td style={tdBase("right", s.input_tokens > 0 ? C.blue : C.textDim)}>{fmtTokensRaw(s.input_tokens)}</td>}
                              {showTokenCols && <td style={tdBase("right", s.output_tokens > 0 ? C.orange : C.textDim)}>{fmtTokensRaw(s.output_tokens)}</td>}
                              {showTokenCols && caps.cost && <td style={tdBase("right", s.cost > 0 ? C.gold : C.textDim)}>{fmtCost(s.cost)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )
                  })()}
                </table>
              </div>
            </div>
          )}

          {/* ── Cost by Project Table ── */}
          {caps.cost && claudeDetails && Object.keys(filteredProjects).length > 0 && (() => {
            const sortedProjects = Object.entries(filteredProjects)
              .sort((a, b) => b[1].cost - a[1].cost)
              .slice(0, 20)
            return (
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginTop: 12 }}>
                <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Cost by Project</span>
                    <span style={{ ...sectionLabel, fontSize: "0.55rem" }}>sorted by cost</span>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.tableHeader }}>
                        <th style={{ ...thBase, textAlign: "left", paddingLeft: 18, cursor: "default" }}>Project</th>
                        <th style={{ ...thBase, textAlign: "right", color: C.textMuted, cursor: "default" }}>Sessions</th>
                        {caps.turns  && <th style={{ ...thBase, textAlign: "right", color: C.textMuted, cursor: "default" }}>Turns</th>}
                        {caps.tokens && <th style={{ ...thBase, textAlign: "right", color: C.blue + "88", cursor: "default" }}>Input</th>}
                        {caps.tokens && <th style={{ ...thBase, textAlign: "right", color: C.orange + "88", cursor: "default" }}>Output</th>}
                        {caps.cache  && <th style={{ ...thBase, textAlign: "right", color: C.green + "88", cursor: "default" }}>Cache Read</th>}
                        {caps.cache  && <th style={{ ...thBase, textAlign: "right", color: C.purple + "88", cursor: "default" }}>Cache Write</th>}
                        {caps.cost   && <th style={{ ...thBase, textAlign: "right", color: C.gold + "aa", cursor: "default" }}>Est. Cost</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProjects.map(([name, p], idx) => (
                        <tr key={name} className="tr-hover" style={{ background: idx % 2 === 0 ? C.bgCard : C.tableRowAlt }}>
                          <td style={{ ...tdBase("left", C.text), paddingLeft: 18 }}>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontFamily: "'JetBrains Mono', monospace",
                              background: C.modelTag,
                              border: `1px solid ${C.modelTagBorder}`,
                              color: C.modelTagText,
                            }}>
                              {name}
                            </span>
                          </td>
                          <td style={tdBase()}>{fmtNum(p.sessions)}</td>
                          {caps.turns  && <td style={tdBase()}>{fmtNum(p.turns)}</td>}
                          {caps.tokens && <td style={tdBase("right", p.input_tokens > 0 ? C.blue : C.textDim)}>{fmtTokensRaw(p.input_tokens)}</td>}
                          {caps.tokens && <td style={tdBase("right", p.output_tokens > 0 ? C.orange : C.textDim)}>{fmtTokensRaw(p.output_tokens)}</td>}
                          {caps.cache  && <td style={tdBase("right", p.cache_read_tokens > 0 ? C.green : C.textDim)}>{fmtTokensRaw(p.cache_read_tokens)}</td>}
                          {caps.cache  && <td style={tdBase("right", p.cache_creation_tokens > 0 ? C.purple : C.textDim)}>{fmtTokensRaw(p.cache_creation_tokens)}</td>}
                          {caps.cost   && <td style={tdBase("right", p.cost > 0 ? C.gold : C.textDim)}>{fmtCost(p.cost)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </main>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <footer style={{ borderTop: `1px solid ${C.footerBorder}`, padding: "14px 20px", background: C.footerBg }}>
          <div style={{
            maxWidth: 1320, margin: "0 auto",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 10, color: C.footerText, fontFamily: "'JetBrains Mono', monospace" }}>
              AI Telemetry · <span style={{ color: C.footerTextAlt }}>{userInfo?.username || "—"}</span>
            </span>
            {lastUpdated && (
              <span style={{ fontSize: 10, color: C.footerText, fontFamily: "'JetBrains Mono', monospace" }}>
                {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </footer>
      </div>
    </ColorsCtx.Provider>
  )
}
