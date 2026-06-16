import { useEffect, useState, useCallback } from "react"
import {
  Activity, Moon, Sun, LayoutDashboard, RefreshCw,
  MessageSquare, Zap, Bot, Layers, Coins, Search, ArrowUpDown,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card"
import { Badge } from "./components/ui/badge"
import { useTheme } from "./components/theme-provider"

type TabId = "antigravity" | "copilot" | "claude_code" | "codex"

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

const PIE_COLORS = [
  "hsl(var(--primary))",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="rounded-full p-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </button>
  )
}

function SessionProgress({ current, limit }: { current: number; limit: number }) {
  const pct = Math.min((current / limit) * 100, 100)
  const color = pct > 80 ? "bg-destructive" : pct > 60 ? "bg-yellow-500" : "bg-green-500"
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Sessions Used</span>
        <span className="font-medium">{current} / {limit}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{(100 - pct).toFixed(0)}% remaining this cycle</p>
    </div>
  )
}

function SummaryCards({ models, showTokens }: { models: [string, ModelMetrics][]; showTokens: boolean }) {
  const totalTurns = models.reduce((s, [, m]) => s + m.total_turns, 0)
  const totalPrompts = models.reduce((s, [, m]) => s + m.user_prompts, 0)
  const totalSubagents = models.reduce((s, [, m]) => s + m.subagent_spawns, 0)
  const totalTokens = showTokens
    ? models.reduce((s, [, m]) => s + (m.input_tokens ?? 0) + (m.output_tokens ?? 0), 0)
    : null

  const cards = [
    { label: "Total Turns", value: totalTurns.toLocaleString(), icon: <Activity className="h-4 w-4" />, desc: "All in/out interactions" },
    { label: "User Prompts", value: totalPrompts.toLocaleString(), icon: <MessageSquare className="h-4 w-4" />, desc: "Direct messages sent" },
    { label: "Tool Calls", value: totalSubagents.toLocaleString(), icon: <Bot className="h-4 w-4" />, desc: "Subagents & tool uses" },
    ...(totalTokens !== null
      ? [{ label: "Total Tokens", value: (totalTokens / 1000).toFixed(1) + "K", icon: <Coins className="h-4 w-4" />, desc: "Input + output tokens" }]
      : [{ label: "Script Steps", value: models.reduce((s, [, m]) => s + m.estimated_steps_executed, 0).toLocaleString(), icon: <Zap className="h-4 w-4" />, desc: "Estimated exec steps" }]
    ),
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon, desc }) => (
        <Card key={label} className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <span className="text-muted-foreground">{icon}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{desc}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ModelPieChart({ models }: { models: [string, ModelMetrics][] }) {
  const pieData = models
    .map(([name, m]) => ({ name: name.replace(/^claude-/, "").replace(/^gemini-/, ""), fullName: name, value: m.total_turns }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  if (pieData.length === 0) return null

  return (
    <Card className="shadow-sm border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Model Share</CardTitle>
        <CardDescription>Distribution by interaction turns</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                dataKey="value"
                paddingAngle={2}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "8px",
                  color: "hsl(var(--card-foreground))",
                }}
                formatter={(val, _name, entry: any) => [(Number(val) || 0).toLocaleString() + " turns", entry.payload.fullName]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {pieData.map((d, i) => (
            <span key={d.name} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              {d.name}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TokenBreakdown({ models }: { models: [string, ModelMetrics][] }) {
  const hasTokens = models.some(([, m]) => (m.input_tokens ?? 0) > 0 || (m.output_tokens ?? 0) > 0)
  if (!hasTokens) return null

  const rows = models
    .filter(([, m]) => (m.input_tokens ?? 0) > 0 || (m.output_tokens ?? 0) > 0)
    .map(([name, m]) => ({
      name,
      input: m.input_tokens ?? 0,
      output: m.output_tokens ?? 0,
      cacheRead: m.cache_read_tokens ?? 0,
      cacheCreate: m.cache_creation_tokens ?? 0,
    }))
    .sort((a, b) => (b.input + b.output) - (a.input + a.output))

  return (
    <Card className="shadow-sm border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="h-4 w-4" /> Token Usage</CardTitle>
        <CardDescription>Per-model token breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.name} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium truncate pr-2">{r.name}</span>
                <span className="text-muted-foreground shrink-0">{((r.input + r.output) / 1000).toFixed(1)}K total</span>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>In: {(r.input / 1000).toFixed(1)}K</span>
                <span>Out: {(r.output / 1000).toFixed(1)}K</span>
                {r.cacheRead > 0 && <span>Cache↓: {(r.cacheRead / 1000).toFixed(1)}K</span>}
                {r.cacheCreate > 0 && <span>Cache↑: {(r.cacheCreate / 1000).toFixed(1)}K</span>}
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
                {r.input > 0 && (
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(r.input / (r.input + r.output + r.cacheRead)) * 100}%` }}
                  />
                )}
                {r.output > 0 && (
                  <div
                    className="h-full bg-purple-500"
                    style={{ width: `${(r.output / (r.input + r.output + r.cacheRead)) * 100}%` }}
                  />
                )}
                {r.cacheRead > 0 && (
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${(r.cacheRead / (r.input + r.output + r.cacheRead)) * 100}%` }}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-4 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" />Input</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />Output</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Cache Hit</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function App() {
  const [data, setData] = useState<AllMetrics | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("claude_code")
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"turns" | "tokens" | "prompts" | "tools">("turns")

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [metricsRes, userRes] = await Promise.all([
        fetch("/api/metrics").then(r => r.json()),
        fetch("/api/user").then(r => r.json()),
      ])
      if (metricsRes.status === "success" && userRes.status === "success") {
        setData(metricsRes.data)
        setUserInfo(userRes.data)
        setLastUpdated(new Date())
      } else {
        setError(metricsRes.message || userRes.message || "Unknown error")
      }
    } catch (err) {
      setError("Failed to fetch data from backend")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const tabs: { id: TabId; label: string; logo: string }[] = [
    { id: "claude_code", label: "Claude Code", logo: "/claudecode_logo.png" },
    { id: "codex", label: "Codex", logo: "/codex_logo.png" },
    { id: "antigravity", label: "Antigravity", logo: "/antigravity_logo.png" },
    { id: "copilot", label: "GitHub Copilot", logo: "/github_logo.png" },
  ]

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Activity className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-destructive/50 bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-destructive text-center">Error Loading Data</CardTitle>
            <CardDescription className="text-center">{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const currentData = data ? (data[activeTab] ?? {}) : {}
  const showTokens = activeTab === "claude_code" || activeTab === "codex"

  const sortFn = (a: [string, ModelMetrics], b: [string, ModelMetrics]) => {
    const [, am] = a; const [, bm] = b
    if (sortBy === "turns") return bm.total_turns - am.total_turns
    if (sortBy === "tokens") return ((bm.input_tokens ?? 0) + (bm.output_tokens ?? 0)) - ((am.input_tokens ?? 0) + (am.output_tokens ?? 0))
    if (sortBy === "prompts") return bm.user_prompts - am.user_prompts
    return bm.subagent_spawns - am.subagent_spawns
  }

  const allModels = Object.entries(currentData)
  const models = allModels
    .filter(([name]) => name.toLowerCase().includes(search.toLowerCase()))
    .sort(sortFn)

  const chartData = allModels
    .map(([name, metrics]) => ({
      name: name.replace(/^claude-/, "").replace(/^gemini-/, "").split("-").slice(0, 3).join("-"),
      "Interaction Turns": metrics.total_turns,
      "Script Steps": metrics.estimated_steps_executed,
      fullName: name,
    }))
    .sort((a, b) => b["Interaction Turns"] - a["Interaction Turns"])

  return (
    <div className="min-h-screen bg-background text-foreground font-sans transition-colors duration-300">
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-0 sm:h-16 flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-0">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <span className="font-bold tracking-tight text-lg">AI Telemetry</span>
          </div>
          <div className="flex flex-wrap justify-center gap-1 bg-secondary rounded-xl sm:rounded-full p-1 w-full sm:w-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSearch(""); setSortBy("turns") }}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${activeTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <img src={tab.logo} alt={tab.label} className="w-4 h-4 object-contain" />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="rounded-full p-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
              aria-label="Refresh data"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6 mt-4">

        {/* Environment Card */}
        {userInfo && (
          <Card className="shadow-sm border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <img src={tabs.find(t => t.id === activeTab)?.logo} alt="" className="w-4 h-4 object-contain" />
                {activeTab === "claude_code" ? "Claude Code Environment"
                  : activeTab === "antigravity" ? "Antigravity Environment"
                  : activeTab === "codex" ? "Codex Environment"
                  : "GitHub Copilot Status"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeTab === "codex" ? (
                <div className="flex flex-wrap gap-6">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">User</p>
                    <p className="font-semibold">{userInfo.username}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">System</p>
                    <p className="font-semibold">{userInfo.os}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Sessions Tracked</p>
                    <p className="font-semibold">{data ? Object.values(data.codex).reduce((s, m) => s + m.total_turns, 0).toLocaleString() : "—"} turns</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Data Source</p>
                    <p className="font-semibold font-mono text-xs">~/.codex/</p>
                  </div>
                </div>
              ) : activeTab === "antigravity" ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-6">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">User</p>
                      <p className="font-semibold">{userInfo.username}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">System</p>
                      <p className="font-semibold">{userInfo.os}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Python Runtime</p>
                      <p className="font-semibold">{userInfo.python_version}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Quota Reset</p>
                      <p className="font-semibold">{userInfo.limit_reset}</p>
                    </div>
                  </div>
                  <SessionProgress current={userInfo.total_sessions} limit={userInfo.session_limit} />
                </div>
              ) : activeTab === "copilot" ? (
                <div className="flex flex-wrap gap-6">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">GitHub Account</p>
                    <p className="font-semibold">{userInfo.username}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Copilot Plan</p>
                    <p className="font-semibold">{userInfo.copilot_sku || "Standard"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Status</p>
                    <p className="font-semibold text-green-500">Active</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Chat Limit</p>
                    <p className="font-semibold">Unlimited <span className="text-muted-foreground text-sm font-normal">(Premium)</span></p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-6">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">User</p>
                    <p className="font-semibold">{userInfo.username}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">System</p>
                    <p className="font-semibold">{userInfo.os}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Projects Tracked</p>
                    <p className="font-semibold">{data && Object.keys(data.claude_code).length > 0 ? "Active" : "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Data Source</p>
                    <p className="font-semibold font-mono text-xs">~/.claude/projects/</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Stats */}
        {models.length > 0 && (
          <SummaryCards models={models} showTokens={showTokens} />
        )}

        {/* Charts Row */}
        {models.length > 0 && (
          <div className={`grid gap-4 ${showTokens ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
            <Card className="shadow-sm border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>Usage Overview</CardTitle>
                <CardDescription>Interaction turns per model</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        dy={10}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted)/0.4)" }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "8px",
                          color: "hsl(var(--card-foreground))",
                        }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ""}
                      />
                      <Legend wrapperStyle={{ paddingTop: "16px" }} />
                      <Bar dataKey="Interaction Turns" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      {!showTokens && (
                        <Bar dataKey="Script Steps" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {models.length > 1 ? (
              <ModelPieChart models={models} />
            ) : showTokens ? (
              <TokenBreakdown models={models} />
            ) : null}
          </div>
        )}

        {/* Token breakdown when pie isn't shown */}
        {showTokens && models.length > 1 && (
          <TokenBreakdown models={models} />
        )}

        {/* Filter Bar */}
        {allModels.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter models..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex gap-1 bg-secondary rounded-lg p-1">
                {(["turns", "tokens", "prompts", "tools"] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => setSortBy(opt)}
                    disabled={opt === "tokens" && !showTokens}
                    className={`px-3 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${sortBy === opt ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Detailed Grid */}
        <div>
          <h3 className="text-xl font-semibold tracking-tight mb-4">
            Model Details
            {search && <span className="text-sm font-normal text-muted-foreground ml-2">({models.length} of {allModels.length})</span>}
          </h3>
          {models.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <CardTitle className="text-muted-foreground font-normal">No telemetry data found.</CardTitle>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {models.map(([modelId, metrics]) => (
                <Card key={modelId} className="shadow-sm border-border/50 hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base font-medium leading-tight pr-4 break-all">
                        {modelId}
                      </CardTitle>
                      <Badge variant="secondary" className="font-normal text-xs shrink-0">Active</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Turns</p>
                        <p className="text-2xl font-semibold">{metrics.total_turns.toLocaleString()}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {showTokens ? "Tokens" : "Steps"}
                        </p>
                        <p className="text-2xl font-semibold">
                          {showTokens
                            ? (((metrics.input_tokens ?? 0) + (metrics.output_tokens ?? 0)) / 1000).toFixed(1) + "K"
                            : metrics.estimated_steps_executed.toLocaleString()
                          }
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Prompts</p>
                        <p className="text-lg font-medium">{metrics.user_prompts.toLocaleString()}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {showTokens ? "Tool Calls" : "Subagents"}
                        </p>
                        <p className="text-lg font-medium">{metrics.subagent_spawns.toLocaleString()}</p>
                      </div>
                      {showTokens && (metrics.cache_read_tokens ?? 0) > 0 && (
                        <div className="col-span-2 pt-1 border-t border-border/50">
                          <p className="text-xs text-muted-foreground mb-1">Cache Performance</p>
                          <div className="flex gap-3 text-xs">
                            <span className="text-green-500">↓ {((metrics.cache_read_tokens ?? 0) / 1000).toFixed(1)}K read</span>
                            <span className="text-blue-500">↑ {((metrics.cache_creation_tokens ?? 0) / 1000).toFixed(1)}K created</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

      </main>

      <footer className="mt-12 py-6 border-t border-border/40 bg-muted/20">
        <div className="max-w-6xl mx-auto px-6 flex justify-between items-center text-sm text-muted-foreground">
          <div className="flex gap-4 items-center">
            <span>By <span className="font-medium text-foreground">{userInfo?.username || "Dev"}</span></span>
            <span>•</span>
            <a href="https://github.com/ashutoshswamy" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
              GitHub
            </a>
          </div>
          {lastUpdated && (
            <span className="text-xs">Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
      </footer>
    </div>
  )
}

export default App
