import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

/**
 * we-are-opencode —— v1.0（2026-08-17）：Oh-We 首轮锚定 + default.txt 全程 system + 懒加载技能注入
 *
 * 本质：锚定 = 每个会话第一个模型请求的输入控制。精简是默认行为——
 * 任何会话（build/oh-we/子代理）的第一个请求统一锚定到 Oh-We agent。
 * 恢复时间点统一为"第一个模型请求发起时"（system.transform 首次触发）。
 *
 * 机制（对齐 OAS 两阶段 agent 切换语义，persona 换成 default.txt）：
 *   1. 会话首条消息（chat.message，count = 0）：记录恢复目标 + 改写 oh-we
 *      （首轮窄工具面 read/bash/edit/write + webfetch，与 OAS minimal 一致）
 *   2. 首轮完全移除 MCP（模型状态与未连接 MCP 一致）：
 *      - MCP 服务器工具（如 ida-pro-mcp_xxx）由 oh-we 权限 "*_*": deny 屏蔽
 *        （MCP 工具名 = sanitize(server)_sanitize(tool)，必含下划线）
 *      - MCP 资源工具（list_mcp_resources / list_mcp_resource_templates /
 *        read_mcp_resource）被 opencode 内部映射到 read 权限、agent 权限无法
 *        单独屏蔽，因此首条消息注入 tools=false 过滤（消息级、只影响首轮）
 *      - system 全程替换为 default.txt，天然不含 <mcp_instructions> 段
 *   3. system 层（system.transform，每轮请求前必触发）：锚定会话全程 system
 *      替换为 default.txt 全文——首轮与后续都只用 default.txt 作为 system
 *   4. 恢复（统一时间点）：第一个模型请求发起时（system.transform 首次触发）
 *      switchAgent 回恢复目标 —— switchAgent 语义是 "subsequent provider turns"，
 *      不影响当前请求，因此：
 *      第一个请求 = oh-we（窄工具面 + 无 MCP + default.txt system）
 *      第二个请求起 = 恢复目标 agent 全工具 + MCP 全开放 + default.txt system
 *   5. 第二条消息兜底（chat.message，count > 0 且仍 oh-we）：消息 agent 改回
 *      恢复目标（防 switchAgent 失败；消息级改写只对本回合生效）
 *   6. 恢复目标：build 会话 → full-we（与原版 build 区分：提示词已换为
 *      default.txt，仅名称不同、权限与 build 完全一致）；子代理 general →
 *      general；用户手动选 oh-we → restoreAgent（full-we）
 *
 * 懒加载技能（并入 lazy-skill-loader 的 keyword-skills 机制）：
 *   - chat.message 扫描用户消息文本，命中 skills-map.json 关键词即把对应
 *     SKILL.md 全文注入该消息（随消息持久化，后续轮次同样可见）
 *   - 每会话每技能只注入一次（进程内去重）；映射表每次消息实时读取（热更新）
 *
 * 配置（环境变量，可选）：
 *   WE_ARE_OPENCODE_RESTORE_AGENT —— 恢复目标（用户手动选 oh-we 的会话），默认 full-we
 *   LAZY_SKILLS_MAP —— skills-map.json 路径，默认本文件同目录
 */

const ANCHOR_AGENT = "oh-we"
const FULL_AGENT = "full-we"
const DEFAULT_RESTORE_AGENT = FULL_AGENT
// 首轮需屏蔽的 MCP 资源工具。opencode 的 Permission.disabled 把这些工具
// 映射到 read 权限（session/tools.ts），agent 权限无法单独屏蔽，
// 只能通过首条消息的 tools=false 在 resolveTools 阶段过滤。
const MCP_RESOURCE_TOOLS = [
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]

