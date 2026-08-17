# we-are-opencode

**WE ARE OPENCODE**
**WE CARRY THE BLAME**
**WE FIGHT FOR THE WORKFLOW**
**WE HONOR HIS NAME**


**Oh-We 锚定插件**（v1.0）：每个会话（build/oh-we/子代理）的第一个模型请求统一锚定到 **Oh-We** agent（窄工具面 + 完全无 MCP + `default.txt` 唯一 system），第二个请求起切换到 **full-we** agent（与 build 权限一致、仅名称不同）恢复完整工具并开放 MCP（system 全程保持 `default.txt`）。同时并入 [lazy-skill-loader](https://github.com/itamzxm/lazy-skill-loader) 的关键词懒加载技能注入。

## 核心方案（v1.0，2026-08-17）

**触发**：默认启用，无需任何选择/预热。任何会话的第一个模型请求自动锚定到 Oh-We。

**机制**（OAS 两阶段 agent 切换语义，persona 换成 `default.txt`）：

1. **首条消息**（消息数 = 0）：消息 agent 改写为 `oh-we` —— 首轮窄工具面 `read/bash/edit/write + webfetch`（与 OAS minimal 相同；`glob` deny，OAS 报告实测其为轨迹破坏分界）
2. **首轮完全移除 MCP**（即使 MCP 已连接，模型也看不到任何 MCP 相关输入，状态与未连接 MCP 一致）：
   - MCP 服务器工具（如 `ida-pro-mcp_xxx`）由 oh-we 权限 `"*_*": deny` 屏蔽（MCP 工具名 = `sanitize(server)_sanitize(tool)`，必含下划线）
   - MCP 资源工具（`list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`）被 opencode 内部映射到 read 权限、agent 权限无法单独屏蔽，因此插件在首条消息注入 `tools=false` 过滤（消息级、只影响首轮）
   - system 全程替换为 `default.txt`，天然不含 `<mcp_instructions>` 段
3. **system 层**：锚定会话的每次模型请求，system prompt 都替换为 `default.txt` 全文（首轮与后续一致，唯一 system 来源）
4. **恢复（统一时间点）**：第一个模型请求发起时（system.transform 首次触发）`switchAgent` 回恢复目标——`switchAgent` 语义是 "subsequent provider turns"，不影响当前请求，因此第一个请求保持 oh-we（窄工具面 + 无 MCP + `default.txt` system），第二个请求起 full-we 全工具 + MCP 全开放（system 仍为 `default.txt`）
5. **恢复目标**：build 会话 → `full-we`（与原版 build 区分：提示词已换为 `default.txt`，仅名称不同、权限与 build 完全一致）；子代理 general → general；用户手动选 oh-we → full-we
6. **第二条消息兜底**：若 switchAgent 尚未生效（仍是 oh-we），消息 agent 改回恢复目标（消息级改写只对本回合生效，已实证）

**懒加载技能**（并入 lazy-skill-loader 的 keyword-skills 机制）：

- 每个新用户消息扫描文本，命中 `skills-map.json` 关键词 → 把对应 `SKILL.md` 全文注入该消息（随消息持久化，后续工具调用轮次同样可见）
- 每会话每技能只注入一次（进程内去重）；映射表每次消息实时读取，新增/修改技能无需重启

**第一性原理**：模型思维只受输入内容影响——首轮 = 窄工具面 + 无 MCP + `default.txt` 唯一 system 选轨迹；恢复后 = full-we 完整工具 + MCP + `default.txt` 持续约束。

## 文件

| 文件 | 安装位置 | 作用 |
|---|---|---|
| `agents/oh-we.md` | `~/.config/opencode/agent/`（或 `agents/`） | Oh-We 首轮锚定 agent：permission 仅 read/bash/edit/write + webfetch；`"*_*": deny` 屏蔽全部 MCP 服务器工具 |
| `agents/full-we.md` | `~/.config/opencode/agent/`（或 `agents/`） | 恢复目标 agent：与内置 build 权限一致（仅名称不同），全工具 + MCP 全开放 |
| `plugins/we-are-opencode.ts` | `~/.config/opencode/plugins/` | chat.message：首条消息改写 oh-we + tools=false 屏蔽 MCP 资源工具 + 懒加载技能注入；system.transform：全程替换 `default.txt` + 首个请求后 switchAgent 到 full-we |
| `plugins/skills-map.example.json` | 复制为 `plugins/skills-map.json` | 懒加载技能关键词映射（关键词 → SKILL.md 路径） |
| `scripts/skill_register.py` | 任意 | 懒加载技能注册/注销/列表脚本 |
| `skills/skill-register/SKILL.md` | 你的懒加载技能目录 | 指导 AI 按懒加载流程新建技能的元技能 |

> `default.txt` 全文内嵌在插件常量 `SYSTEM_PROMPT` 中（与相对本仓库的 `../oh-we-need/default.txt` 内容一致），无需单独安装。修改后请同步该常量并重启 opencode。

## 安装

```bash
# Linux/macOS
cp agents/oh-we.md            ~/.config/opencode/agent/oh-we.md
cp agents/full-we.md          ~/.config/opencode/agent/full-we.md
cp plugins/we-are-opencode.ts ~/.config/opencode/plugins/we-are-opencode.ts
cp plugins/skills-map.example.json ~/.config/opencode/plugins/skills-map.example.json

# Windows PowerShell
Copy-Item agents\oh-we.md            "$env:USERPROFILE\.config\opencode\agent\oh-we.md"
Copy-Item agents\full-we.md          "$env:USERPROFILE\.config\opencode\agent\full-we.md"
Copy-Item plugins\we-are-opencode.ts "$env:USERPROFILE\.config\opencode\plugins\we-are-opencode.ts"
Copy-Item plugins\skills-map.example.json "$env:USERPROFILE\.config\opencode\plugins\skills-map.example.json"
```

1. 需要懒加载技能时：把 `skills-map.example.json` 复制为同目录 `skills-map.json` 并配置关键词（或直接用注册脚本）
2. 完全重启 opencode（TUI 或桌面端）
3. 卸载：删除上述文件并重启

## 使用（无感）

无需任何操作：每个会话的第一个模型请求自动锚定（system 仅 `default.txt` + 窄工具面 + 完全无 MCP），第二个请求起切换到 full-we（build 同权限）恢复完整工具并开放 MCP，system 仍为 `default.txt`。用户永远不需要切换模式；oh-we 模式仅在首轮内部使用。

## 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WE_ARE_OPENCODE_RESTORE_AGENT` | `full-we` | 用户手动选 oh-we 的会话的恢复目标 |
| `LAZY_SKILLS_MAP` | 插件同目录 `skills-map.json` | 懒加载技能映射表路径（与注册脚本共用） |

## 懒加载技能使用

1. 写技能内容：`<技能目录>/<name>/SKILL.md`（frontmatter 含 name、description）
2. 注册触发关键词：

   ```
   python scripts/skill_register.py --name <name> --keywords "关键词1,关键词2" --map <plugins目录>/skills-map.json --dir <技能目录>
   ```

3. 完成。用户提到关键词即自动注入，无需重启。

其他操作：

```
python skill_register.py --list    # 查看全部已注册技能
python skill_register.py --name <name> --remove    # 注销技能
```

## 验证

- 新会话首条消息：wire 层 system 恰为 `default.txt` 全文；模型只能调用 read/bash/edit/write/webfetch；即使 MCP 已连接，模型看不到任何 MCP 工具（服务器工具与资源工具都不出现，要求用 MCP 工具会被告知不可用）；
- 同会话第二条消息（或首个工具调用后的请求）：glob/grep/task 等全部可用，agent 显示为 full-we，MCP 工具全部恢复可见，system 仍为 `default.txt` 全文；
- 用户消息命中已注册关键词：该消息末尾出现 `[按需技能注入: <技能名>] ... [注入结束]`，同一会话第二次提及不再重复注入；
- 子代理首条同样锚定到 oh-we（无 MCP），恢复后为原 agent（general 等）+ `default.txt` system；
- 旧会话续开：不锚定（消息数 > 1）。

## 风险与限制

- 沿袭 OAS 的实测结论（Project2 单题 n=2），**不保证跨任务普适提升**，请按需实测；
- `switchAgent` 时序依赖 "subsequent provider turns" 语义（OAS 已源码确认并实测首轮工具面纯净）；
- 首轮 MCP 移除依赖两个机制：`"*_*": deny` 会同时屏蔽少数带下划线的内置/插件工具（如 apply_patch，与首轮窄工具面一致）；MCP 资源工具依赖首条消息 `tools=false`（若 opencode 内部 read 映射变化需同步调整常量 `MCP_RESOURCE_TOOLS`）；
- 懒加载技能注入的 part 必须携带 id/sessionID/messageID（messageID 取自 output.message.id），否则 opencode 会以 "invalid user part before save" 拒绝保存；
- 插件在查询消息数失败时会跳过锚定（宁可错过锚定，不破坏消息），技能注入不受影响。

## 参考

- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（DeepSeek Harness 原版 preset）
- OAS（opencode-anchored-standard）：本项目的两阶段 agent 切换机制来源
- [itamzxm/lazy-skill-loader](https://github.com/itamzxm/lazy-skill-loader)：懒加载技能注入机制来源
- [anomalyco/opencode](https://github.com/anomalyco/opencode)：`default.txt` 原版 persona 来源（`packages/opencode/src/session/prompt/default.txt`）

## License

[GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0)
