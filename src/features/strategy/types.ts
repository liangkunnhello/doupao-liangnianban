export type StrategyGenerationMode = 'text-to-image' | 'image-to-image'

export type StrategyReferenceSource = 'knowledge-material' | 'local-image' | 'generated-image'

export interface StrategyReferenceConfig {
  source: StrategyReferenceSource
  label: string
  value: string
  imageIds: string[]
}

export interface StrategyKnowledgeConfig {
  resolved: boolean
  insightIds: string[]
}

export type StrategySopMode = 'none' | 'preset' | 'custom'

export interface StrategySopConfig {
  resolved: boolean
  mode: StrategySopMode
  presetId?: string
  name?: string
  description?: string
  content: string
}

export interface StrategyWorkflow {
  reference?: StrategyReferenceConfig
  instruction: string
  knowledge: StrategyKnowledgeConfig
  sop: StrategySopConfig
}

export interface StrategyOutputs {
  channels: {
    enabled: boolean
    channelIds: string[]
  }
  sizes: {
    enabled: boolean
    ratios: Array<'16:9' | '9:16'>
  }
  export: {
    enabled: boolean
    presetId?: string
  }
  allocation: {
    enabled: boolean
    presetId?: string
  }
}

export type StrategyFlowStepKind =
  | 'mode'
  | 'reference'
  | 'instruction'
  | 'knowledge'
  | 'sop'
  | 'channel'
  | 'size'
  | 'export'
  | 'allocation'

export interface StrategyFlowStep {
  id: string
  kind: StrategyFlowStepKind
  label: string
  value: string
  sourceType?: 'knowledge-material' | 'knowledge-term' | 'local-image' | 'generated-image' | 'sop-preset'
  referenceImageIds?: string[]
}

export interface StrategyAsset {
  id: string
  name: string
  productId: string
  materialTypeId: string
  description: string
  coverImageId?: string
  generationMode: StrategyGenerationMode | null
  workflow: StrategyWorkflow
  outputs: StrategyOutputs
  quantity: number
  status: 'draft' | 'review' | 'published'
  version: number
  createdBy: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  resultPromptOverrides?: Record<string, string>
}

export type StrategyPresetType = 'sop' | 'export' | 'allocation'

export interface StrategyPreset {
  id: string
  name: string
  type: StrategyPresetType
  description: string
  value: string
  global: true
  createdBy: string
  createdAt: number
  archived?: boolean
}

export interface SopGroup {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface SopLibraryItem {
  id: string
  groupId?: string
  name: string
  description: string
  content: string
  source: 'manual' | 'generated' | 'legacy-preset'
  metaInstructionId?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  favorite?: boolean
  lastUsedAt?: number
}

export interface SopMetaInstruction {
  id: string
  name: string
  description: string
  instruction: string
  kind: 'general' | 'image-prompt' | 'custom'
  createdAt: number
  updatedAt: number
}