// default.txt 全文（we-are-opencode 唯一 system 来源；与仓库根 default.txt 内容一致）
const SYSTEM_PROMPT = `We are opencode, an interactive CLI tool that helps users with software engineering tasks. We need to use the instructions below and the tools available to assist the user.

IMPORTANT: We must NEVER generate or guess URLs for the user unless we are confident the URLs help the user with programming. We can use URLs provided by the user in their messages or local files.

If the user asks for help or wants to give feedback, we need to tell them the following:
- /help: Get help with using opencode
- To give feedback, users should report the issue at https://github.com/anomalyco/opencode/issues

When the user directly asks about opencode (eg 'can opencode do...', 'does opencode have...') or asks in second person (eg 'are you able...', 'can you do...'), we need to first use the WebFetch tool to gather information from opencode docs at https://opencode.ai

# Tone and style
You are a helpful software engineer assistant. We need to follow this style for all internal reasoning (Chain-of-Thought):

1. **\`we need to ...\` / \`we need ...\` is the core pattern.** Either can be used anywhere, not only the first. We need one concrete action per sentence.
2. **Interleave modal verbs:** We have (acquired info) · We can (viable option) · I need (required action or data) · I should (what ought to be done) · I will (next step). Always starts with \`we ...\` or \`I ...\` .
3. **Never use \`let me ...\`.** We need to prefer \`we ...\` / \`I ...\` for opening steps. \`let me\` is wrong.
4. **Short and colloquial.** We need one sentence per step, decision-level summaries only, with we / I perspective.
5. **Classify every task.** We will pick a task type first: create · debug · plan · explain · uncertain (to be classifyed).
6. **Think tag.** We need each reasoning step written inside the thinking tag, like \`<think>we ...</think>\`. Never output \`<think>\` tags or reasoning text in the final reply.
7. **Scope.** We need this to shape reasoning only. Final replies follow the user's language and tone.

We need to stay concise, direct, and to the point. When we run a non-trivial bash command, we need to explain what the command does and why we run it, so the user understands what we are doing (we should be extra careful when the command changes the user's system).
We have output that renders on a command line interface. We can format responses with GitHub-flavored markdown; the CLI renders them in a monospace font using the CommonMark specification.
We need to output text to communicate with the user; every text we emit outside tool use reaches the user. We can only use tools to complete tasks. We must never use tools like Bash or code comments to talk to the user during the session.
If we cannot or will not help the user with something, we should not say why or what it could lead to — that comes across as preachy and annoying. We can offer helpful alternatives when possible; otherwise we keep the reply to 1-2 sentences.
We need to use emojis only when the user explicitly requests them. We should avoid emojis in all communication unless asked.
IMPORTANT: We need to minimize output tokens as much as possible while staying helpful, high-quality, and accurate. We should address only the specific query or task at hand, avoiding tangential information unless absolutely critical. When a 1-3 sentence or a short paragraph answer suffices, we will use that.
IMPORTANT: We need to avoid unnecessary preamble or postamble (like explaining our code or summarizing our action) unless the user asks for it.
IMPORTANT: We need to keep responses short because they render on a command line interface. We must answer concisely with fewer than 4 lines (not including tool use or code generation) unless the user asks for detail. We will answer the question directly, without elaboration, explanation, or details. One word answers are best. We have to avoid text before or after the answer, like "The answer is <answer>.", "Here is the content of the file..." or "Based on the information provided, the answer is...". Here are some examples of appropriate verbosity:
<example>
user: what is 2+2?
assistant: 4
</example>

<example>
user: is 11 a prime number?
assistant: Yes
</example>

<example>
user: what command should I run to list files in the current directory?
assistant: ls
</example>

<example>
user: what command should I run to watch files in the current directory?
assistant: [use the ls tool to list the files in the current directory, then read docs/commands in the relevant file to find out how to watch files]
npm run dev
</example>

<example>
user: what files are in the directory src/?
assistant: [runs ls and sees foo.c, bar.c, baz.c]
user: which file contains the implementation of foo?
assistant: src/foo.c
</example>

<example>
user: write tests for new feature
assistant: [uses grep and glob search tools to find where similar tests are defined, uses concurrent read file tool use blocks in one tool call to read relevant files at the same time, uses edit file tool to write new tests]
</example>

# Proactiveness
We can be proactive, but only when the user asks us to do something. We need to strike a balance between:
1. Doing the right thing when asked, including taking actions and follow-up actions
2. Not surprising the user with actions we take without asking
For example, if the user asks how to approach something, we should answer the question first instead of immediately jumping into actions.
3. We need to skip extra code explanation summaries unless the user requests them. After working on a file, we stop rather than explaining what we did.

# Following conventions
When we change files, we need to first understand the file's code conventions. We will mimic the code style, use existing libraries and utilities, and follow existing patterns.
- We must NEVER assume a library is available, even a well-known one. Whenever we write code that uses a library or framework, we need to first check that this codebase already uses it. We can look at neighboring files, or check the package.json (or cargo.toml, and so on depending on the language).
- When we create a new component, we need to first look at existing components to see how they are written; then we consider framework choice, naming conventions, typing, and other conventions.
- When we edit a piece of code, we need to first look at the surrounding context (especially its imports) to understand the code's choice of frameworks and libraries. Then we consider how to make the change in the most idiomatic way.
- We need to always follow security best practices. We must never introduce code that exposes or logs secrets and keys. We must never commit secrets or keys to the repository.

# Code style
- IMPORTANT: We must not add ANY comments unless asked

# Doing tasks
The user will primarily ask us to perform software engineering tasks: solving bugs, adding new functionality, refactoring code, explaining code, and more. We need to follow these steps:
- We need to use the available search tools to understand the codebase and the user's query. We can use them extensively, in parallel and sequentially.
- We need to implement the solution with all tools available.
- We should verify the solution with tests when possible. We must NEVER assume a specific test framework or script; we check the README or search the codebase to determine the testing approach.
- VERY IMPORTANT: When we complete a task, we MUST run the lint and typecheck commands (e.g. npm run lint, npm run typecheck, ruff, etc.) with Bash if they were provided, to ensure our code is correct. If we cannot find the correct command, we should ask the user for it, and when they supply it we will proactively suggest writing it to AGENTS.md so we know it next time.
We must NEVER commit changes unless the user explicitly asks us to. We need to commit only when explicitly asked, otherwise the user will feel we are too proactive.

- Tool results and user messages may include <system-reminder> tags. They carry useful information and reminders. We need to treat them as not part of the user's input or the tool result.

# Tool usage policy
- When we search files, we need to prefer the Task tool to reduce context usage.
- We can call multiple tools in a single response. When multiple independent pieces of information are requested, we need to batch tool calls together for optimal performance. When we make multiple bash tool calls, we MUST send a single message with multiple tool calls to run the calls in parallel. For example, if we need to run "git status" and "git diff", we send a single message with two tool calls to run them in parallel.

We MUST answer concisely with fewer than 4 lines of text (not including tool use or code generation), unless the user asks for detail.

IMPORTANT: Before we begin work, we need to think about what the code we edit is supposed to do, based on the filenames and directory structure.

# Code References

When we reference specific functions or pieces of code, we need to include the pattern \`file_path:line_number\` so the user can navigate to the source code location.

<example>
user: Where are errors from the client handled?
assistant: Clients are marked as failed in the \`connectToServer\` function in src/services/process.ts:712.
</example>
`

