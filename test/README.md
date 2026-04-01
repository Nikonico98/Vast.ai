# Test — Test Scripts & Testing Guide
# 测试 — 测试脚本和测试指南

> **EN:** This folder contains test scripts. Currently minimal — the main testing approach is through the built-in **test mode** (`/test` or `?test=1`) which provides a fully isolated environment with separate data storage.
>
> **中文：** 这个文件夹包含测试脚本。目前很简约——主要测试方式是通过内置的**测试模式**（`/test` 或 `?test=1`），它提供完全隔离的环境和独立的数据存储。

---

## File Guide / 文件说明

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `test.py` | 🧪 **Placeholder** / 占位 | Currently a placeholder test script (prints one line). Future home for automated backend tests (API endpoint testing, AI service mocking, job manager testing). / 目前是占位测试脚本。未来可放置自动化后端测试（API 端点测试、AI 服务模拟、任务管理器测试）。 |

---

## Built-in Test Mode / 内置测试模式

The system has a production-safe test mode that is the **primary testing method**:

系统有一个生产安全的测试模式，是**主要的测试方法**：

| Feature / 功能 | How / 怎么做 |
|---|---|
| **Activate** / 激活 | Visit `https://your-domain/test` or add `?test=1` to any URL / 访问 `/test` 或在任何 URL 后加 `?test=1` |
| **Visual indicator** / 视觉标识 | Frontend shows a 🧪 TEST MODE badge / 前端显示测试模式标识 |
| **Data isolation** / 数据隔离 | All data writes to `data_test/` instead of `data/` / 所有数据写到 `data_test/` 而不是 `data/` |
| **Same functionality** / 相同功能 | Everything works identically — same AI calls, same 3D generation, same AR / 一切功能相同 |
| **No production impact** / 不影响生产 | Production users and data are completely unaffected / 完全不影响生产用户和数据 |

---

## API Testing Tool / API 测试工具

There is also a standalone API tester page at `frontend/test-api.html`:

还有一个独立的 API 测试页面 `frontend/test-api.html`：

```
https://your-domain/test-api.html
```

This page lets you manually call individual backend API endpoints (auth, start journey, photo event, job status, etc.) with custom parameters and inspect raw JSON responses. Useful for debugging backend issues without going through the full UI flow.

这个页面可以手动调用单个后端 API 接口，使用自定义参数并查看原始 JSON 响应。调试后端问题时不需要走完整个 UI 流程。

---

## Testing Checklist / 测试检查清单

When verifying the system works end-to-end:

端到端验证系统时：

| # | What to test / 测试什么 | How to verify / 如何验证 |
|---|---|---|
| 1 | **Auth** / 认证 | Register a new user, login, check `/api/auth/me` returns correct user / 注册新用户，登录，检查 `/api/auth/me` |
| 2 | **Story start** / 故事开始 | Start a journey, verify opening story text appears / 开始旅程，验证开场故事文字出现 |
| 3 | **Photo event** / 照片事件 | Upload a photo, verify event text + fictional image are generated / 上传照片，验证事件文字和虚构图片生成 |
| 4 | **Fictional image source** / 虚构图片来源 | Check `journey.json` → `events[].fictional_image_source` is `"luma"` (or `"placeholder"` if Luma was down) / 检查 journey.json 中的 `fictional_image_source` 字段 |
| 5 | **3D generation** / 3D 生成 | Verify `.glb` files appear in `real_3d/` and `fictional_3d/` / 验证 `.glb` 文件出现在对应文件夹 |
| 6 | **3D viewer** / 3D 查看器 | Verify dual 3D viewer loads both models / 验证双 3D 查看器加载两个模型 |
| 7 | **AR** / 增强现实 | Tap AR button, verify AR page opens with correct model / 点击 AR 按钮，验证 AR 页面正确打开 |
| 8 | **Full journey** / 完整旅程 | Complete all 3 events, verify complete page shows summary / 完成 3 个事件，验证完成页显示摘要 |

---

_Last updated / 最后更新: 2026-04-01_
