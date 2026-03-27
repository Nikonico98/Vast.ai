# Imaginary World 前端 AR 目录说明

> 写给文科工程师的 AR 发布目录说明书 📖
>
> 这个文件夹放的不是“平时主要编辑的源码”，而是已经可以被浏览器直接打开的 AR 页面成品。

---

## 这个文件夹是干什么的？

你可以把 `frontend/ar/` 理解成 AR 体验的“展厅入口区”。

用户在主前端页面里点了 AR 按钮之后，浏览器真正打开的就是这里面的页面。

如果用更形象的话说：

- `8thWall/` 里的项目是施工图和工厂
- `frontend/ar/` 里的内容是已经摆进商场橱窗的成品

所以这里的特点是：

- 能直接部署
- 浏览器能直接访问
- 大部分 JS 已经打包成 `bundle.js`
- 日常修改逻辑时，通常不优先改这里，而是改 `8thWall/` 里的源码

---

## 这个目录里有四个什么东西？

| 目录 | 路由 | 功能 | 用户看到什么 |
|------|------|------|-------------|
| `viewer/` | `/ar/viewer/` | 单模型 AR 预览 | 只看一个 3D 模型 |
| `tap/` | `/ar/tap/` | 点击互动 | 两个物体，点击触发变化 |
| `rotate/` | `/ar/rotate/` | 旋转互动 | 旋转模型，触发互动 |
| `track/` | `/ar/track/` | 追踪互动 | 跟随移动物体完成互动 |

你可以把它们理解成四个不同主题的 AR 房间。

主前端会根据当前场景，把用户送进不同房间。

---

## 每个子目录里通常有什么？

每个 AR 子目录结构都很像：

- `index.html`
- `bundle.js`
- `external/`
- 有些项目还会有 `assets/`

它们的职责可以这样理解：

### `index.html`

这是 AR 页面入口。

浏览器打开 `/ar/tap/` 或 `/ar/viewer/` 的时候，首先加载的就是这个文件。

你可以把它理解成这个 AR 房间的门。

### `bundle.js`

这是打包后的前端逻辑。

它不是最适合人工长期维护的源码，而是“浏览器能直接执行的成品脚本”。

你可以把它理解成：

- 源码 = 菜谱
- `bundle.js` = 做好的成品料理

如果只是临时线上热修，可以直接改它。
但如果是正式开发，通常应该去改源头项目，再重新构建。

### `external/`

这里放的是 8thWall 导出的 SDK 和相关静态资源。

你可以把它理解成 AR 引擎的发动机舱。

通常情况下：

- 不建议随便手改
- 也不建议轻易删除
- 除非你非常确定是在升级 SDK，或者在修复资源路径

### `assets/`

放贴图、图片、视频等辅助资源。

不是每个 AR 项目都有，但有的话通常就是这个 AR 页面自己的素材库。

---

## 这里和 `8thWall/` 是什么关系？

这是最容易混淆的地方。

### 简单说法

- `8thWall/nikotap`、`8thWall/nikorotateitem`、`8thWall/nikotrack`、`8thWall/nikoARViewer`
  是源码工程
- `frontend/ar/tap`、`frontend/ar/rotate`、`frontend/ar/track`、`frontend/ar/viewer`
  是部署成品

### 更实用的理解

如果你要改逻辑，比如：

- 星星飞行速度
- 点击后的动画
- 旋转互动判定
- viewer 的模型加载方式

一般应该去改：

- `8thWall/.../src/app.js`
- `8thWall/.../src/index.html`

然后重新构建，再把产物复制到这里。

不是优先直接改 `frontend/ar/.../bundle.js`。

---

## 正确的修改流程是什么？

如果你要正式修改 AR 功能，建议这样走：

### 1. 找到对应源码工程

| 你要改的页面 | 对应源码目录 |
|-------------|-------------|
| `ar/tap/` | `8thWall/nikotap/` |
| `ar/rotate/` | `8thWall/nikorotateitem/` |
| `ar/track/` | `8thWall/nikotrack/` |
| `ar/viewer/` | `8thWall/nikoARViewer/` |

### 2. 修改源码

常改的位置通常是：

- `src/app.js` → 互动逻辑
- `src/index.html` → 页面结构、场景配置
- `src/assets/` → 资源素材

### 3. 重新构建

例如：

```bash
cd /workspace/IW/8thWall/nikotap
npm run build
```

### 4. 把构建结果同步到这里

例如：

```bash
cp -r /workspace/IW/8thWall/nikotap/dist/* /workspace/IW/frontend/ar/tap/
```

你可以把 `frontend/ar/` 理解成“最终上架区”，而不是“主要开发现场”。

---

## 什么时候可以直接改这里？

可以，但要带着明确目的。

适合直接改这里的情况：

- 临时修线上问题
- 快速验证一个非常小的改动
- 只是调格式、注释或简单静态资源路径
- 你明确知道这次不会再从源码重新构建覆盖它

不太适合直接改这里的情况：

- 长期维护的互动逻辑修改
- 需要多人协作的功能开发
- 之后还要继续 build 的工程

原因很简单：

下次重新构建时，这里的 `bundle.js` 往往会被覆盖掉。

---

## 主前端是怎么跳到这里来的？

主入口逻辑在：

- `frontend/js/ar-launcher.js`

它负责根据当前事件内容，决定打开：

- `/ar/viewer/`
- `/ar/tap/`
- `/ar/rotate/`
- `/ar/track/`

所以你可以把 `frontend/js/ar-launcher.js` 理解成“导览员”，而 `frontend/ar/` 是“展馆本体”。

---

## 如果我想修改……

| 我想要…… | 优先去哪里改 |
|----------|-------------|
| 改单模型 AR 查看效果 | `8thWall/nikoARViewer/src/` |
| 改 Tap 互动逻辑 | `8thWall/nikotap/src/` |
| 改 Rotate 互动逻辑 | `8thWall/nikorotateitem/src/` |
| 改 Track 互动逻辑 | `8thWall/nikotrack/src/` |
| 快速看当前线上部署内容 | `frontend/ar/.../index.html`、`bundle.js` |
| 检查 8thWall SDK 文件是否齐全 | `frontend/ar/.../external/` |

---

## 哪些地方不要轻易动？

对大多数日常开发来说，下面这些最好不要手动乱改：

- `external/xr/`
- `external/xrextras/`
- `external/scripts/8frame-1.4.1.min.js`
- 各种 `.LICENSE.txt`
- 大量 `.tflite` 模型文件

因为这些通常属于：

- 8thWall SDK 本体
- 第三方资源
- 运行时依赖文件

它们不是业务逻辑的好入口。

---

## 最后的实用建议

如果你只记三句话，就记这三句：

1. `frontend/ar/` 是成品区，不是主要源码区。
2. 要正式改逻辑，优先去 `8thWall/` 对应项目里改。
3. 改完源码以后，要重新 build 并同步到这里。

这样做不一定最省事，但最不容易把自己绕晕。

---

_最后更新：2026年3月_