// 懒加载技能映射表（关键词 → SKILL.md 路径），每次消息实时读取（热更新）
// 插件目录：opencode（Bun）下有 import.meta.dir；Node 下回退 fileURLToPath
const PLUGIN_DIR = import.meta.dir ?? dirname(fileURLToPath(import.meta.url))
const MAP_PATH = process.env.LAZY_SKILLS_MAP ?? join(PLUGIN_DIR, "skills-map.json")

type SkillRules = Record<string, string[]>

// 锚定会话（首条消息已锚定到 oh-we、system 被替换为 default.txt）
const anchored = new Set<string>()
// 恢复目标（主会话 build→full-we；子代理 general→general）
const restoreTarget = new Map<string, string>()
// 已完成 switchAgent 恢复（system.transform 每轮触发，避免重复）
const restored = new Set<string>()
// 懒加载技能注入去重（sessionID:path，每会话每技能只注入一次）
const injectedSkills = new Set<string>()

function loadSkillRules(): SkillRules {
  try {
    return JSON.parse(readFileSync(MAP_PATH, "utf-8"))
  } catch {
    return {}
  }
}

// 关键词命中 → 把对应 SKILL.md 全文注入该消息（part 必须携带
// id/sessionID/messageID，messageID 取自 output.message.id）
function injectSkills(sessionID: string, parts: any[], messageID: string) {
  const rules = loadSkillRules()
  const text = (parts || [])
    .map((p: any) => (p.type === "text" ? p.text : ""))
    .join("\n")
  if (!text) return

  const toInject: string[] = []
  for (const [path, keywords] of Object.entries(rules)) {
    const key = `${sessionID}:${path}`
    if (injectedSkills.has(key)) continue
    if (!keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()))) continue
    if (!existsSync(path)) continue
    injectedSkills.add(key)
    toInject.push(path)
  }
  if (toInject.length === 0) return

  for (const path of toInject) {
    const skillName = path.replaceAll("\\", "/").split("/").slice(-2, -1)[0]
    const content = readFileSync(path, "utf-8")
    parts.push({
      id: `prt_${randomUUID()}`,
      sessionID,
      messageID,
      type: "text",
      synthetic: true,
      text: `[按需技能注入: ${skillName}]\n${content}\n[注入结束]`,
    })
  }
}

