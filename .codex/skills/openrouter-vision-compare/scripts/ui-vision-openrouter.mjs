#!/usr/bin/env node

/**
 * UI Vision Compare (OpenRouter + Gemini)
 *
 * Modes:
 * - Compare mode: --baseline + --test (+ optional --diff), with optional chunking
 * - Legacy single-image mode: --image
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import process from "node:process"
import { PNG } from "pngjs"

const FALLBACK_MODEL = "google/gemini-3-flash-preview"
const FALLBACK_MAX_ISSUES = 12
const FALLBACK_TIMEOUT_MS = 45000
const FALLBACK_SEED = 7
const FALLBACK_CHUNKS = 1
const FALLBACK_ALIGN_MAX_SHIFT = 220
const DRY_RUN = (process.env.UI_VISION_DRY_RUN ?? "0") === "1"

const VALID_SEVERITIES = new Set(["blocker", "major", "minor", "suggestion"])
const VALID_CATEGORIES = new Set(["broken", "regression", "improvement"])
const VALID_VERDICTS = new Set(["approve", "review", "reject"])

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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return fallback
}

function parseArgs(argv) {
  const parsed = {
    report: null,
    route: null,
    image: null,
    baseline: null,
    test: null,
    diff: null,
    out: null,
    model: null,
    chunks: null,
    chunkHeight: null,
    useDiff: null,
    alignMaxShift: null,
  }

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
    else if (token === "--baseline") parsed.baseline = value
    else if (token === "--test") parsed.test = value
    else if (token === "--diff") parsed.diff = value
    else if (token === "--out") parsed.out = value
    else if (token === "--model") parsed.model = value
    else if (token === "--chunks") parsed.chunks = value
    else if (token === "--chunk-height") parsed.chunkHeight = value
    else if (token === "--use-diff") parsed.useDiff = value
    else if (token === "--align-max-shift") parsed.alignMaxShift = value
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback
  const cleaned = value.replace(/\s+/g, " ").trim()
  return cleaned || fallback
}

function normalizeConfidence(value, fallback = null) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const clamped = Math.max(0, Math.min(1, parsed))
  return Number(clamped.toFixed(2))
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

  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object" && typeof part.text === "string") return part.text
      return ""
    })
    .join("\n")
    .trim()
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

function detectLegacyImagePath({ reportPath, report, route, explicitImage }) {
  if (explicitImage) return resolve(explicitImage)
  if (process.env.UI_VISION_IMAGE) return resolve(process.env.UI_VISION_IMAGE)

  const baseName = ROUTE_TO_SCREENSHOT.get(route)
  if (!baseName) throw new Error(`No screenshot mapping configured for route: ${route}`)

  const outDir = report.outDir ? resolve(report.outDir) : dirname(reportPath)
  const path = join(outDir, `${baseName}.png`)
  if (!existsSync(path)) throw new Error(`Screenshot not found for route ${route}: ${path}`)
  return path
}

function buildSinglePrompt(route, maxIssues) {
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
    `Return at most  issues.`,
    "Focus on:",
    "- alignment and spacing rhythm",
    "- typography readability",
    "- visual consistency and component quality",
    "- affordance and usability blockers",
    "",
    "Do not include markdown fences or prose outside JSON.",
  ].join("\n")
}

function buildComparePrompt(route, maxIssues, chunk, totalChunks) {
  const chunkLabel = totalChunks > 1
    ? `Chunk ${chunk.index}/${totalChunks} (y=${chunk.y}, height=${chunk.height})`
    : "Whole page"

  return [
    "Compare baseline and test screenshots for visual regression assessment.",
    `Route: ${route}`,
    `Scope: ${chunkLabel}`,
    "",
    "Image order:",
    "1) BASELINE (expected)",
    "2) TEST (current)",
    "3) DIFF MAP (optional helper showing changed pixels)",
    "",
    "Important:",
    "- Focus on differences between baseline and test.",
    "- Diff-map highlight colors are diagnostic overlays, not UI colors.",
    "- Do NOT report generic design critique unrelated to baseline-vs-test deltas.",
    "",
    "Return only JSON with this exact shape:",
    "{",
    '  "summary": "one-line comparison summary",',
    '  "verdict": "approve|review|reject",',
    '  "confidence": 0.0,',
    '  "findings": [',
    "    {",
    '      "severity": "blocker|major|minor|suggestion",',
    '      "category": "broken|regression|improvement",',
    '      "title": "short title",',
    '      "evidence": "what changed and where",',
    '      "recommendation": "specific next action",',
    '      "confidence": 0.0',
    "    }",
    "  ]",
    "}",
    "",
    `Return at most  findings for this scope.`,
    "",
    "Decision rubric:",
    "- approve: no meaningful user-facing regression",
    "- review: noticeable but non-critical differences",
    "- reject: clear regression or broken UX",
    "",
    "Do not include markdown fences or prose outside JSON.",
  ].join("\n")
}

async function callOpenRouter({ apiKey, model, prompt, images, timeoutMs, seed }) {
  const content = [{ type: "text", text: prompt }]
  for (const image of images) {
    content.push({ type: "text", text: image.label })
    content.push({ type: "image_url", image_url: { url: image.dataUrl } })
  }

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
          "You are a strict visual QA reviewer. Return only valid JSON matching the requested shape.",
      },
      {
        role: "user",
        content,
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
        "HTTP-Referer": process.env.UI_VISION_HTTP_REFERER || "http://localhost/vrt",
        "X-Title": process.env.UI_VISION_APP_TITLE || "vrt-ui-quality",
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

    const text = extractMessageText(parsed?.choices?.[0]?.message?.content)
    if (!text) throw new Error("OpenRouter response missing message content")
    return text
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function normalizeSingleIssues(payload, route, maxIssues) {
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

function normalizeCompareChunk(payload, route, chunk, maxIssues) {
  const verdictRaw = cleanText(payload?.verdict, "review").toLowerCase()
  const verdict = VALID_VERDICTS.has(verdictRaw) ? verdictRaw : "review"
  const confidence = normalizeConfidence(payload?.confidence, 0.6)
  const summary = cleanText(payload?.summary, "Comparison completed.")
  const rawFindings = Array.isArray(payload?.findings)
    ? payload.findings
    : Array.isArray(payload?.issues)
      ? payload.issues
      : []

  const findings = rawFindings.slice(0, maxIssues).map((issue, idx) => {
    const severity = cleanText(issue?.severity, "minor").toLowerCase()
    const category = cleanText(issue?.category, "regression").toLowerCase()
    return {
      id: `vision-${route.replace(/[^\w]+/g, "-")}-c${chunk.index}-${idx + 1}`,
      source: "vision-openrouter",
      severity: VALID_SEVERITIES.has(severity) ? severity : "minor",
      category: VALID_CATEGORIES.has(category) ? category : "regression",
      route,
      chunkIndex: chunk.index,
      chunkY: chunk.y,
      chunkHeight: chunk.height,
      chunkBaselineY: chunk.baselineY ?? chunk.y,
      chunkTestY: chunk.testY ?? chunk.y,
      chunkAlignedHeight: chunk.alignedHeight ?? chunk.height,
      title: cleanText(issue?.title, "Comparison finding"),
      evidence: cleanText(issue?.evidence),
      recommendation: cleanText(issue?.recommendation),
      confidence: normalizeConfidence(issue?.confidence),
    }
  })

  findings.sort((a, b) => {
    const severityCmp = (SEVERITY_ORDER.get(a.severity) ?? 99) - (SEVERITY_ORDER.get(b.severity) ?? 99)
    if (severityCmp !== 0) return severityCmp
    return a.title.localeCompare(b.title)
  })

  return {
    index: chunk.index,
    y: chunk.y,
    height: chunk.height,
    baselineY: chunk.baselineY ?? chunk.y,
    testY: chunk.testY ?? chunk.y,
    alignedHeight: chunk.alignedHeight ?? chunk.height,
    verdict,
    confidence,
    summary,
    issues: findings,
  }
}

function readPngSafely(path) {
  if (!path || !existsSync(path)) return null
  try {
    return PNG.sync.read(readFileSync(path))
  } catch {
    return null
  }
}

function cropPng(png, y, height) {
  const safeY = Math.max(0, Math.min(y, png.height - 1))
  const safeH = Math.max(1, Math.min(height, png.height - safeY))
  const out = new PNG({ width: png.width, height: safeH })

  for (let row = 0; row < safeH; row += 1) {
    const srcStart = ((safeY + row) * png.width) * 4
    const srcEnd = srcStart + png.width * 4
    const dstStart = (row * png.width) * 4
    png.data.copy(out.data, dstStart, srcStart, srcEnd)
  }

  return out
}

function writePng(path, png) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, PNG.sync.write(png))
}

function buildChunkRanges(totalHeight, chunks, chunkHeight) {
  if (chunkHeight > 0) {
    const ranges = []
    for (let y = 0, idx = 1; y < totalHeight; y += chunkHeight, idx += 1) {
      ranges.push({ index: idx, y, height: Math.min(chunkHeight, totalHeight - y) })
    }
    return ranges
  }

  if (chunks <= 1) {
    return [{ index: 1, y: 0, height: totalHeight }]
  }

  const ranges = []
  const base = Math.floor(totalHeight / chunks)
  let remainder = totalHeight % chunks
  let cursor = 0
  for (let i = 0; i < chunks; i += 1) {
    const add = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder -= 1
    const height = Math.max(1, base + add)
    ranges.push({ index: i + 1, y: cursor, height })
    cursor += height
  }
  return ranges.filter((range) => range.y < totalHeight)
}

function buildRowSignatureSeries(png) {
  const sampleStep = Math.max(1, Math.floor(png.width / 256))
  const rows = new Array(png.height)

  for (let y = 0; y < png.height; y += 1) {
    let luminanceSum = 0
    let alphaSum = 0
    let count = 0

    for (let x = 0; x < png.width; x += sampleStep) {
      const idx = (y * png.width + x) * 4
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]
      const a = png.data[idx + 3] / 255
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

      luminanceSum += luminance * a
      alphaSum += a
      count += 1
    }

    rows[y] = {
      luma: count > 0 ? luminanceSum / count : 0,
      alpha: count > 0 ? alphaSum / count : 0,
    }
  }

  return rows
}

function estimateVerticalOffset(baselinePng, testPng, requestedMaxShift) {
  const safeMaxShift = Math.max(
    0,
    Math.min(
      requestedMaxShift,
      Math.floor(Math.min(baselinePng.height, testPng.height) * 0.2)
    )
  )
  if (safeMaxShift === 0) return 0

  const baselineRows = buildRowSignatureSeries(baselinePng)
  const testRows = buildRowSignatureSeries(testPng)
  const minOverlapRows = Math.max(
    120,
    Math.floor(Math.min(baselinePng.height, testPng.height) * 0.35)
  )

  let bestShift = 0
  let bestScore = Number.POSITIVE_INFINITY

  for (let shift = -safeMaxShift; shift <= safeMaxShift; shift += 1) {
    const baselineStart = Math.max(0, -shift)
    const testStart = Math.max(0, shift)
    const overlap = Math.min(
      baselinePng.height - baselineStart,
      testPng.height - testStart
    )

    if (overlap < minOverlapRows) continue

    let score = 0
    for (let row = 0; row < overlap; row += 1) {
      const b = baselineRows[baselineStart + row]
      const t = testRows[testStart + row]
      const lumaDelta = Math.abs(b.luma - t.luma)
      const alphaDelta = Math.abs(b.alpha - t.alpha)
      score += lumaDelta * 0.85 + alphaDelta * 0.15
    }

    score /= overlap
    if (score < bestScore) {
      bestScore = score
      bestShift = shift
    } else if (score === bestScore && Math.abs(shift) < Math.abs(bestShift)) {
      bestShift = shift
    }
  }

  return bestShift
}

function resolveAlignedRange(range, baselineHeight, testHeight, verticalOffset) {
  let baselineY = range.y
  let testY = baselineY + verticalOffset
  let height = range.height

  if (testY < 0) {
    const trim = -testY
    baselineY += trim
    height -= trim
    testY = 0
  }

  if (baselineY < 0) {
    const trim = -baselineY
    testY += trim
    height -= trim
    baselineY = 0
  }

  if (baselineY >= baselineHeight || testY >= testHeight) return null

  const maxBaselineHeight = baselineHeight - baselineY
  const maxTestHeight = testHeight - testY
  const alignedHeight = Math.min(height, maxBaselineHeight, maxTestHeight)
  if (alignedHeight <= 0) return null

  return {
    baselineY,
    testY,
    height: alignedHeight,
  }
}

function prepareCompareChunks({
  baselinePath,
  testPath,
  diffPath,
  chunks,
  chunkHeight,
  alignMaxShift,
}) {
  const baselinePng = readPngSafely(baselinePath)
  const testPng = readPngSafely(testPath)
  const diffPng = readPngSafely(diffPath)

  if (!baselinePng || !testPng) {
    return {
      chunked: false,
      chunkDir: null,
      verticalOffset: 0,
      chunks: [{ index: 1, y: 0, height: 0, baselinePath, testPath, diffPath }],
      reason: "Chunking disabled because baseline/test image is not PNG.",
    }
  }

  const verticalOffset = estimateVerticalOffset(
    baselinePng,
    testPng,
    alignMaxShift
  )
  const ranges = buildChunkRanges(baselinePng.height, chunks, chunkHeight)
  if (ranges.length <= 1) {
    return {
      chunked: false,
      chunkDir: null,
      verticalOffset,
      chunks: [
        {
          index: 1,
          y: 0,
          height: Math.min(baselinePng.height, testPng.height),
          baselinePath,
          testPath,
          diffPath,
        },
      ],
      reason: null,
    }
  }

  const chunkDir = mkdtempSync(join(tmpdir(), "ui-vision-compare-"))
  const chunkSpecs = []

  for (const range of ranges) {
    const aligned = resolveAlignedRange(
      range,
      baselinePng.height,
      testPng.height,
      verticalOffset
    )
    if (!aligned) continue

    const spec = {
      index: range.index,
      y: range.y,
      height: range.height,
      baselineY: aligned.baselineY,
      testY: aligned.testY,
      alignedHeight: aligned.height,
      baselinePath,
      testPath,
      diffPath,
    }

    const baselineCrop = cropPng(baselinePng, aligned.baselineY, aligned.height)
    const baselineOutPath = join(chunkDir, `chunk-${range.index}-baseline.png`)
    writePng(baselineOutPath, baselineCrop)
    spec.baselinePath = baselineOutPath

    const testCrop = cropPng(testPng, aligned.testY, aligned.height)
    const testOutPath = join(chunkDir, `chunk-${range.index}-test.png`)
    writePng(testOutPath, testCrop)
    spec.testPath = testOutPath

    if (diffPng && aligned.baselineY < diffPng.height) {
      const diffCrop = cropPng(
        diffPng,
        aligned.baselineY,
        Math.min(aligned.height, diffPng.height - aligned.baselineY)
      )
      const diffOutPath = join(chunkDir, `chunk-${range.index}-diff.png`)
      writePng(diffOutPath, diffCrop)
      spec.diffPath = diffOutPath
    }

    chunkSpecs.push(spec)
  }

  if (chunkSpecs.length === 0) {
    return {
      chunked: false,
      chunkDir: null,
      verticalOffset,
      chunks: [{ index: 1, y: 0, height: 0, baselinePath, testPath, diffPath }],
      reason: "Chunking produced no overlapping regions after vertical alignment.",
    }
  }

  return {
    chunked: true,
    chunkDir,
    verticalOffset,
    chunks: chunkSpecs,
    reason: null,
  }
}

function aggregateCompareChunks(chunkResults, maxIssues, route) {
  const allIssues = chunkResults.flatMap((chunk) => chunk.issues)

  allIssues.sort((a, b) => {
    const severityCmp = (SEVERITY_ORDER.get(a.severity) ?? 99) - (SEVERITY_ORDER.get(b.severity) ?? 99)
    if (severityCmp !== 0) return severityCmp
    const confA = a.confidence ?? 0
    const confB = b.confidence ?? 0
    if (confA !== confB) return confB - confA
    return a.title.localeCompare(b.title)
  })

  const limitedIssues = allIssues.slice(0, maxIssues)

  const verdictScore = { approve: 1, review: 0, reject: -1 }
  const weighted = chunkResults.reduce(
    (acc, chunk) => {
      const confidence = chunk.confidence ?? 0.6
      acc.score += (verdictScore[chunk.verdict] ?? 0) * confidence
      acc.weight += confidence
      return acc
    },
    { score: 0, weight: 0 }
  )

  const weightedScore = weighted.weight > 0 ? weighted.score / weighted.weight : 0
  const counts = {
    approve: chunkResults.filter((chunk) => chunk.verdict === "approve").length,
    review: chunkResults.filter((chunk) => chunk.verdict === "review").length,
    reject: chunkResults.filter((chunk) => chunk.verdict === "reject").length,
  }

  const hasBlocker = limitedIssues.some((issue) => issue.severity === "blocker")

  let verdict = "review"
  if (weightedScore >= 0.35) verdict = "approve"
  else if (weightedScore <= -0.35) verdict = "reject"

  if (counts.reject > 0 && verdict === "approve") verdict = "review"
  if (hasBlocker && verdict === "approve") verdict = "review"

  const averageConfidence = chunkResults.length
    ? Number(
        (chunkResults.reduce((sum, chunk) => sum + (chunk.confidence ?? 0.6), 0) / chunkResults.length).toFixed(2)
      )
    : 0

  const summary =
    verdict === "approve"
      ? `No significant regression across ${chunkResults.length} chunk(s).`
      : verdict === "reject"
        ? `Critical regression signals found across ${chunkResults.length} chunk(s).`
        : `Mixed signals across ${chunkResults.length} chunk(s); manual review recommended.`

  return {
    route,
    verdict,
    confidence: averageConfidence,
    weightedScore: Number(weightedScore.toFixed(3)),
    approveChunks: counts.approve,
    reviewChunks: counts.review,
    rejectChunks: counts.reject,
    summary,
    issues: limitedIssues,
  }
}

async function runLegacySingleMode({ args, route, model, maxIssues, timeoutMs, seed }) {
  const explicitImagePath = args.image || process.env.UI_VISION_IMAGE
  const shouldResolveReport = Boolean(args.report) || !explicitImagePath
  const reportPathCandidate = shouldResolveReport
    ? (args.report ? resolve(args.report) : (findLatestReportPath() || ""))
    : ""
  const hasReportPath = Boolean(reportPathCandidate)

  if (!hasReportPath && !explicitImagePath) {
    throw new Error("report.json not found. Pass --report, --image, or set UI_VISION_IMAGE.")
  }
  if (hasReportPath && !existsSync(reportPathCandidate)) {
    throw new Error(`report.json not found at ${reportPathCandidate}`)
  }

  const report = hasReportPath ? JSON.parse(readFileSync(reportPathCandidate, "utf8")) : {}
  const imagePath = detectLegacyImagePath({
    reportPath: reportPathCandidate,
    report,
    route,
    explicitImage: args.image,
  })

  let issues = []
  let summary = ""

  if (DRY_RUN) {
    issues = [
      {
        id: `vision-${route.replace(/[^\w]+/g, "-")}-dry-1`,
        source: "vision-openrouter",
        severity: "minor",
        category: "improvement",
        route,
        title: "Dry-run sample finding",
        evidence: "UI_VISION_DRY_RUN=1",
        recommendation: "Disable dry-run and set OPENROUTER_API_KEY for real analysis.",
        confidence: 0.99,
      },
    ]
    summary = "Dry-run mode; no external API call was made."
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is missing. Add it to .env or export it in shell.")
    }

    const prompt = buildSinglePrompt(route, maxIssues)
    const content = await callOpenRouter({
      apiKey,
      model,
      prompt,
      timeoutMs,
      seed,
      images: [{ label: "Screenshot", dataUrl: toDataUrl(imagePath) }],
    })

    const parsed = parseModelJson(content)
    issues = normalizeSingleIssues(parsed, route, maxIssues)
    summary = cleanText(parsed?.summary, "Vision review completed.")
  }

  return {
    mode: "single",
    reportPath: hasReportPath ? reportPathCandidate : null,
    imagePath,
    summary,
    issues,
  }
}

async function runCompareMode({ args, route, model, maxIssues, timeoutMs, seed }) {
  const baselinePath = resolve(args.baseline)
  const testPath = resolve(args.test)
  const providedDiffPath = args.diff ? resolve(args.diff) : null

  if (!existsSync(baselinePath)) throw new Error(`Baseline image not found: ${baselinePath}`)
  if (!existsSync(testPath)) throw new Error(`Test image not found: ${testPath}`)
  if (providedDiffPath && !existsSync(providedDiffPath)) {
    throw new Error(`Diff image not found: ${providedDiffPath}`)
  }

  const useDiff = parseBoolean(
    args.useDiff ?? process.env.UI_VISION_USE_DIFF ?? "0",
    false
  )
  const diffPath = useDiff ? providedDiffPath : null

  const chunks = parsePositiveInt(args.chunks || process.env.UI_VISION_CHUNKS, FALLBACK_CHUNKS)
  const chunkHeight = parsePositiveInt(args.chunkHeight || process.env.UI_VISION_CHUNK_HEIGHT, 0)
  const alignMaxShift = parsePositiveInt(
    args.alignMaxShift || process.env.UI_VISION_ALIGN_MAX_SHIFT,
    FALLBACK_ALIGN_MAX_SHIFT
  )

  const prepared = prepareCompareChunks({
    baselinePath,
    testPath,
    diffPath,
    chunks,
    chunkHeight,
    alignMaxShift,
  })
  const totalChunks = prepared.chunks.length

  if (DRY_RUN) {
    const chunkResults = prepared.chunks.map((chunk) => ({
      index: chunk.index,
      y: chunk.y,
      height: chunk.height,
      verdict: "review",
      confidence: 0.75,
      summary: "Dry-run chunk output",
      issues: [
        {
          id: `vision-${route.replace(/[^\w]+/g, "-")}-c${chunk.index}-dry-1`,
          source: "vision-openrouter",
          severity: "minor",
          category: "regression",
          route,
          chunkIndex: chunk.index,
          chunkY: chunk.y,
          chunkHeight: chunk.height,
          title: "Dry-run sample finding",
          evidence: "UI_VISION_DRY_RUN=1",
          recommendation: "Disable dry-run and set OPENROUTER_API_KEY for real analysis.",
          confidence: 0.99,
        },
      ],
    }))

    const aggregate = aggregateCompareChunks(chunkResults, maxIssues, route)
    return {
      mode: "compare",
      baselinePath,
      testPath,
      diffPath,
      providedDiffPath,
      useDiff,
      alignMaxShift,
      verticalOffset: prepared.verticalOffset ?? 0,
      chunked: prepared.chunked,
      chunkDir: prepared.chunkDir,
      chunkingNote: prepared.reason,
      summary: aggregate.summary,
      aggregate,
      chunks: chunkResults,
      issues: aggregate.issues,
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env or export it in shell.")
  }

  const chunkResults = []
  for (const chunk of prepared.chunks) {
    const prompt = buildComparePrompt(route, maxIssues, chunk, totalChunks)
    const images = [
      { label: "BASELINE image", dataUrl: toDataUrl(chunk.baselinePath) },
      { label: "TEST image", dataUrl: toDataUrl(chunk.testPath) },
    ]
    if (useDiff && chunk.diffPath && existsSync(chunk.diffPath)) {
      images.push({ label: "DIFF MAP image", dataUrl: toDataUrl(chunk.diffPath) })
    }

    const content = await callOpenRouter({
      apiKey,
      model,
      prompt,
      timeoutMs,
      seed,
      images,
    })

    const parsed = parseModelJson(content)
    chunkResults.push(normalizeCompareChunk(parsed, route, chunk, maxIssues))
  }

  const aggregate = aggregateCompareChunks(chunkResults, maxIssues, route)
  return {
    mode: "compare",
    baselinePath,
    testPath,
    diffPath,
    providedDiffPath,
    useDiff,
    alignMaxShift,
    verticalOffset: prepared.verticalOffset ?? 0,
    chunked: prepared.chunked,
    chunkDir: prepared.chunkDir,
    chunkingNote: prepared.reason,
    summary: aggregate.summary,
    aggregate,
    chunks: chunkResults,
    issues: aggregate.issues,
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  loadRootDotEnvIfPresent()

  const model = args.model || process.env.UI_VISION_MODEL || process.env.OPENROUTER_MODEL || FALLBACK_MODEL
  const maxIssues = parsePositiveInt(process.env.UI_VISION_MAX_ISSUES, FALLBACK_MAX_ISSUES)
  const timeoutMs = parsePositiveInt(process.env.UI_VISION_TIMEOUT_MS, FALLBACK_TIMEOUT_MS)
  const seed = parsePositiveInt(process.env.UI_VISION_SEED, FALLBACK_SEED)
  const route = normalizeRoute(args.route || process.env.UI_VISION_ROUTE || "/")

  const isCompareMode = Boolean(args.baseline || args.test)
  if (isCompareMode && (!args.baseline || !args.test)) {
    throw new Error("Compare mode requires both --baseline and --test.")
  }

  const result = isCompareMode
    ? await runCompareMode({ args, route, model, maxIssues, timeoutMs, seed })
    : await runLegacySingleMode({ args, route, model, maxIssues, timeoutMs, seed })

  const outPath = inferOutputPath(result.reportPath, args.out)
  mkdirSync(dirname(outPath), { recursive: true })

  const payload = {
    generatedAt: new Date().toISOString(),
    provider: "openrouter",
    model,
    route,
    dryRun: DRY_RUN,
    ...result,
  }

  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`Vision review finished. Output: ${outPath}`)
  console.log(`Model: ${model}`)
  console.log(`Route: ${route}`)

  if (payload.mode === "compare") {
    console.log(`Mode: compare (${payload.chunked ? "chunked" : "single-pass"})`)
    console.log(`Diff helper image: ${payload.useDiff && payload.diffPath ? "enabled" : "disabled"}`)
    console.log(`Estimated vertical offset: ${payload.verticalOffset ?? 0}px`)
    console.log(`Aggregate verdict: ${payload.aggregate.verdict} (${payload.aggregate.confidence})`)
    console.log(`Chunk count: ${payload.chunks.length}`)
  } else {
    console.log(`Mode: single`)
    console.log(`Image: ${payload.imagePath}`)
  }

  console.log(`Issues: ${payload.issues.length}`)
}

run().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
