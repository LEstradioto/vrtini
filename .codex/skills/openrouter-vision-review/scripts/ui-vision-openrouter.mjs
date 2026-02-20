#!/usr/bin/env node

/**
 * UI Vision Review (OpenRouter + Gemini Flash)
 *
 * Purpose:
 * - Analyze a route screenshot with a vision model
 * - Return structured UX/design issues as JSON
 *
 * Usage:
 *   node scripts/ui-vision-openrouter.mjs --report tmp/ui-design-pipeline/<run>/report.json --route /organizations
 *
 * Env vars:
 *   OPENROUTER_API_KEY         loaded from .env in project root if not already exported
 *   UI_VISION_MODEL            default: google/gemini-3-flash-preview
 *   UI_VISION_OUT              default: tmp/ui-quality/<run-id>/vision-issues.json
 *   UI_VISION_DRY_RUN          default: 0 (set 1 for offline stub output)
 *   UI_VISION_MAX_ISSUES       default: 12
 *   UI_VISION_ROUTE            fallback route if --route is omitted
 *   UI_VISION_IMAGE            explicit image path (overrides route mapping)
 *   UI_VISION_TIMEOUT_MS       default: 45000
 *   UI_VISION_SEED             default: 7
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import process from "node:process"

const FALLBACK_MODEL = "google/gemini-3-flash-preview"
const FALLBACK_MAX_ISSUES = 12
const FALLBACK_TIMEOUT_MS = 45000
const FALLBACK_SEED = 7
const DRY_RUN = (process.env.UI_VISION_DRY_RUN ?? "0") === "1"

const VALID_SEVERITIES = new Set(["blocker", "major", "minor", "suggestion"])
const VALID_CATEGORIES = new Set(["broken", "regression", "improvement"])
const SEVERITY_ORDER = new Map([
  ["blocker", 0],
  ["major", 1],
  ["minor", 2],
  ["suggestion", 3],
])

const ROUTE_TO_SCREENSHOT = new Map([
  ["/", "01-dashboard"],
  ["/organizations", "02-organizations-index"],
  ["/people", "03-people-index"],
  ["/deals", "04-deals-kanban"],
  ["/projects", "05-projects-index"],
  ["/pipes", "06-pipes-index"],
  ["/deal_stages", "07-deal-stages-index"],
  ["/activity_types", "08-activity-types-index"],
])

function parsePositiveInt(value, fallback) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseArgs(argv) {
  const parsed = { report: null, route: null, image: null, out: null, model: null }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const value = argv[i + 1]

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`)
    }

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`)
    }

    if (token === "--report") parsed.report = value
    else if (token === "--route") parsed.route = value
    else if (token === "--image") parsed.image = value
    else if (token === "--out") parsed.out = value
    else if (token === "--model") parsed.model = value
    else throw new Error(`Unknown argument: ${token}`)

    i += 1
  }

  return parsed
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return false
  const raw = readFileSync(envPath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
  return true
}

function warnIfEnvFilePermissionsAreUnsafe(envPath) {
  if (process.platform === "win32") return
  try {
    const mode = statSync(envPath).mode & 0o777
    const isOwnerOnly = (mode & 0o077) === 0
    if (!isOwnerOnly) {
      console.warn(
        `Warning: ${envPath} is readable by group/others. Consider running: chmod 600 ${envPath}`
      )
    }
  } catch {
    // best effort only
  }
}

function loadRootDotEnvIfPresent() {
  const envPath = resolve(process.cwd(), ".env")
  if (!existsSync(envPath)) return
  warnIfEnvFilePermissionsAreUnsafe(envPath)
  loadEnvFile(envPath)
}

function findLatestReportPath() {
  const root = resolve(process.cwd(), "tmp/ui-design-pipeline")
  if (!existsSync(root)) return null
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "report.json"))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates[0]?.path ?? null
}

function inferOutputPath(reportPath, explicitOut) {
  if (explicitOut) return resolve(explicitOut)
  if (process.env.UI_VISION_OUT) return resolve(process.env.UI_VISION_OUT)
  const runId = reportPath ? basename(dirname(reportPath)) : "manual"
  return resolve(process.cwd(), `tmp/ui-quality/${runId}/vision-issues.json`)
}

function normalizeRoute(input) {
  if (!input) return "/"
  const route = input.trim()
  if (!route.startsWith("/")) return `/${route}`
  return route
}

function detectImagePath({ reportPath, report, route, explicitImage }) {
  if (explicitImage) return resolve(explicitImage)
  if (process.env.UI_VISION_IMAGE) return resolve(process.env.UI_VISION_IMAGE)

  const baseName = ROUTE_TO_SCREENSHOT.get(route)
  if (!baseName) throw new Error(`No screenshot mapping configured for route: ${route}`)

  const outDir = report.outDir ? resolve(report.outDir) : dirname(reportPath)
  const path = join(outDir, `${baseName}.png`)
  if (!existsSync(path)) throw new Error(`Screenshot not found for route ${route}: ${path}`)
  return path
}

function toDataUrl(imagePath) {
  const raw = readFileSync(imagePath)
  const b64 = raw.toString("base64")
  const lower = imagePath.toLowerCase()
  const mime = lower.endsWith(".webp")
    ? "image/webp"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png"
  return `data:${mime};base64,${b64}`
}

function buildPrompt(route, maxIssues) {
  return [
    "Analyze this UI screenshot for usability and visual design quality.",
    `Route: ${route}`,
    "",
    "Return only JSON with this exact shape:",
    "{",
    '  "summary": "one-line summary",',
    '  "issues": [',
    "    {",
    '      "severity": "blocker|major|minor|suggestion",',
    '      "category": "broken|regression|improvement",',
    '      "title": "short title",',
    '      "evidence": "what in the screenshot indicates this",',
    '      "recommendation": "specific improvement",',
    '      "confidence": 0.0',
    "    }",
    "  ]",
    "}",
    "",
    `Return at most ${maxIssues} issues.`,
    "Focus on:",
    "- alignment and spacing rhythm",
    "- typography readability (uppercase overuse, hierarchy)",
    "- visual consistency and component quality",
    "- affordance and likely usability blockers",
    "",
    "Do not include markdown fences or prose outside JSON.",
  ].join("\n")
}

function parseModelJson(text) {
  const trimmed = String(text || "").trim()
  if (!trimmed) throw new Error("Vision model returned empty content")

  try {
    return JSON.parse(trimmed)
  } catch {
    const firstBrace = trimmed.indexOf("{")
    const lastBrace = trimmed.lastIndexOf("}")
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
    }
    throw new Error("Failed to parse JSON response from model")
  }
}

function extractMessageText(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  const text = content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object" && typeof part.text === "string") return part.text
      return ""
    })
    .join("\n")

  return text.trim()
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback
  const cleaned = value.replace(/\s+/g, " ").trim()
  return cleaned || fallback
}

function normalizeConfidence(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const clamped = Math.max(0, Math.min(1, parsed))
  return Number(clamped.toFixed(2))
}

function normalizeIssues(payload, route, maxIssues) {
  const rawIssues = Array.isArray(payload?.issues) ? payload.issues : []
  const normalized = rawIssues.slice(0, maxIssues).map((issue) => {
    const severity = cleanText(issue?.severity, "minor").toLowerCase()
    const category = cleanText(issue?.category, "improvement").toLowerCase()

    return {
      source: "vision-openrouter",
      severity: VALID_SEVERITIES.has(severity) ? severity : "minor",
      category: VALID_CATEGORIES.has(category) ? category : "improvement",
      route,
      title: cleanText(issue?.title, "Vision finding"),
      evidence: cleanText(issue?.evidence),
      recommendation: cleanText(issue?.recommendation),
      confidence: normalizeConfidence(issue?.confidence),
    }
  })

  normalized.sort((a, b) => {
    const severityCmp = (SEVERITY_ORDER.get(a.severity) ?? 99) - (SEVERITY_ORDER.get(b.severity) ?? 99)
    if (severityCmp !== 0) return severityCmp
    return a.title.localeCompare(b.title)
  })

  return normalized.map((issue, idx) => ({
    id: `vision-${route.replace(/[^\w]+/g, "-")}-${idx + 1}`,
    ...issue,
  }))
}

async function callOpenRouter({ apiKey, model, prompt, imageDataUrl, timeoutMs, seed }) {
  const body = {
    model,
    temperature: 0,
    top_p: 1,
    seed,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict senior product designer and UX reviewer. Return only valid JSON matching the requested shape.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  }

  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), timeoutMs)

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.UI_VISION_HTTP_REFERER || "http://localhost/erp-004",
        "X-Title": process.env.UI_VISION_APP_TITLE || "erp-004-ui-quality",
      },
      signal: abortController.signal,
      body: JSON.stringify(body),
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`OpenRouter request failed (${response.status}): ${raw.slice(0, 800)}`)
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`OpenRouter returned non-JSON response: ${raw.slice(0, 800)}`)
    }

    const content = extractMessageText(parsed?.choices?.[0]?.message?.content)
    if (!content) throw new Error("OpenRouter response missing choices[0].message.content text")
    return content
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  loadRootDotEnvIfPresent()
  const model = args.model || process.env.UI_VISION_MODEL || process.env.OPENROUTER_MODEL || FALLBACK_MODEL
  const maxIssues = parsePositiveInt(process.env.UI_VISION_MAX_ISSUES, FALLBACK_MAX_ISSUES)
  const timeoutMs = parsePositiveInt(process.env.UI_VISION_TIMEOUT_MS, FALLBACK_TIMEOUT_MS)
  const seed = parsePositiveInt(process.env.UI_VISION_SEED, FALLBACK_SEED)

  const explicitImagePath = args.image || process.env.UI_VISION_IMAGE
  const shouldResolveReport = Boolean(args.report) || !explicitImagePath
  const reportPathCandidate = shouldResolveReport
    ? (args.report ? resolve(args.report) : (findLatestReportPath() || ""))
    : ""
  const hasReportPath = Boolean(reportPathCandidate)

  if (!hasReportPath && !explicitImagePath) {
    throw new Error("report.json not found. Pass --report or generate ui-design-pipeline output first.")
  }
  if (hasReportPath && !existsSync(reportPathCandidate)) {
    throw new Error(`report.json not found at ${reportPathCandidate}`)
  }

  const route = normalizeRoute(args.route || process.env.UI_VISION_ROUTE || "/")
  const report = hasReportPath ? JSON.parse(readFileSync(reportPathCandidate, "utf8")) : {}
  const imagePath = detectImagePath({
    reportPath: reportPathCandidate,
    report,
    route,
    explicitImage: args.image,
  })
  const outPath = inferOutputPath(hasReportPath ? reportPathCandidate : null, args.out)
  mkdirSync(dirname(outPath), { recursive: true })

  let normalizedIssues = []
  let summary = ""

  if (DRY_RUN) {
    normalizedIssues = [
      {
        id: `vision-${route.replace(/[^\w]+/g, "-")}-dry-1`,
        source: "vision-openrouter",
        severity: "minor",
        category: "improvement",
        route,
        title: "Dry-run sample finding",
        evidence: "UI_VISION_DRY_RUN=1",
        recommendation: "Disable dry-run and set OPENROUTER_API_KEY in project-root .env for real vision analysis.",
        confidence: 0.99,
      },
    ]
    summary = "Dry-run mode; no external API call was made."
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is missing. Add it to the project root .env or export it in your shell.")
    }

    const prompt = buildPrompt(route, maxIssues)
    const imageDataUrl = toDataUrl(imagePath)
    const content = await callOpenRouter({
      apiKey,
      model,
      prompt,
      imageDataUrl,
      timeoutMs,
      seed,
    })

    const parsed = parseModelJson(content)
    normalizedIssues = normalizeIssues(parsed, route, maxIssues)
    summary = cleanText(parsed?.summary, "Vision review completed.")
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    provider: "openrouter",
    model,
    route,
    reportPath: hasReportPath ? reportPathCandidate : null,
    imagePath,
    dryRun: DRY_RUN,
    summary,
    issues: normalizedIssues,
  }

  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`Vision review finished. Output: ${outPath}`)
  console.log(`Model: ${model}`)
  console.log(`Route: ${route}`)
  console.log(`Image: ${imagePath}`)
  console.log(`Issues: ${normalizedIssues.length}`)
}

run().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
