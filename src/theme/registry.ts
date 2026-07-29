/**
 * 皮肤注册表：皮肤元数据的唯一来源（Single Source of Truth）。
 *
 * 新增皮肤 SOP（不需要改动任何其他类型 / Header / 设置页）：
 * 1. 复制 `src/theme/styles/skins/_template.css` 为 `skins/<id>.css`，填写浅色/深色 Token。
 * 2. 在 `src/theme/styles/skins.css` 中 @import 新皮肤文件。
 * 3. 在下方 SKIN_REGISTRY 增加一项（label / description / swatch / preview / order）。
 * 4. 运行 `npm test`（Token 契约测试会校验新皮肤）并在设计系统预览页检查。
 */

export interface SkinDefinition {
  /** 显示名称 */
  label: string
  /** 一句话说明 */
  description: string
  /** 主色预览色值（紧凑色板圆点） */
  swatch: string
  /** 渐变预览（设置页预设卡片） */
  preview: string
  /** 显示顺序，数值小者在前 */
  order: number
}

export const SKIN_REGISTRY = {
  default: {
    label: '默认',
    description: '原始蓝灰主题',
    swatch: 'hsl(218 42% 46%)',
    preview: 'linear-gradient(135deg, hsl(218 42% 46%), hsl(216 48% 72%))',
    order: 0,
  },
  apple: {
    label: 'Apple',
    description: 'iOS / macOS 系统蓝',
    swatch: 'hsl(211 100% 50%)',
    preview: 'linear-gradient(135deg, hsl(211 100% 50%), hsl(199 95% 62%))',
    order: 10,
  },
  xiaomi: {
    label: '小米',
    description: 'HyperOS 品牌橙',
    swatch: 'hsl(24 100% 50%)',
    preview: 'linear-gradient(135deg, hsl(24 100% 50%), hsl(41 100% 50%))',
    order: 20,
  },
  rose: {
    label: '玫瑰花园',
    description: '浪漫暖粉',
    swatch: 'hsl(340 90% 55%)',
    preview: 'linear-gradient(135deg, hsl(340 90% 55%), hsl(330 90% 70%))',
    order: 30,
  },
  lake: {
    label: '湖光',
    description: '清新青绿',
    swatch: 'hsl(170 80% 42%)',
    preview: 'linear-gradient(135deg, hsl(170 80% 42%), hsl(190 80% 55%))',
    order: 40,
  },
  sunset: {
    label: '日落霞光',
    description: '活力橙红',
    swatch: 'hsl(15 100% 55%)',
    preview: 'linear-gradient(135deg, hsl(15 100% 55%), hsl(340 90% 60%))',
    order: 50,
  },
  lavender: {
    label: '薰衣草梦',
    description: '柔和紫韵',
    swatch: 'hsl(260 85% 65%)',
    preview: 'linear-gradient(135deg, hsl(260 85% 65%), hsl(290 85% 75%))',
    order: 60,
  },
  midnight: {
    label: '暗夜',
    description: '深邃靛蓝',
    swatch: 'hsl(245 80% 60%)',
    preview: 'linear-gradient(135deg, hsl(245 80% 60%), hsl(220 80% 55%))',
    order: 70,
  },
} as const satisfies Record<string, SkinDefinition>

/** 皮肤 ID：由注册表自动推导，新增皮肤无需手写联合类型 */
export type SkinId = keyof typeof SKIN_REGISTRY

export const DEFAULT_SKIN_ID: SkinId = 'default'

/** 按 order 排序后的全部皮肤 ID */
export const SKIN_IDS: SkinId[] = (Object.keys(SKIN_REGISTRY) as SkinId[]).sort(
  (a, b) => SKIN_REGISTRY[a].order - SKIN_REGISTRY[b].order,
)

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, value)
}

/** 非法 / 已删除的皮肤 ID 一律回退到默认皮肤 */
export function normalizeSkinId(value: unknown): SkinId {
  return isSkinId(value) ? value : DEFAULT_SKIN_ID
}

export interface SkinEntry extends SkinDefinition {
  id: SkinId
}

/** 供设置页 / Header 等 UI 使用的有序皮肤列表 */
export function getOrderedSkins(): SkinEntry[] {
  return SKIN_IDS.map((id) => ({ id, ...SKIN_REGISTRY[id] }))
}
