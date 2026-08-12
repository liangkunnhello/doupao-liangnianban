import { describe, expect, it } from 'vitest'
import type { GalleryAgentGenerationResult } from './galleryAgentGeneration'
import { formatAgentStrategyResultContent } from '../../store'

describe('Agent strategy conversation content', () => {
  it('shows product routing, selected skill, strategies, variable prompts and execution progress', () => {
    const generated: GalleryAgentGenerationResult = {
      plan: {
        productType: '运动鞋',
        hasIntentionalCopy: false,
        skillKind: 'visual',
        skillReason: '参考图没有需要保留的有意设计文案',
        strategyDirections: [
          { name: '悬浮拆解', focus: '用悬浮层级展示鞋体和功能部件' },
          { name: '运动轨迹', focus: '通过动作轨迹表达缓震性能' },
        ],
      },
      variablePrompts: [{
        name: '悬浮拆解模板',
        description: '适合批量生成产品功能视觉。',
        variablePrompt: '图片比例为16:9。展示{{鞋体状态}}。\n\n可变项：\n{{鞋体状态}}：悬浮分层 / 落地回弹',
      }],
    }

    const content = formatAgentStrategyResultContent(generated, 3, 2)

    expect(content).toContain('产品/内容类型**：运动鞋')
    expect(content).toContain('纯视觉素材，默认排除文字与文案排版')
    expect(content).toContain('extract-image-generation-strategies')
    expect(content).toContain('悬浮拆解')
    expect(content).toContain('运动轨迹')
    expect(content).toContain('{{鞋体状态}}')
    expect(content).toContain('正在提交图片任务 2/3')
  })

  it('keeps app copy routing visible and subject copy binding explicit', () => {
    const generated: GalleryAgentGenerationResult = {
      plan: {
        productType: '菜品信息卡',
        hasIntentionalCopy: true,
        skillKind: 'app-copy',
        skillReason: '参考图包含菜名、配料与信息排版',
        strategyDirections: [{ name: '菜品叙事', focus: '保持菜品与对应菜名和配料绑定' }],
      },
      variablePrompts: [{
        name: '菜品绑定模板',
        description: '',
        variablePrompt: '根据{{主体文案包}}生成画面。\n\n可变项：\n{{主体文案包}}：冬瓜汤与对应配料 / 牛腩汤与对应配料',
      }],
    }

    const content = formatAgentStrategyResultContent(generated, 1)

    expect(content).toContain('extract-app-copy-strategies')
    expect(content).toContain('有意设计文案')
    expect(content).toContain('{{主体文案包}}')
    expect(content).toContain('正在生成 1 张图片')
  })
})
