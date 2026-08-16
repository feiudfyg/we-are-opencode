---
name: skill-register
version: 1.0.0
description: 新建/注册懒加载技能时使用。触发词：新建技能、做新技能、注册技能、加个技能、加一个技能、懒加载技能。核心职责：新技能一律按懒加载方式落地（不直接注册给 opencode 扫描），写入 {SKILLS_LAZY_DIR} 并用注册脚本登记触发关键词。
---

# skill-register — 懒加载技能落地规范

## 背景机制

opencode 只原生加载 `{OPCODE_SKILLS_DIR}` 下的技能。其他所有技能通过插件 `{PLUGINS_DIR}/we-are-opencode.ts` 懒加载：插件读取 `skills-map.json`，用户消息命中关键词时把对应 `SKILL.md` 全文注入当轮消息。每会话每技能只注入一次。

## 新建懒加载技能的固定流程

1. **写技能内容**：与用户确认技能名称、用途、触发关键词（3~5 个，具体、防误命中，优先用领域专有名词）。
2. **创建文件**：在 `{SKILLS_LAZY_DIR}/<技能名>/SKILL.md` 写入技能正文（frontmatter 至少含 name、description；description 也写清触发场景）。
3. **注册**：运行
   ```
   python {SCRIPTS_DIR}/skill_register.py --name <技能名> --keywords "关键词1,关键词2" --map {PLUGINS_DIR}/skills-map.json --dir {SKILLS_LAZY_DIR}
   ```
4. **验证**：运行 `python {SCRIPTS_DIR}/skill_register.py --list --map {PLUGINS_DIR}/skills-map.json` 确认已登记；并告知用户：新技能已懒加载注册，提到关键词即自动生效，无需重启。

## 其他操作

- **注销**：`python ...\skill_register.py --name <技能名> --remove`（同时询问用户是否删除 SKILL.md 文件）
- **改关键词**：重新执行注册命令（同路径覆盖规则）；改关键词/改文件都不需要重启 opencode（插件每次消息实时读表）
- **自定义路径**：技能文件放在别处时加 `--path <SKILL.md路径>` 参数
- **不要做**：不要把懒加载技能放进 `{OPCODE_SKILLS_DIR}`（会永久占用上下文）；不要直接手改 `skills-map.json`（易损坏 JSON，一律走脚本）

## 命名规范

技能名小写连字符；目录名与技能名一致；SKILL.md 用 UTF-8 编码。
