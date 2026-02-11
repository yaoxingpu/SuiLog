# SuiLog

Private, encrypted journaling on Sui + Walrus with optional sharing and rich media.

## Overview
SuiLog is a Web3 diary app built with Sui Move and Walrus storage. Each diary entry is encrypted locally, stored as a blob on Walrus, and anchored on-chain with minimal metadata. Users can write in a simple mode or a full-page professional editor, attach media, control Walrus retention, and share entries via time-limited links protected by a password.

## Key Features
- **End-to-end encryption**: each entry is encrypted locally with a unique DEK (AES-GCM).
- **Vault-based key management**: a password-derived vault key encrypts the DEK and stays client-side only.
- **Two writing modes**:
  - **Simple**: lightweight text input
  - **Pro**: full-page rich editor with live preview ([wangEditor](https://www.wangeditor.com/))
- **Rich media support**: images, videos, and audio are uploaded to Walrus and embedded in the entry.
- **Custom retention**: choose how long blobs stay on Walrus (default 30 days, quick options + custom).
- **Sharing**: password-protected share links with expiry; extend/revoke/cleanup supported.
- **Wallet + vault UX**: auto reconnect wallet, session unlock for vault.
- **Local caching**: switching between “Write” and “My Diaries” does not re-fetch data unnecessarily.

## How It Works
1. **Write**: user writes content (simple or rich).
2. **Encrypt**: a new DEK encrypts the content locally (AES-GCM).
3. **Upload**: encrypted content is uploaded to Walrus; user-selected retention is mapped to epochs.
4. **Anchor**: on-chain metadata is stored in a Sui Move object (`DiaryEntry`).
5. **Read**: app fetches on-chain metadata, downloads the Walrus blob, and decrypts it locally.

## Sharing Flow
When sharing an entry:
- The DEK is re-encrypted with a share password (PBKDF2 + AES-GCM).
- A `SharedAccess` object is created on-chain with an expiry timestamp.
- The share link points to the `SharedAccess` object ID.
- The owner can extend or revoke access at any time.

## Storage & Privacy
- **On-chain**: title, blob ID, IVs, encrypted DEK, mood, timestamp.
- **Off-chain (Walrus)**: encrypted diary content and any uploaded media.
- **Local only**: vault key (encrypted in localStorage; session key in sessionStorage).

Note: Media (images/videos/audio) in pro mode are stored as public blobs on Walrus.

## Walrus Retention (Effective Period)
You can set how long the blob should be stored:
- **Default**: 30 days
- **Quick options**: 7 / 30 / 90 days
- **Custom**: any number of days within the max epoch limit
Retention is converted into Walrus epochs (epoch length depends on network).

## Tech Stack
- **Move**: Sui Move smart contracts (diary + sharing)
- **Frontend**: Vue 3, Vite, Pinia, Vue Router
- **Editor**: wangEditor
- **Storage**: Walrus (testnet/mainnet)

## Project Structure
```
SuiLog/
  contract/          # Sui Move package (diary module)
  frontend/          # Vue 3 + Vite app
```

## Environment Variables
Create `SuiLog/frontend/.env`:
```
VITE_SUI_NETWORK=testnet
VITE_SUILOG_PACKAGE_ID=0xYOUR_PACKAGE_ID
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
VITE_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space
VITE_SUILOG_MOOD_BOARD_ID=0xYOUR_MOOD_BOARD_OBJECT   # 可选：链上情绪看板

# Optional: read legacy entries from older packages
VITE_SUILOG_PACKAGE_IDS=0xOLD_PACKAGE_ID,0xANOTHER_ID
```

## Hackathon Submission Checklist
- ✅ 项目创建时间 ≥ 2026-01-27
- ✅ Move 版本：2024 语法；使用最新 Sui SDK
- ✅ 开源仓库 + 可运行站点（建议部署到 suins/Vercel）
- ✅ 前端 `.env` 填写 `VITE_SUILOG_PACKAGE_ID` 与 `VITE_SUILOG_MOOD_BOARD_ID`
- ✅ Demo 视频 1 分钟内可访问
- ✅ AI 使用披露：列出模型与提示词（放入 README 链接或 docs/ai-prompts.md）

## Frontend (Local Dev)
```bash
cd SuiLog/frontend
npm install
npm run dev
```

## Contract (Move)
```bash
cd SuiLog/contract/sui_log
sui move build
sui client publish --gas-budget 100000000
```

## Notes / Limitations
- Walrus **testnet** data may be cleared during redeploys.
- If you **reset the vault**, old entries can no longer be decrypted.
- Older package entries are read-only for sharing (no cross-package share calls).

---

<details>
<summary>中文（点击展开）</summary>

## 项目简介
SuiLog 是一个基于 **Sui Move + Walrus** 的链上私密日记应用。日记内容在本地加密后上传到 Walrus，链上只保存最小必要的元数据。支持 **简单写作 / 专业写作** 两种模式、富文本与多媒体、可设置保存有效期、以及带密码的分享链接。

## 核心功能
- **端到端加密**：每篇日记使用独立 DEK（AES-GCM）加密。
- **保险库机制**：密码派生的 vault key 加密 DEK，仅保存在本地。
- **双写作模式**：
  - **简单**：轻量文本输入
  - **专业**：全屏富文本编辑器 + 实时预览（[wangEditor](https://www.wangeditor.com/)）
- **多媒体支持**：图片 / 视频 / 音频上传 Walrus 并嵌入正文。
- **有效期可控**：默认 30 天，提供快捷选项与自定义。
- **分享机制**：分享链接带密码与过期时间，可续期 / 撤销 / 清理。
- **钱包 & 保险库体验优化**：钱包自动重连、保险库会话内免重复解锁。
- **本地缓存**：切换页面不重复拉取数据。

## 工作流程
1. **写作**：选择模式并输入内容
2. **加密**：本地生成 DEK 加密内容
3. **上传**：加密内容上传 Walrus，并设置保存时长
4. **上链**：创建 `DiaryEntry` 对象写入元数据
5. **查看**：拉取链上元数据 + Walrus blob，本地解密展示

## 分享流程
- 用分享密码重新加密 DEK（PBKDF2 + AES-GCM）
- 创建 `SharedAccess` 对象并设置过期时间
- 生成分享链接（指向 `SharedAccess` 对象）
- 分享可随时 **续期 / 撤销 / 清理**

## 数据与隐私
- **链上**：标题、blob ID、IV、加密 DEK、心情、时间戳
- **Walrus**：加密内容与多媒体
- **本地**：保险库密钥（localStorage + sessionStorage）

说明：专业模式中上传的图片 / 视频 / 音频在 Walrus 上是公开存储的。

## Walrus 有效期
- **默认**：30 天
- **快捷**：7 / 30 / 90 天
- **自定义**：最大不超过网络允许的 epoch 上限
有效期会换算为 Walrus epochs（不同网络的 epoch 时长不同）。

## 技术栈
- **Move**：Sui Move 合约
- **前端**：Vue 3, Vite, Pinia, Vue Router
- **编辑器**：wangEditor
- **存储**：Walrus

## 目录结构
```
SuiLog/
  contract/          # Sui Move 合约
  frontend/          # Vue 3 前端
```

## 环境变量
在 `SuiLog/frontend/.env` 中配置：
```
VITE_SUI_NETWORK=testnet
VITE_SUILOG_PACKAGE_ID=0xYOUR_PACKAGE_ID
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
VITE_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space

`注意：本地启动时修改VITE_SUILOG_PACKAGE_ID为自己的package id`

# 可选：读取旧合约包的日记
VITE_SUILOG_PACKAGE_IDS=0xOLD_PACKAGE_ID,0xANOTHER_ID
```

## 前端启动
```bash
cd SuiLog/frontend
npm install
npm run dev
```

## 合约构建 / 发布
```bash
cd SuiLog/contract/sui_log
sui move build
sui client publish --gas-budget 100000000
```

## 注意事项
- Walrus **testnet** 可能会重置数据。
- 保险库重置后，旧日记无法解密。
- 旧合约包日记支持读取，但分享功能有限。

## AI使用
-- Codex，模型使用GPT-5.1-Codex-Max/GPT-5.2-Codex

</details>
