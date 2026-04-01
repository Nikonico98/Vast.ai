# Templates — AI Prompt Templates
# 模板 — AI 提示词模板

> **EN:** This folder stores the "personality instructions" for the AI. If the AI is an actor, this is their script. Edit `prompt.md` to change how the AI tells stories, analyzes photos, and generates events — **no server restart needed**.
>
> **中文：** 这个文件夹存放 AI 的「个性说明书」。如果 AI 是一个演员，这就是他的剧本。编辑 `prompt.md` 可以改变 AI 讲故事、分析照片、生成事件的方式——**不需要重启服务器**。

---

## File Guide / 文件说明

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `prompt.md` | ⭐ **When you want to change AI behavior** / 想改 AI 行为时 | The system prompt that instructs the AI how to behave in every interaction. Defines 6 imaginary worlds, story structure, photo analysis rules, event generation format, AR interaction types, and output schema. The backend auto-reloads this file on each API call — just save and test. / 系统提示词，指导 AI 在每次交互中的行为。定义 6 个幻想世界、故事结构、照片分析规则、事件生成格式、AR 互动类型和输出格式。后端每次 API 调用时自动重载——保存即可测试。 |

---

## What prompt.md Defines / prompt.md 定义了什么

| Section / 章节 | What it controls / 控制什么 | Example / 举例 |
|---|---|---|
| **6 Imaginary Worlds** / 6 个幻想世界 | World names, themes, and atmosphere descriptions / 世界名称、主题和氛围描述 | Historical, Overlaid, Alternate, SciFi_Earth, SciFi_Galaxy, Fantasy |
| **Story rules** / 故事规则 | Writing style, perspective, word limits / 写作风格、视角、字数限制 | Second person ("You discover..."), 30-40 words per event |
| **Photo analysis** / 照片分析 | How to identify place and item from photos / 如何从照片识别场景和物品 | Basic-level categories (e.g., "cup" not "ceramic mug") |
| **Event generation** / 事件生成 | Fictional item must match photo item category; 3-event story arc / 虚构物品必须与照片物品同类别；3 事件故事弧 | Photo: coffee cup → Fictional: enchanted goblet |
| **Action types** / 动作类型 | Three interaction types and their AR mappings / 三种互动类型及其 AR 映射 | Touch→Tap, Turning→Rotate, Following→Track |
| **Output format** / 输出格式 | Exact field names the backend parses with regex / 后端用正则解析的确切字段名 | `Photo Place:`, `Fictional Event:`, `3D Item or Character:`, etc. |

---

## Output Format Quick Reference / 输出格式速查

The AI responds in this exact format; the backend parses these fields with regex:

AI 按照以下格式回复，后端用正则表达式解析这些字段：

```
Story Background: ...
Goal: ...
Photo Place: ...
Photo Place Category: ...
Photo Item: ...
Photo Item Category: ...
Fictional Event: ...
Fictional Location: ...
Fictional Item or Character: ...
Fictional Action: ...
Event Action Category: (Touch | Turning | Following)
AR Interaction: ...
3D Item or Character: ...
```

> ⚠️ **Keep field names exactly as shown.** The backend regex in `ai_service.py` depends on these exact strings. If you rename a field here, you must update the parsing code too. / **字段名必须严格匹配。** 后端 `ai_service.py` 中的正则依赖这些确切字符串。改名需要同步更新解析代码。

---

## How to Edit / 如何编辑

```bash
# Just edit the file directly / 直接编辑文件
nano backend/templates/prompt.md
# or use any text editor / 或用任何文本编辑器

# No restart needed — changes take effect on next API call
# 不需要重启——下次 API 调用时自动生效
```

**Things you can safely tweak** / 可以安全调整的部分：

- World description wording (more fantastical, realistic, humorous…) / 世界观描述用词
- Story word limits (currently 30-40 words per event) / 故事字数限制
- Atmosphere and tone descriptions / 氛围和语调描述
- AR interaction descriptions / AR 互动描述

**Things that need code changes if modified** / 修改后需要改代码的部分：

- Adding/removing/renaming output fields (update regex in `ai_service.py`) / 增删改输出字段
- Adding new action types beyond Touch/Turning/Following (update `ACTION_TO_AR` in `config.py`) / 添加新动作类型
- Adding new world types (update `world_styles` dict in `ai_service.py`) / 添加新世界类型

---

## Troubleshooting / 故障排除

**Q: AI ignoring my prompt changes? / AI 忽略了我的提示词修改？**
A: Make sure you saved the file. You can verify reload by calling `GET /api/template-status` — it shows the current template content and load time. You can also force reload via `POST /api/reload-template`.
确保文件已保存。可以通过 `GET /api/template-status` 验证——它会显示当前模板内容和加载时间。也可以通过 `POST /api/reload-template` 强制重载。

**Q: AI output parsing fails? / AI 输出解析失败？**
A: Check that field names in the prompt match exactly what the regex expects. Common issue: extra spaces or changed capitalization in field labels like `Photo Place:` vs `Photo place:`.
检查提示词中的字段名是否与正则预期完全匹配。常见问题：字段标签中的额外空格或大小写变化。

---

_Last updated / 最后更新: 2026-04-01_
