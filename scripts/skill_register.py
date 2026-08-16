#!/usr/bin/env python3
"""注册/注销懒加载技能。

用法:
  python skill_register.py --name my-skill --keywords "关键词1,关键词2"
  python skill_register.py --name my-skill --keywords "关键词1,关键词2" --path C:/path/to/SKILL.md
  python skill_register.py --name my-skill --remove
  python skill_register.py --list

路径规则（优先级从高到低）:
  --map 参数 > 环境变量 LAZY_SKILLS_MAP > ./skills-map.json
  --dir 参数 > 环境变量 LAZY_SKILLS_DIR > ./skills-lazy
"""

import argparse
import json
import os
import sys

MAP_PATH = os.environ.get("LAZY_SKILLS_MAP", "skills-map.json")
DEFAULT_DIR = os.environ.get("LAZY_SKILLS_DIR", "skills-lazy")


def load_map(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_map(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def default_skill_path(name: str, base_dir: str) -> str:
    return os.path.join(base_dir, name, "SKILL.md").replace("\\", "/")


def cmd_register(args: argparse.Namespace) -> int:
    name = args.name.strip()
    if not name or name in (".", ".."):
        print(f"错误: 非法技能名 '{name}'", file=sys.stderr)
        return 1

    map_path = args.map or MAP_PATH
    base_dir = args.dir or DEFAULT_DIR
    path = (args.path or default_skill_path(name, base_dir)).replace("\\", "/")
    if not os.path.exists(path):
        print(f"错误: SKILL.md 不存在: {path}", file=sys.stderr)
        return 1

    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    if not keywords:
        print("错误: 至少要提供一个关键词", file=sys.stderr)
        return 1

    data = load_map(map_path)
    old = data.get(path)
    data[path] = keywords
    save_map(map_path, data)
    print(f"已注册: {path}")
    print(f"关键词: {keywords}")
    if old:
        print("提示: 该路径原有规则已被覆盖")
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    name = args.name.strip()
    map_path = args.map or MAP_PATH
    base_dir = args.dir or DEFAULT_DIR
    path = (args.path or default_skill_path(name, base_dir)).replace("\\", "/")
    data = load_map(map_path)
    if path not in data:
        print(f"未找到已注册的规则: {path}", file=sys.stderr)
        return 1
    del data[path]
    save_map(map_path, data)
    print(f"已注销: {path}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    map_path = args.map or MAP_PATH
    data = load_map(map_path)
    if not data:
        print("(空)")
        return 0
    for path, keywords in sorted(data.items()):
        name = path.split("/")[-2]
        print(f"{name:45s} {', '.join(keywords)}")
    print(f"\n共 {len(data)} 条规则")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="懒加载技能注册器")
    parser.add_argument("--name", help="技能名（与目录名一致）")
    parser.add_argument("--keywords", help='逗号分隔的触发关键词，如 "飞书表格,电子表格"')
    parser.add_argument("--path", help="SKILL.md 路径（默认 <dir>\\<name>\\SKILL.md）")
    parser.add_argument("--map", help="skills-map.json 路径（默认环境变量或 ./skills-map.json）")
    parser.add_argument("--dir", help="技能存放目录（默认环境变量或 ./skills-lazy）")
    parser.add_argument("--remove", action="store_true", help="注销该技能")
    parser.add_argument("--list", action="store_true", help="列出全部已注册技能")
    args = parser.parse_args()

    if args.list:
        return cmd_list(args)
    if args.remove:
        if not args.name:
            print("错误: --remove 需要 --name", file=sys.stderr)
            return 1
        return cmd_remove(args)
    if not args.name or not args.keywords:
        parser.print_usage()
        print("错误: 注册需要 --name 和 --keywords", file=sys.stderr)
        return 1
    return cmd_register(args)


if __name__ == "__main__":
    sys.exit(main())