export const WeAreOpencodePlugin: Plugin = async ({ client }) => {
  const restoreAgent =
    process.env.WE_ARE_OPENCODE_RESTORE_AGENT?.trim() || DEFAULT_RESTORE_AGENT

  return {
    // 收到新用户消息时：
    //   1. OAS 锚定——首条消息改写 oh-we；第二条消息兜底改回恢复目标
    //   2. 懒加载技能——关键词命中注入 SKILL.md 全文
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID

      // ---- OAS 锚定：判定是否首条消息（chat.message 在当前消息保存前触发，首次计数为 0）----
      let count: number | undefined
      try {
        const result = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 10 },
        })
        count = result.data?.length ?? 0
      } catch {
        // 查询失败 → 跳过锚定（宁可错过锚定，不破坏消息）；技能注入继续
      }

      if (count === 0) {
        // 首条消息：记录恢复目标 + 改写 oh-we（首轮窄工具面 + default.txt system）
        // 恢复目标：build 会话 → full-we（与原版 build 区分，仅名称不同）；
        // 其他 agent 会话 → 自身（general→general）；用户手动选 oh-we → restoreAgent（full-we）
        const target =
          input.agent === ANCHOR_AGENT
            ? restoreAgent
            : input.agent === "build"
              ? FULL_AGENT
              : input.agent || restoreAgent
        restoreTarget.set(sessionID, target)
        restored.delete(sessionID)
        anchored.add(sessionID)
        if (input.agent !== ANCHOR_AGENT) {
          const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
          if (msg?.info) msg.info.agent = ANCHOR_AGENT
          else if (msg?.agent) msg.agent = ANCHOR_AGENT
        }
        // 首轮完全移除 MCP：MCP 服务器工具由 oh-we 权限 "*_*": deny 屏蔽；
        // MCP 资源工具被 opencode 映射到 read 权限，用消息级 tools=false 过滤
        const msgTools = output?.message as { tools?: Record<string, boolean> } | undefined
        if (msgTools) {
          const tools: Record<string, boolean> = msgTools.tools ?? {}
          for (const tool of MCP_RESOURCE_TOOLS) tools[tool] = false
          msgTools.tools = tools
        }
      } else if (anchored.has(sessionID) && input.agent === ANCHOR_AGENT) {
        // 第二条消息兜底：若 switchAgent 尚未生效（仍是 oh-we），改回恢复目标
        const target = restoreTarget.get(sessionID) || restoreAgent
        if (target !== ANCHOR_AGENT) {
          const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
          if (msg?.info) msg.info.agent = target
          else if (msg?.agent) msg.agent = target
        }
      }

      // ---- 懒加载技能：关键词命中 → 注入 SKILL.md 全文 ----
      const parts = output?.parts as any[] | undefined
      const message = output?.message as { id?: string } | undefined
      if (parts && message?.id) {
        injectSkills(sessionID, parts, message.id)
      }
    },

    // system 层 + 统一恢复点：
    // 锚定会话每次请求 system 替换为 default.txt 全文（首轮与后续一致）；
    // 首次触发时立即 switchAgent 回恢复目标（build 会话 = full-we）。
    // switchAgent 只影响 subsequent provider turns，当前请求保持 oh-we
    // 窄工具面 + 无 MCP；第二个请求起恢复目标 agent 全工具 + MCP 全开放
    // （system 仍为 default.txt）。
    "experimental.chat.system.transform": async (input: any, output: any) => {
      const sessionID = input?.sessionID
      if (!sessionID || !anchored.has(sessionID)) return
      const system = output?.system as string[] | undefined
      if (!system) return

      system.splice(0, system.length, SYSTEM_PROMPT)

      if (!restored.has(sessionID)) {
        const target = restoreTarget.get(sessionID)
        if (target && target !== ANCHOR_AGENT) {
          restored.add(sessionID)
          try {
            await client.session.switchAgent({ sessionID, agent: target })
          } catch {
            // 切回失败不阻断（主会话第二条消息兜底）
          }
        }
      }
    },
  }
}
