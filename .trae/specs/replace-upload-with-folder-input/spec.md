# 规格文档：上传图片按钮改为图片文件夹输入功能

## 变更 ID
replace-upload-with-folder-input

## 背景
当前上传图片按钮通过 `<input type="file">` 选择单张或多张图片文件。用户希望将其改为选择文件夹，自动识别文件夹内所有图片，在批量生图时按顺序循环使用。

## 目标
- 修改上传图片按钮功能：从选择文件改为选择文件夹
- 自动读取文件夹内所有图片文件
- 生图时每次按顺序使用一张图片作为参考
- 若文件夹图片数量少于生成数量，循环使用直到满足数量
- **保留拖拽上传图片功能不变**

## 非目标
- 不修改拖拽上传逻辑
- 不修改图片缓存系统（IndexedDB + imageCache Map）
- 不修改 API 调用层（openaiCompatibleImageApi.ts）
- 不修改图片上限（API_MAX_IMAGES = 6）

## 关键设计决策

### 1. 状态模型扩展
在 `AppState` 中新增 `inputImageFolder` 状态：
```ts
interface InputImageFolder {
  path: string          // 文件夹路径
  imageIds: string[]    // 文件夹内所有图片的 ID 列表（按文件名排序）
}
```

同时保留现有 `inputImages: InputImage[]` 用于拖拽上传的图片。

### 2. 两种模式互斥
- **文件模式**：通过拖拽上传的图片存储在 `inputImages` 中
- **文件夹模式**：通过上传按钮选择的文件夹存储在 `inputImageFolder` 中
- 两种模式互斥：选择文件夹时清空 `inputImages`；拖拽上传时清空 `inputImageFolder`
- UI 上同时只能显示一种模式的图片预览

### 3. 生图时的图片分配策略
在 `executeTask` 中：
- 若 `inputImageFolder` 存在且 `imageIds.length > 0`：
  - 批量生成第 `i` 张（从 0 开始）时，使用 `imageIds[i % imageIds.length]`
  - 每次 API 调用只传入 1 张图片（循环分配）
- 若 `inputImageFolder` 不存在：使用现有的 `inputImages` 逻辑（全部传入）

### 4. 文件夹图片读取流程
1. 用户点击上传按钮 → 调用 `selectDirectory()` IPC
2. 渲染进程收到路径后，调用 `readDir(dirPath)` 获取文件列表
3. 过滤出图片文件（扩展名：.jpg, .jpeg, .png, .gif, .webp, .bmp）
4. 逐个读取文件为 `File` 对象（通过 Electron `readFile` 或新增 `readFileAsBuffer` IPC）
5. 计算 hash 生成 ID，存入 IndexedDB，构建 `InputImageFolder`
6. 限制最多读取 `API_MAX_IMAGES` 张图片（与现有上限一致）

### 5. IPC 扩展
- 复用现有 `fs:select-directory` 选择文件夹
- 复用现有 `fs:read-dir` 读取文件列表
- **新增** `fs:read-file-buffer`：读取指定路径文件为 ArrayBuffer，用于生成 dataUrl
- **新增** `electronAPI.readFileBuffer(filePath)` 暴露给渲染进程

### 6. UI 变更
- 上传按钮图标从"回形针"改为"文件夹"图标
- tooltip 文字从"上传图片"改为"选择图片文件夹"
- 图片预览区域：
  - 文件夹模式：显示文件夹路径 + 图片数量 + 前几张缩略图（只读，不可删除/重排序）
  - 文件模式：保持现有交互（删除、替换、重排序）
- 增加"清除文件夹"按钮，切换回文件模式

## 数据流
```
用户点击上传按钮
  → selectDirectory() → 返回 folderPath
  → readDir(folderPath) → 返回 fileNames
  → 过滤图片文件 → 排序
  → 循环：readFileBuffer(path) → ArrayBuffer → dataUrl → hash → storeImage(id, dataUrl)
  → setInputImageFolder({ path, imageIds })
  → clearInputImages()

用户点击生成
  → submitTask()
  → executeTask(taskId)
    → if inputImageFolder:
         for i in 0..n-1:
           imgId = inputImageFolder.imageIds[i % inputImageFolder.imageIds.length]
           dataUrl = ensureImageCached(imgId)
           callImageApi({ inputImageDataUrls: [dataUrl] })
       else:
         现有逻辑：全部 inputImages 传入
```

## 边界情况
- 文件夹内无图片文件：显示错误提示，不切换模式
- 文件夹内图片超过 API_MAX_IMAGES：只取前 6 张，显示提示
- 文件夹路径失效（被删除）：在 executeTask 时若 ensureImageCached 失败，抛出错误
- 用户同时有文件夹和拖拽图片：互斥，后操作覆盖前者
- 批量生成 n=1：只使用文件夹内第一张图片

## 文件变更清单
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/store.ts` | 修改 | 新增 `inputImageFolder` 状态和相关方法，修改 `executeTask` 分配逻辑 |
| `src/types.ts` | 修改 | 新增 `InputImageFolder` 接口 |
| `src/components/InputBar.tsx` | 修改 | 上传按钮改为选择文件夹，新增文件夹预览 UI，保持拖拽逻辑不变 |
| `electron/ipc-handlers.ts` | 修改 | 新增 `fs:read-file-buffer` 处理器 |
| `electron/preload.cjs` | 修改 | 暴露 `readFileBuffer` 方法 |
| `src/lib/localSave.ts` 或新增文件 | 修改 | 封装 `readFileBuffer` 调用 |

## 测试策略
- 单元测试：文件夹图片过滤、排序、循环分配算法
- 集成测试：选择文件夹 → 读取图片 → 生成分配流程
- 边界测试：空文件夹、超上限、循环分配正确性
