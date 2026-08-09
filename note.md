# AI Agent Runtime Platform 設計草案

> Draft v0.2
> 本文件整合 **AI Agent Runtime Platform 設計** 與 **Git × CRDT × Workspace 協作架構**，作為整個 Agent Runtime 的設計規格。

---

# 一、設計目標

建立一個可擴充、跨平台的 **AI Agent Runtime**。

Agent 不需要知道：

* Browser
* Node.js
* Docker
* VM
* Cloud

只需要知道一套 Runtime Commands。

設計目標：

* AI Agent 自動程式開發
* AI Agent 文件編輯
* 可擴充 Runtime
* 可插拔 Provider
* 可選多人協作
* 完整版本管理
* Browser First
* Workspace 為核心

---

# 二、整體架構

```text
                        +-------------------------+
                        |        AI Agent         |
                        | GPT / Claude / Gemini  |
                        +------------+------------+
                                     |
                              Runtime Commands
                                     |
                        +------------v------------+
                        |    Command Registry     |
                        +------------+------------+
                                     |
                           Runtime Abstract API
                                     |
          +--------------+-----------+------------+--------------+
          |              |                        |              |
          ▼              ▼                        ▼              ▼
   Workspace API    Version API          Collaboration API   Custom APIs
          |              |                        |              |
          +--------------+-----------+------------+--------------+
                                     |
                                Workspace Provider
                                     |
                           Browser / Node / Docker
                                     |
                                 Workspace Files
```

---

# 三、核心設計理念

Runtime 不重新發明一套 API。

直接使用：

> Unix Shell 的心智模型。

因為 LLM 已經熟悉：

```text
ls
cat
grep
find
pwd
git
```

因此 Runtime Commands 直接沿用 CLI 概念。

---

# 四、Command Registry

所有能力都註冊成 Command。

例如：

```text
ls
cat
grep
find
edit
patch
mkdir
rm
git status
git commit
help
```

每個 Command：

```ts
{
    name,
    description,
    parameters,
    permission,
    handler
}
```

Provider 可以動態增加：

```text
browser.click

browser.open

database.query

docker.run

figma.export
```

---

# 五、Runtime API

Command 不直接碰底層。

例如：

```text
cat src/main.ts
```

最後：

```text
Workspace.readFile()
```

例如：

```text
Workspace.readFile()

Workspace.writeFile()

Workspace.patch()

Workspace.list()

Workspace.move()
```

---

# 六、Workspace Provider

Workspace Provider 負責真正資料來源。

例如：

* Browser OPFS
* Node fs
* Docker Volume
* Remote Storage
* S3

Agent 永遠不知道底層。

---

# 七、Workspace

Workspace 是 Runtime 最重要概念。

例如：

```text
workspace/
    12345/
        package.json
        src/
        README.md
```

Workspace 永遠都是：

> Source of Truth

---

# 八、Metadata

PostgreSQL：

只存：

* Workspace ID
* Owner
* Runtime Config
* Permission
* Settings

程式碼：

永遠維持一般檔案。

---

# 九、Workspace Working Tree

整個 Runtime：

永遠只有一份 Working Tree。

```text
Workspace
    │
    ├── src/
    ├── package.json
    └── README.md
```

Editor：

修改它。

Agent：

修改它。

Git：

讀它。

CRDT：

同步它。

不要建立第二份 Tree。

---

# 十、Version Provider

Version Control 為 Runtime 的一種能力。

抽象介面：

```text
Version.status()

Version.diff()

Version.commit()

Version.restore()

Version.history()
```

底層可以：

* Git
* Snapshot
* 自訂版本系統

Command Registry 永遠不用改。

---

# 十一、Git 的角色

Git：

只負責：

* Commit
* Diff
* Branch
* History
* Restore

Git：

不是：

* 即時同步
* 多人共同編輯

因此：

Git = Version Control

---

# 十二、Collaboration Provider

多人共同編輯：

不是 Git。

而是：

Document Session。

```text
Workspace
      │
      ▼
Document Session
      │
      ▼
CRDT
```

例如：

