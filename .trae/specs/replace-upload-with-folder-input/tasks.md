# 任务列表：上传图片按钮改为图片文件夹输入功能

## 阶段一：后端/IPC 扩展

### Task 1.1：新增 `fs:read-file-buffer` IPC 处理器
- **文件**: `electron/ipc-handlers.ts`
- **内容**: 新增 `ipcMain.handle('fs:read-file-buffer', async (_event, { filePath }: { filePath: string }) => { ... })`
- **逻辑**: 使用 `fs.readFileSync(filePath)` 读取文件，返回 `{ data: ArrayBuffer, name: string }`
- **边界**: 文件不存在时返回 `null`，异常时返回 `null`
- **验证**: 通过 DevTools Console 测试 `electronAPI.readFileBuffer(path)` 能正确返回 ArrayBuffer

### Task 1.2：在 preload.cjs 暴露 `readFileBuffer`
- **文件**: `electron/preload.cjs`
- **内容**: 在 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 中添加 `readFileBuffer: (filePath) => ipcRenderer.invoke('fs:read-file-buffer', { filePath })`
- **验证**: 渲染进程 `window.electronAPI.readFileBuffer` 存在且可调用

### Task 1.3：封装 `readFileBuffer` 调用
- **文件**: `src/lib/localSave.ts`（或新建 `src/lib/electronFile.ts`）
- **内容**: 导出 `async function readFileBuffer(filePath: string): Promise<{ data: ArrayBuffer; name: string } | null>`
- **逻辑**: 调用 `getAPI()?.readFileBuffer(filePath)`，做非 Electron 环境兼容（返回 `null`）
- **验证**: TypeScript 编译通过

---

## 阶段二：状态模型扩展

### Task 2.1：新增 `InputImageFolder` 类型
- **文件**: `src/types.ts`
- **内容**:
  ```ts
  export interface InputImageFolder {
    path: string
    imageIds: string[]
  }
  ```
- **验证**: 无编译错误

### Task 2.2：扩展 `AppState` 接口
- **文件**: `src/store.ts`
- **内容**: 在 `AppState` 中新增：
  ```ts
  inputImageFolder: InputImageFolder | null
  setInputImageFolder: (folder: InputImageFolder | null) => void
  ```
- **验证**: TypeScript 编译通过

### Task 2.3：实现 `setInputImageFolder` 和互斥逻辑
- **文件**: `src/store.ts`
- **内容**:
  - `setInputImageFolder` 设置 `inputImageFolder` 时，同时 `clearInputImages()`
  - `addInputImage` / `setInputImages` / `clearInputImages` 等现有方法在修改 `inputImages` 时，同时 `setInputImageFolder(null)`
- **验证**: 单元测试确认两种模式互斥

### Task 2.4：修改 `executeTask` 循环分配逻辑
- **文件**: `src/store.ts`
- **内容**:
  - 在 `executeTask` 中，获取 `inputImageFolder`
  - 若存在且 `imageIds.length > 0`：
    - 批量生成循环中，第 `i` 次使用 `imageIds[i % imageIds.length]`
    - 每次只传入 1 张图片 `inputImageDataUrls: [dataUrl]`
  - 若不存在：保持现有逻辑（`task.inputImageIds` 全部传入）
- **验证**: 单元测试确认循环分配正确（如 3 张图生成 5 张 → 顺序 0,1,2,0,1）

---

## 阶段三：UI 修改

### Task 3.1：修改上传按钮为文件夹选择
- **文件**: `src/components/InputBar.tsx`
- **内容**:
  - 移除 `<input type="file" ref={fileInputRef} ...>` 的 `onClick` 触发
  - 上传按钮 `onClick` 改为调用 `handleSelectFolder()`
  - 图标从回形针改为文件夹图标
  - tooltip 改为"选择图片文件夹"
- **验证**: 点击按钮弹出文件夹选择对话框

