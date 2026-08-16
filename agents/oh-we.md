---
description: we-are-opencode 首轮锚定载体（Oh-We agent，由插件自动路由，用户无需切换）。首轮 system 由插件替换为 default.txt 全文；权限与 OAS minimal 相同：read/bash/edit/write + webfetch，glob/grep 等保持 deny（OAS 报告实测 glob 为轨迹破坏分界）。"*_*": deny 屏蔽全部 MCP 服务器工具（MCP 工具名 = sanitize(server)_sanitize(tool) 必含下划线），首轮模型状态与未连接 MCP 一致。
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
  write: allow
  webfetch: allow
  "*_*": deny
  glob: deny
  grep: deny
  list: deny
  task: deny
  todowrite: deny
  websearch: deny
  lsp: deny
  skill: deny
  question: deny
  doom_loop: deny
  describe_image: deny
  html2read: deny
  invalid: deny
---
