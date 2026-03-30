# ✨ Imaginary World — 系統說明文件

> **寫給自己看的文件**：這份文件用最直白的語言，解釋這個系統是什麼、怎麼運作、檔案在哪裡。

---

## 🧠 用一句話說清楚這個系統

**用戶拍一張照片，AI 幫他生成一個奇幻故事 + 虛構圖片 + 3D 立體模型，最後可以用 AR 把這些東西疊加到現實世界裡看。**

---

## 🗺️ 系統大地圖（你只需要記住三台「機器」）

```
你的手機瀏覽器
      │
      │ （問故事、傳照片）
      ▼
┌─────────────────────────────┐
│   Hostinger VPS（主伺服器）  │  ← 你租的便宜雲端主機
│   - 負責登入 / 故事 / 圖片   │
│   - 不需要 GPU              │
└──────────────┬──────────────┘
               │ （只有「生成3D模型」才會呼叫這裡）
               ▼
┌─────────────────────────────┐
│   Vast.ai（GPU 租用主機）    │  ← 只在需要時才開，用完就關
│   - 負責把照片轉成 3D 模型   │
│   - 需要 GPU，所以獨立出來   │
└─────────────────────────────┘
               +
┌─────────────────────────────┐
│   OpenAI API（ChatGPT）     │  ← 故事生成 & 照片分析
│   Luma AI API               │  ← 虛構圖片生成
└─────────────────────────────┘
```

---

## 🎮 用戶的完整體驗流程（9個步驟）

```
1. 打開網頁 → 登入 / 註冊帳號
         ↓
2. 選擇「世界類型」（奇幻/科幻/魔法…等 6 種）
         ↓
3. AI 生成一段開場故事文字
         ↓
4. 用戶拍照或上傳一張照片（任何物品都可以）
         ↓
5. AI 分析照片 → 識別物品 → 生成與照片相關的劇情事件
         ↓
6. AI 同時生成一張「虛構魔法物品」的圖片（Luma AI）
         ↓
7. 後台把照片送去 Vast.ai → 生成照片物品的 3D 模型（.glb 檔）
   後台也把虛構物品圖片送去 → 生成虛構物品的 3D 模型
         ↓
8. 用戶可以在網頁上用 3D Viewer 旋轉查看這兩個模型
         ↓
9. 點擊「AR」按鈕 → 手機鏡頭開啟 → 模型疊加在現實世界上看
```

---

## 📁 檔案結構速查表

```
hostinger/
├── README.md              ← 就是你現在看的這份（！）
│
├── backend/               ← 伺服器端 Python 程式
│   ├── app.py             ← 主程式，所有 API 路由都在這
│   ├── config.py          ← 所有設定（密鑰、URL、路徑）集中在這
│   ├── ai_service.py      ← 跟 OpenAI / Luma AI 說話的地方
│   ├── gpu_client.py      ← 跟 Vast.ai GPU 主機說話的地方
│   ├── database.py        ← 用戶帳號 & 故事存入 SQLite 資料庫
│   ├── job_manager.py     ← 管理「3D生成任務」的排隊 & 狀態
│   ├── user_manager.py    ← 用戶資料夾 & 旅程存檔管理
│   ├── glb_processor.py   ← 如果3D生成失敗，產生一個佔位模型
│   ├── requirements.txt   ← Python 套件清單（pip install -r 這個）
│   ├── start.sh           ← 一鍵啟動腳本
│   └── templates/
│       └── prompt.md      ← ⭐ AI 的「系統提示詞」，改這裡換AI個性
│
├── frontend/              ← 用戶看到的網頁
│   ├── index.html         ← 所有頁面都在這一個 HTML 裡（單頁應用）
│   ├── style.css          ← 所有樣式
│   ├── app.js             ← 全域工具函式 & 共用狀態
│   ├── config.js          ← 前端設定（API URL 等）
│   ├── viewer3d.js        ← 3D 模型展示器（用 Three.js）
│   └── js/
│       ├── story.js       ← 故事頁面的主控制器（最複雜的那個）
│       ├── story-api.js   ← 所有跟後端 API 溝通的函式
│       ├── ar-launcher.js ← 啟動 AR 體驗的控制器
│       ├── dual-viewer.js ← 同時展示兩個 3D 模型的元件
│       ├── gpu-manager.js ← 前端等待 3D 任務完成的邏輯
│       └── ambient-sound.js ← 背景音效控制
│
└── ar/                    ← AR 體驗（獨立的網頁，手機鏡頭）
    ├── tap/               ← 點擊螢幕放置模型的 AR
    ├── rotate/            ← 旋轉查看模型的 AR
    ├── track/             ← 圖片追蹤的 AR
    └── viewer/            ← 基本單模型 AR 展示
```

---

## 📂 用戶文件存放在哪裡？

所有用戶產生的文件都存放在 `data/` 資料夾下（**這個資料夾不在 Git 版本控制中，伺服器啟動時自動建立**）。