Yjs。

---

# 十三、CRDT 的角色

CRDT：

只負責：

* 即時同步
* Merge
* Offline Editing
* State Convergence

不是：

* Version Control

因此：

CRDT = Collaboration

---

# 十四、Git × CRDT

Git：

Version。

CRDT：

Realtime Collaboration。

兩者：

共同操作：

Workspace。

```text
             Workspace
                │
      ┌─────────┴─────────┐
      ▼                   ▼
 Git Provider     Collaboration Provider
```

互不依賴。

---

# 十五、Document Session

多人共同編輯：

建立：

```text
Document Session
```

Session：

存在記憶體。

例如：

```text
Workspace

↓

Open Session

↓

Y.Doc

↓

多人同步

↓

Flush

↓

Workspace
```

Session：

不是 Storage。

Workspace：

才是 Storage。

---

# 十六、協作不是預設

平常：

沒有：

CRDT。

只有：

Workspace。

當使用者：

按下：

```text
Share Workspace
```

才建立：

Document Session。

---

# 十七、Git 與 Collaboration 共存

正常流程：

```text
Workspace
      │
      ▼
Edit
      │
      ▼
Git Commit
```

協作流程：

```text
Workspace
      │
      ▼
Document Session
      │
      ▼
Realtime Sync
      │
      ▼
Workspace
      │
      ▼
Git Commit
```

Git 永遠只看 Workspace。

---

# 十八、Command 分類

## Local Commands

```text
ls
cat
find
grep
edit
```

直接操作 Workspace。

---

## Collaboration Commands

```text
share.start

share.stop

share.join

share.leave
```

建立 Session。

---

## Repository Commands

```text
git status

git diff

git commit

git push
```

Version Provider。

---

# 十九、Git Provider

Git Provider：

可以有不同實作。

例如：

Browser：

```text
isomorphic-git
```

Server：

```text
Native Git
```

Command Registry：

不用修改。

---

# 二十、MVP 建議

## Phase 1

* Browser Workspace
* Runtime Commands
* Command Registry
* Workspace Provider
* Version Provider（Git）
* AI Agent

不做多人協作。

---

## Phase 2

加入：

* Document Session
* CRDT（Yjs）
* Share Workspace

---

## Phase 3

加入：

* AI Pair Programming
* AI Review
* AI 協作編輯
* Team Collaboration

---

# 二十一、設計原則

## 1.

Workspace 是唯一 Source of Truth。

---

## 2.

Workspace 永遠只有一份 Working Tree。

---

## 3.

Command Registry 不依賴底層 Provider。

---

## 4.

Provider 可自由替換。

---

## 5.

Git 只負責 Version。

---

## 6.

CRDT 只負責 Collaboration。

---

## 7.

Collaboration 是可選功能。

---

## 8.

所有 Runtime 能力皆可透過 Provider 擴充。

---

# 二十二、未來可擴充 Provider

Workspace：

* OPFS
* Node FS
* Docker
* S3

Version：

* Git
* Snapshot
* Custom Version System

Collaboration：

* Yjs
* Liveblocks
* ShareDB（若有特殊需求）

Execution：

* WebContainer
* Node
* Docker
* Kubernetes

Browser：

* DOM
* Storage
* IndexedDB

AI：

* GPT
* Claude
* Gemini
* Local Models

---

# 最終架構

```text
                            AI Agent
                                │
                        Runtime Commands
                                │
                        Command Registry
                                │
                   Runtime Abstract APIs
                                │
     ┌───────────────┬───────────────┬───────────────┐
     ▼               ▼               ▼
 Workspace API   Version API   Collaboration API
     │               │               │
     └───────────────┼───────────────┘
                     ▼
             Workspace Provider
                     │
              Workspace Files
                     │
             Browser / Node / Cloud
```

---

# 核心設計哲學

> **Workspace 是唯一真實的工作區（Working Tree）；Command Registry 提供統一操作介面；Provider 負責底層實作；Git 管理版本、CRDT 管理協作，兩者皆圍繞 Workspace 運作，而非彼此依賴。**
