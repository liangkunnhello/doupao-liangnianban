import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { usePostprocessStore, type WatermarkAnchor } from '../storePostprocess'
import { processImageWithRule, formatBytes } from '../lib/watermarkEngine'
import { FolderOpenIcon, PlusIcon, TrashIcon, DownloadIcon } from './icons'
import { getImage } from '../lib/db'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export default function PostprocessV2Workspace() {
  const showToast = useStore(s => s.showToast)
  const tasks = useStore(s => s.tasks)
  const { templates, rules, groups, addTemplate, updateTemplate, deleteTemplate, addRule, updateRule, deleteRule, addGroup, updateGroup, deleteGroup } = usePostprocessStore()
  
  const [images, setImages] = useState<{id: string, name: string, dataUrl: string}[]>([])
  const [activeTab, setActiveTab] = useState<'rules' | 'templates'>('rules')
  
  // Selection state
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(rules[0]?.id ?? null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id ?? null)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [previewImageIndex, setPreviewImageIndex] = useState(0)
  
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')

  const activeImage = images[previewImageIndex] || images[0]
  const activeRule = rules.find(r => r.id === selectedRuleId)
  const activeTemplate = templates.find(t => t.id === selectedTemplateId)
  
  // Update preview
  useEffect(() => {
    let active = true
    async function update() {
      if (!activeImage) {
        setPreviewUrl('')
        return
      }
      
      try {
        let ruleToUse = activeRule
        let templateToUse = activeTemplate
        
        if (activeTab === 'rules' && activeRule) {
          templateToUse = templates.find(t => t.id === activeRule.templateId)
        } else if (activeTab === 'templates' && activeTemplate) {
          // Create a mock rule for previewing template
          ruleToUse = {
            id: 'mock', name: 'mock', templateId: activeTemplate.id,
            resizeEnabled: false, targetWidth: null, targetHeight: null, resizeMode: 'contain',
            compressEnabled: false, format: 'webp', maxSizeKb: null,
            outputDir: '', fileNamePattern: ''
          }
        }

        if (!ruleToUse) {
           setPreviewUrl(activeImage.dataUrl)
           return
        }

        const blob = await processImageWithRule({
          imageDataUrl: activeImage.dataUrl,
          template: templateToUse || null,
          rule: ruleToUse
        })
        
        if (!active) return
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
      } catch (err) {
        console.error(err)
      }
    }
    update()
    return () => { active = false }
  }, [activeImage, activeRule, activeTemplate, activeTab, templates])

  const handleImagesSelected = async (files: FileList | null) => {
    if (!files?.length) return
    const nextImages = await Promise.all(Array.from(files).map(async (file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      dataUrl: await readFileAsDataUrl(file),
    })))
    setImages(current => [...current, ...nextImages])
    showToast(`已添加 ${nextImages.length} 张图片`, 'success')
  }

  const loadRecentGalleryImages = async () => {
    const ids = tasks.flatMap((task) => task.outputImages).slice(-12).reverse()
    if (!ids.length) {
      showToast('画廊里还没有可载入的输出图', 'info')
      return
    }

    const loaded: {id: string, name: string, dataUrl: string}[] = []
    for (const id of ids) {
      const image = await getImage(id)
      if (image?.dataUrl) {
        loaded.push({ id, name: `${id.slice(0, 8)}.png`, dataUrl: image.dataUrl })
      }
    }
    setImages(loaded)
    showToast(`已载入 ${loaded.length} 张画廊图片`, 'success')
  }

  const selectDir = async (callback: (path: string) => void) => {
    if (window.electronAPI) {
      const dir = await window.electronAPI.selectDirectory()
      if (dir) callback(dir)
    } else {
      showToast('仅在桌面端支持选择目录', 'info')
    }
  }

  const handleExport = async () => {
    if (!images.length) {
      showToast('请先添加待处理图片', 'info')
      return
    }
    
    let rulesToExecute: typeof rules = []
    
    if (selectedGroupIds.size > 0) {
      const ruleIds = new Set<string>()
      groups.filter(g => selectedGroupIds.has(g.id)).forEach(g => {
        g.ruleIds.forEach(id => ruleIds.add(id))
      })
      rulesToExecute = rules.filter(r => ruleIds.has(r.id))
    } else if (activeRule && activeTab === 'rules') {
      rulesToExecute = [activeRule]
    }
    
    if (!rulesToExecute.length) {
      showToast('请勾选方案组或选中一条规则', 'info')
      return
    }
    
    setIsExporting(true)
    let successCount = 0
    let failCount = 0
    
    try {
      const total = images.length * rulesToExecute.length
      let current = 0
      
      for (const image of images) {
        for (const rule of rulesToExecute) {
          current++
          setExportProgress(`处理中 ${current}/${total}...`)
          
          try {
            const template = templates.find(t => t.id === rule.templateId) || null
            const blob = await processImageWithRule({
              imageDataUrl: image.dataUrl,
              template,
              rule
            })
            
            const ext = rule.format === 'jpeg' ? 'jpg' : rule.format
            const baseName = image.name.replace(/\.[^.]+$/, '')
            const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '')
            let fileName = rule.fileNamePattern || '{image}-{rule}'
            fileName = fileName.replace('{date}', dateStr)
                               .replace('{image}', baseName)
                               .replace('{rule}', rule.name)
            fileName = `${fileName}.${ext}`
            
            if (window.electronAPI && rule.outputDir) {
              const fullPath = await window.electronAPI.pathJoin(rule.outputDir, fileName)
              const reader = new FileReader()
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string)
                reader.onerror = reject
                reader.readAsDataURL(blob)
              })
              await window.electronAPI.saveImage(fullPath, dataUrl)
            } else {
              // Fallback to browser download
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = fileName
              a.click()
              URL.revokeObjectURL(url)
              await new Promise(r => setTimeout(r, 100))
            }
            successCount++
          } catch (err) {
            console.error(err)
            failCount++
          }
        }
      }
      showToast(`导出完成：成功 ${successCount}，失败 ${failCount}`, failCount > 0 ? 'error' : 'success')
    } finally {
      setIsExporting(false)
      setExportProgress('')
    }
  }

  return (
    <main className="h-[calc(100vh-var(--app-header-offset))] overflow-y-auto px-3 pb-4 pt-3 sm:px-4">
      <div className="min-h-full w-full space-y-4">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4 dark:border-white/[0.08]">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">全自动分发引擎</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">配置一次，多规格自动加水印并分发到指定目录。</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(400px,1.2fr)_minmax(320px,1fr)] h-[calc(100vh-140px)]">
          
          {/* Left Panel: Input & Groups */}
          <div className="flex flex-col gap-4 overflow-y-auto rounded-2xl border border-gray-200 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-950/70">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">1. 待处理图片 ({images.length})</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200">
                  <PlusIcon className="h-3.5 w-3.5" /> 本地图片
                  <input className="hidden" type="file" accept="image/*" multiple onChange={(e) => void handleImagesSelected(e.target.files)} />
                </label>
                <button type="button" onClick={loadRecentGalleryImages} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200">
                  <FolderOpenIcon className="h-3.5 w-3.5" /> 画廊载入
                </button>
                {images.length > 0 && (
                  <button type="button" onClick={() => setImages([])} className="text-xs text-red-500 ml-auto">清空</button>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {images.map((img, idx) => (
                  <div key={img.id} onClick={() => setPreviewImageIndex(idx)} className={`relative flex-shrink-0 cursor-pointer rounded-lg border-2 ${previewImageIndex === idx ? 'border-blue-500' : 'border-transparent'}`}>
                    <img src={img.dataUrl} className="h-16 w-16 object-cover rounded-md bg-gray-100" alt=""/>
                  </div>
                ))}
                {images.length === 0 && <div className="text-xs text-gray-400 py-4 px-2 border border-dashed rounded-lg w-full text-center">请添加图片</div>}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">2. 执行方案组</h3>
                <button type="button" onClick={() => addGroup({ name: '新方案组', ruleIds: [] })} className="text-xs text-blue-600 hover:text-blue-700">新建组</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {groups.length === 0 && <div className="text-xs text-gray-400 text-center py-4">暂无方案组</div>}
                {groups.map(group => (
                  <div key={group.id} className="p-3 rounded-xl border border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" checked={selectedGroupIds.has(group.id)} onChange={e => {
                        const next = new Set(selectedGroupIds)
                        if (e.target.checked) next.add(group.id)
                        else next.delete(group.id)
                        setSelectedGroupIds(next)
                      }} />
                      <input value={group.name} onChange={e => updateGroup(group.id, { name: e.target.value })} className="flex-1 bg-transparent text-sm font-medium outline-none" />
                      <button onClick={() => deleteGroup(group.id)} className="text-gray-400 hover:text-red-500"><TrashIcon className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="pl-6 space-y-1">
                      {rules.map(rule => (
                        <label key={rule.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <input type="checkbox" checked={group.ruleIds.includes(rule.id)} onChange={e => {
                            const nextIds = e.target.checked ? [...group.ruleIds, rule.id] : group.ruleIds.filter(id => id !== rule.id)
                            updateGroup(group.id, { ruleIds: nextIds })
                          }} />
                          <span className="truncate">{rule.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-4 mt-2 border-t border-gray-100 dark:border-white/[0.08]">
                <button disabled={isExporting} onClick={handleExport} className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm transition-all">
                  <DownloadIcon className="h-4 w-4" />
                  {isExporting ? exportProgress : '一键执行批量导出'}
                </button>
              </div>
            </div>
          </div>

          {/* Center Panel: Configuration */}
          <div className="flex flex-col rounded-2xl border border-gray-200 bg-white/90 shadow-sm dark:border-white/[0.08] dark:bg-gray-950/70">
            <div className="flex border-b border-gray-100 dark:border-white/[0.08]">
              <button onClick={() => setActiveTab('rules')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'rules' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>导出规则</button>
              <button onClick={() => setActiveTab('templates')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'templates' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>水印模板</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {activeTab === 'rules' && (
                <div className="space-y-4">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {rules.map(rule => (
                      <button key={rule.id} onClick={() => setSelectedRuleId(rule.id)} className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${selectedRuleId === rule.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                        {rule.name}
                      </button>
                    ))}
                    <button onClick={() => {
                      const id = `rule-${Date.now()}`
                      addRule({
                        name: '新规则', templateId: templates[0]?.id || '', resizeEnabled: false, targetWidth: null, targetHeight: null, resizeMode: 'contain',
                        compressEnabled: false, format: 'webp', maxSizeKb: null, outputDir: '', fileNamePattern: '{date}-{image}-{rule}'
                      })
                      setSelectedRuleId(id)
                    }} className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:bg-gray-50">
                      + 添加规则
                    </button>
                  </div>
                  
                  {activeRule && (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <input value={activeRule.name} onChange={e => updateRule(activeRule.id, { name: e.target.value })} className="text-base font-bold bg-transparent outline-none border-b border-dashed border-gray-300 focus:border-blue-500" />
                        <button onClick={() => { deleteRule(activeRule.id); setSelectedRuleId(rules[0]?.id || null) }} className="text-xs text-red-500 hover:underline">删除规则</button>
                      </div>
                      
                      <div className="grid gap-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">绑定水印模板</span>
                          <select value={activeRule.templateId} onChange={e => updateRule(activeRule.id, { templateId: e.target.value })} className="p-2 rounded-lg border border-gray-200 bg-gray-50 text-sm dark:bg-gray-900 dark:border-gray-700">
                            <option value="">(无水印)</option>
                            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </label>
                        
                        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 dark:border-white/[0.08] dark:bg-white/[0.02] space-y-3">
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                            <input type="checkbox" checked={activeRule.resizeEnabled} onChange={e => updateRule(activeRule.id, { resizeEnabled: e.target.checked })} />
                            修改尺寸
                          </label>
                          {activeRule.resizeEnabled && (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-gray-500">宽 (px)<input type="number" value={activeRule.targetWidth || ''} onChange={e => updateRule(activeRule.id, { targetWidth: Number(e.target.value) || null })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" /></label>
                              <label className="text-xs text-gray-500">高 (px)<input type="number" value={activeRule.targetHeight || ''} onChange={e => updateRule(activeRule.id, { targetHeight: Number(e.target.value) || null })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" /></label>
                              <label className="text-xs text-gray-500 col-span-2">模式<select value={activeRule.resizeMode} onChange={e => updateRule(activeRule.id, { resizeMode: e.target.value as any })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white"><option value="contain">等比缩放留白 (Contain)</option><option value="cover">居中裁剪 (Cover)</option></select></label>
                            </div>
                          )}
                        </div>

                        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 dark:border-white/[0.08] dark:bg-white/[0.02] space-y-3">
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                            <input type="checkbox" checked={activeRule.compressEnabled} onChange={e => updateRule(activeRule.id, { compressEnabled: e.target.checked })} />
                            体积与格式控制
                          </label>
                          {activeRule.compressEnabled && (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-gray-500">格式<select value={activeRule.format} onChange={e => updateRule(activeRule.id, { format: e.target.value as any })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white"><option value="jpeg">JPEG</option><option value="webp">WEBP</option><option value="png">PNG</option></select></label>
                              <label className="text-xs text-gray-500">最大限制 (KB)<input type="number" value={activeRule.maxSizeKb || ''} onChange={e => updateRule(activeRule.id, { maxSizeKb: Number(e.target.value) || null })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" placeholder="如 300" /></label>
                            </div>
                          )}
                        </div>

                        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 dark:border-white/[0.08] dark:bg-white/[0.02] space-y-3">
                          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">输出配置</h4>
                          <div className="grid gap-2">
                            <label className="text-xs text-gray-500">保存目录 (绝对路径)
                              <div className="flex mt-1">
                                <input value={activeRule.outputDir} onChange={e => updateRule(activeRule.id, { outputDir: e.target.value })} className="flex-1 p-2 rounded-l-lg border border-gray-200 bg-white" placeholder="E:\导出目录" />
                                <button onClick={() => selectDir(path => updateRule(activeRule.id, { outputDir: path }))} className="px-3 rounded-r-lg border border-l-0 border-gray-200 bg-gray-100 hover:bg-gray-200 text-xs font-medium">浏览</button>
                              </div>
                            </label>
                            <label className="text-xs text-gray-500">命名模板<input value={activeRule.fileNamePattern} onChange={e => updateRule(activeRule.id, { fileNamePattern: e.target.value })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" placeholder="{date}-{image}-{rule}" /></label>
                            <div className="text-[10px] text-gray-400">可用变量：{`{date}, {image}, {rule}`}</div>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'templates' && (
                <div className="space-y-4">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {templates.map(t => (
                      <button key={t.id} onClick={() => setSelectedTemplateId(t.id)} className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${selectedTemplateId === t.id ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                        {t.name}
                      </button>
                    ))}
                    <button onClick={() => {
                      const id = `tpl-${Date.now()}`
                      addTemplate({
                        name: '新模板', type: 'text', anchor: 'bottom-right', scalePercent: 10, marginPercent: 5, text: '新建水印', textColor: '#ffffff'
                      })
                      setSelectedTemplateId(id)
                    }} className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:bg-gray-50">
                      + 添加模板
                    </button>
                  </div>

                  {activeTemplate && (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <input value={activeTemplate.name} onChange={e => updateTemplate(activeTemplate.id, { name: e.target.value })} className="text-base font-bold bg-transparent outline-none border-b border-dashed border-gray-300 focus:border-purple-500" />
                        <button onClick={() => { deleteTemplate(activeTemplate.id); setSelectedTemplateId(templates[0]?.id || null) }} className="text-xs text-red-500 hover:underline">删除模板</button>
                      </div>

                      <div className="grid gap-3">
                        <label className="text-xs text-gray-500">模板类型
                          <select value={activeTemplate.type} onChange={e => updateTemplate(activeTemplate.id, { type: e.target.value as any })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-gray-50 dark:bg-gray-900">
                            <option value="image">纯图标</option>
                            <option value="text">纯文字</option>
                            <option value="image-text">图文组合</option>
                          </select>
                        </label>

                        {(activeTemplate.type === 'image' || activeTemplate.type === 'image-text') && (
                          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50">
                            <label className="text-xs text-gray-500">图标源 (Base64/URL)
                              <input value={activeTemplate.logoUrl || ''} onChange={e => updateTemplate(activeTemplate.id, { logoUrl: e.target.value })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" />
                            </label>
                            <label className="cursor-pointer inline-block mt-2 text-xs text-blue-600 hover:underline">
                              上传本地图标
                              <input type="file" accept="image/*" className="hidden" onChange={async e => {
                                if (e.target.files?.[0]) {
                                  const url = await readFileAsDataUrl(e.target.files[0])
                                  updateTemplate(activeTemplate.id, { logoUrl: url })
                                }
                              }} />
                            </label>
                          </div>
                        )}

                        {(activeTemplate.type === 'text' || activeTemplate.type === 'image-text') && (
                          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 grid gap-2">
                            <label className="text-xs text-gray-500">文字内容<input value={activeTemplate.text || ''} onChange={e => updateTemplate(activeTemplate.id, { text: e.target.value })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" /></label>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-gray-500">文字颜色<input type="color" value={activeTemplate.textColor || '#ffffff'} onChange={e => updateTemplate(activeTemplate.id, { textColor: e.target.value })} className="mt-1 h-8 w-full rounded border border-gray-200" /></label>
                              <label className="text-xs text-gray-500">字体<input value={activeTemplate.fontFamily || ''} onChange={e => updateTemplate(activeTemplate.id, { fontFamily: e.target.value })} className="mt-1 w-full p-1.5 rounded-lg border border-gray-200 bg-white" placeholder="sans-serif" /></label>
                              <label className="text-xs text-gray-500">描边颜色<input type="color" value={activeTemplate.strokeColor || '#000000'} onChange={e => updateTemplate(activeTemplate.id, { strokeColor: e.target.value })} className="mt-1 h-8 w-full rounded border border-gray-200" /></label>
                              <label className="text-xs text-gray-500">描边粗细<input type="number" value={activeTemplate.strokeWidth || 0} onChange={e => updateTemplate(activeTemplate.id, { strokeWidth: Number(e.target.value) })} className="mt-1 w-full p-1.5 rounded-lg border border-gray-200 bg-white" /></label>
                            </div>
                          </div>
                        )}

                        {activeTemplate.type === 'image-text' && (
                          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 grid grid-cols-2 gap-2">
                            <label className="text-xs text-gray-500">排版方式
                              <select value={activeTemplate.layout || 'logo-left'} onChange={e => updateTemplate(activeTemplate.id, { layout: e.target.value as any })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white">
                                <option value="logo-left">图标在左</option>
                                <option value="logo-top">图标在上</option>
                              </select>
                            </label>
                            <label className="text-xs text-gray-500">图文间距 (%)<input type="number" value={activeTemplate.gapPercent || 2} onChange={e => updateTemplate(activeTemplate.id, { gapPercent: Number(e.target.value) })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" /></label>
                          </div>
                        )}

                        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
                          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">自适应排版控制</h4>
                          
                          <div>
                            <span className="text-xs text-gray-500 mb-1 block">九宫格锚点</span>
                            <div className="grid grid-cols-3 gap-1 w-32 mx-auto">
                              {['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'].map(pos => (
                                <button key={pos} onClick={() => updateTemplate(activeTemplate.id, { anchor: pos as any })} className={`h-8 rounded ${activeTemplate.anchor === pos ? 'bg-purple-500' : 'bg-gray-200 hover:bg-gray-300'}`} />
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-gray-500">相对大小 (原图短边的 %)<input type="number" min="1" max="100" value={activeTemplate.scalePercent} onChange={e => updateTemplate(activeTemplate.id, { scalePercent: Number(e.target.value) })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" /></label>
                            <label className="text-xs text-gray-500">相对边距 (原图短边的 %)<input type="number" min="0" max="50" value={activeTemplate.marginPercent} onChange={e => updateTemplate(activeTemplate.id, { marginPercent: Number(e.target.value) })} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white" /></label>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Preview */}
          <div className="flex flex-col rounded-2xl border border-gray-200 bg-gray-100 p-4 shadow-inner dark:border-white/[0.08] dark:bg-gray-950/50">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center justify-between">
              <span>3. 实时预览</span>
              <span className="text-xs font-normal text-gray-500">
                {activeTab === 'rules' ? '规则效果' : '模板效果'}
              </span>
            </h3>
            <div className="flex-1 relative flex items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white overflow-hidden checkerboard-bg">
              {previewUrl ? (
                <img src={previewUrl} className="max-w-full max-h-full object-contain shadow-sm" alt="Preview" />
              ) : (
                <span className="text-sm text-gray-400">请先在左侧添加图片</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .checkerboard-bg { background-image: linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; }
      `}</style>
    </main>
  )
}