```
hostinger/
└── data/                      ← 所有運行時數據都在這裡
    │
    ├── uploads/               ← 照片上傳後的「第一站」（暫存）
    ├── results/               ← 生成結果的暫存區
    ├── journeys/              ← 旅程 JSON 的全域備份
    ├── jobs.json              ← 3D 任務隊列狀態記錄
    ├── user_counter.json      ← 用戶編號計數器
    │
    ├── user_1/                ← 第 1 個用戶的專屬資料夾
    │   ├── journey.json       ← 該用戶的旅程元數據（故事、事件等）
    │   ├── photos/            ← ⭐ 用戶上傳的照片存這裡
    │   ├── fictional_images/  ← AI (Luma) 生成的虛構物品圖片
    │   ├── cutouts/           ← 照片去背後的裁切圖（送給 GPU 用）
    │   ├── real_3d/           ← 從用戶照片生成的 3D 模型 (.glb)
    │   └── fictional_3d/      ← 從虛構圖片生成的 3D 模型 (.glb)
    │
    ├── user_2/                ← 第 2 個用戶，結構相同
    └── ...
```

> 💡 **測試模式**下，資料會改存到 `data_test/` 資料夾，與正式資料完全隔離。

---

## ⚙️ 環境變數（最重要的設定）

在 `backend/` 資料夾建立一個 `.env` 檔案，填入以下內容：

```env
# OpenAI（故事生成 & 照片分析）
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-5.2

# Luma AI（虛構圖片生成）
LUMA_API_KEY=luma-xxxxxxxxxxxxxxxxxxxx

# Vast.ai GPU 主機的地址（開機才有，用 ngrok 轉發）
VASTAI_GPU_URL=https://xxxx.ngrok.app

# 兩台主機之間的通訊密鑰（自己隨便設一個複雜字串）
GPU_API_SECRET=my-super-secret-key-123

# Flask Session 密鑰（自己隨便設）
SECRET_KEY=another-random-secret
```

> ⚠️ `.env` 檔案絕對不能上傳到 GitHub！裡面有 API 密鑰。

---

## 🚀 怎麼啟動（本地測試）

```bash
# 1. 進入後端資料夾
cd backend

# 2. 安裝依賴套件
pip install -r requirements.txt

# 3. 啟動伺服器
python app.py
# 或用正式伺服器：
gunicorn -w 2 -b 0.0.0.0:5000 app:app

# 4. 打開瀏覽器
# http://localhost:5000
```

---

## 🔑 主要 API 路由速查

| 功能                 | 方法 | 路由                       |
| -------------------- | ---- | -------------------------- |
| 用戶登入             | POST | `/api/auth/login`          |
| 用戶註冊             | POST | `/api/auth/register`       |
| 開始旅程（生成故事） | POST | `/api/journey/start`       |
| 上傳照片 & 生成事件  | POST | `/api/journey/photo-event` |
| 給故事一個反饋       | POST | `/api/journey/feedback`    |
| 查詢 3D 任務狀態     | GET  | `/api/job/<job_id>/status` |
| 下載 3D 模型         | GET  | `/api/result/<filename>`   |
| 檢查 GPU 主機健康    | GET  | `/api/gpu/health`          |

---

## 🧩 各模組一句話說明

| 模組                  | 一句話                                          |
| --------------------- | ----------------------------------------------- |
| `app.py`              | 所有 HTTP 請求的入口，像是「前台接待員」        |
| `ai_service.py`       | 專門負責和 OpenAI / Luma AI 說話的「翻譯員」    |
| `gpu_client.py`       | 專門負責把工作派給 Vast.ai GPU 的「外包聯絡人」 |
| `database.py`         | 存用戶帳號和故事的「資料庫管理員」（SQLite）    |
| `job_manager.py`      | 追蹤每一個 3D 生成任務狀態的「工作調度員」      |
| `user_manager.py`     | 管理每個用戶自己資料夾的「倉庫管理員」          |
| `config.py`           | 所有設定值都在這，改設定只改這一個檔案          |
| `templates/prompt.md` | AI 的「個性說明書」，改這裡可以換AI說話風格     |

---

## ❓ 常見問題

**Q: 故事沒有生成出來？**
→ 檢查 `.env` 裡的 `OPENAI_API_KEY` 是否正確，且 OpenAI 帳戶有餘額。

**Q: 虛構圖片沒有出現？**
→ 檢查 `LUMA_API_KEY` 是否設定，Luma AI 帳戶是否有配額。

**Q: 3D 模型一直轉圈圈？**
→ Vast.ai GPU 主機可能沒有開啟，或 `VASTAI_GPU_URL` 地址過期（ngrok 每次重開都會換地址）。用 `/api/gpu/health` 確認連線狀態。

**Q: 想改 AI 說故事的風格？**
→ 直接編輯 `backend/templates/prompt.md`，改完後 API 自動重新載入，不用重啟伺服器。

---

_最後更新：2026-03-30_