### Task 3.2：实现 `handleSelectFolder` 函数
- **文件**: `src/components/InputBar.tsx`
- **内容**:
  ```ts
  const handleSelectFolder = async () => {
    const folderPath = await selectDirectory()
    if (!folderPath) return
    const files = await readDir(folderPath)
    const imageFiles = files
      .filter(f => /\.(jpe?g|png|gif|webp|bmp)$/i.test(f))
      .sort()
    if (imageFiles.length === 0) {
      showToast('文件夹内没有图片文件', 'error')
      return
    }
    // 读取前 API_MAX_IMAGES 张
    const toRead = imageFiles.slice(0, API_MAX_IMAGES)
    const imageIds: string[] = []
    for (const fileName of toRead) {
      const result = await readFileBuffer(joinPath(folderPath, fileName))
      if (!result) continue
      const dataUrl = arrayBufferToDataUrl(result.data)
      const id = await hashDataUrl(dataUrl)
      await storeImage(id, dataUrl)
      imageIds.push(id)
    }
    if (imageIds.length === 0) {
      showToast('无法读取文件夹中的图片', 'error')
      return
    }
    setInputImageFolder({ path: folderPath, imageIds })
    if (imageFiles.length > API_MAX_IMAGES) {
      showToast(`文件夹图片过多，已读取前 ${API_MAX_IMAGES} 张`, 'warning')
    }
  }
  ```
- **注意**: 需要新增 `joinPath` 辅助（或直接用 `${folderPath}/${fileName}`，注意 Windows 路径）
- **验证**: 选择文件夹后，`inputImageFolder` 状态正确，图片存入 IndexedDB

### Task 3.3：新增文件夹模式预览 UI
- **文件**: `src/components/InputBar.tsx`
- **内容**:
  - 当 `inputImageFolder` 存在时，显示：
    - 文件夹路径（截断显示）
    - 图片数量
    - 前几张缩略图（只读，从 `imageCache` 或 `ensureImageCached` 获取）
    - "清除文件夹"按钮（点击后 `setInputImageFolder(null)`）
  - 当 `inputImages` 存在时，保持现有预览 UI（删除、替换、重排序）
- **验证**: UI 切换正确，两种模式不重叠

### Task 3.4：确保拖拽上传清空文件夹模式
- **文件**: `src/components/InputBar.tsx`
- **内容**: 在 `handleFiles` 函数开头调用 `setInputImageFolder(null)`
- **验证**: 拖拽上传后，文件夹预览消失，文件预览出现

---

## 阶段四：测试

### Task 4.1：编写循环分配单元测试
- **文件**: `src/store.test.ts`（或新建）
- **内容**: 测试 `executeTask` 中 `inputImageFolder.imageIds` 的循环分配逻辑
- **用例**:
  - 3 张图生成 5 张 → [0,1,2,0,1]
  - 1 张图生成 3 张 → [0,0,0]
  - 6 张图生成 6 张 → [0,1,2,3,4,5]
  - 无文件夹 → 使用 inputImages

### Task 4.2：编写文件夹读取单元测试
- **文件**: `src/lib/folderImage.test.ts`（或新建）
- **内容**: 测试图片文件过滤、排序逻辑
- **用例**:
  - 混合文件类型，只保留图片
  - 按文件名排序
  - 超过 6 张截断

### Task 4.3：集成测试
- **内容**: 手动测试完整流程
  1. 点击上传按钮 → 选择文件夹
  2. 确认预览显示文件夹信息
  3. 输入 prompt，设置 n=5
  4. 点击生成，确认每次 API 调用传入不同图片（循环）
  5. 拖拽上传图片，确认切换到文件模式
  6. 点击清除，确认恢复空状态

---

## 依赖关系
```
Task 1.1 → Task 1.2 → Task 1.3
Task 1.3 → Task 2.2 → Task 2.3 → Task 2.4
Task 2.1 → Task 2.2
Task 2.3 → Task 3.2
Task 3.1 → Task 3.2 → Task 3.3
Task 3.2 → Task 3.4
Task 2.4 → Task 4.1
Task 3.2 → Task 4.2
Task 3.3 → Task 4.3
```
