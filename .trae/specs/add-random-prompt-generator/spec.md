# 随机提示词生成器 Spec

## Why

用户生成图片时需要手动编写提示词，但希望利用词库实现"带通配符的提示词模板"——模板中嵌入占位符，每次生成时从词库随机抽取词条填充，实现提示词的多样化和自动化。

## What Changes

- 新增 `src/lib/promptGenerator.ts`：实现核心函数 `render_prompt` 及辅助函数 `slugify`、`normalize_entries`、`normalize_draw_count`
- 新增 `src/lib/promptGenerator.test.ts`：对核心函数进行全部边界和逻辑的单元测试
- **不修改** 现有组件或 store，此模块为纯函数工具库

## Impact

- Affected specs: 无（纯新增模块，不修改现有功能）
- Affected code: `src/lib/promptGenerator.ts`（新增）、`src/lib/promptGenerator.test.ts`（新增）

## ADDED Requirements

### Requirement: 辅助函数

系统 SHALL 提供以下纯辅助函数：

#### Scenario: slugify(text)

- **WHEN** 输入 `"Hello World"`
- **THEN** 返回 `"hello_world"`
- **WHEN** 输入 `" 测试 Hello!! World!! "`
- **THEN** 返回 `"测试_hello_world"`（保留中文，去除非字母数字下划线中文，转小写，空格变下划线）
- **WHEN** 输入超长文本（超过48字符）
- **THEN** 截断到48字符

#### Scenario: normalize_entries(entries)

- **WHEN** 输入 `["a", "b", "", "a"]`
- **THEN** 返回 `["a", "b"]`（去重去空）
- **WHEN** 输入非数组（如字符串 `"a\nb\nc"`）
- **THEN** 按换行符拆分为数组 `["a", "b", "c"]`，再去重去空
- **WHEN** 输入 `null` 或 `undefined`
- **THEN** 返回 `[]`

#### Scenario: normalize_draw_count(v)

- **WHEN** 输入 `3`
- **THEN** 返回 `3`
- **WHEN** 输入 `"5"`
- **THEN** 返回 `5`（字符串转数字）
- **WHEN** 输入 `0` 或 `1000`
- **THEN** 返回 `1`（范围 1~999，超出返回1）
- **WHEN** 输入 `"abc"` 或 `null`
- **THEN** 返回 `1`（解析失败返回1）

### Requirement: render_prompt 核心函数

系统 SHALL 提供 `render_prompt(state, seed?, missing_policy?)` 函数。

#### 数据模型

- `state`：JSON 对象或字符串，包含 `segments`（段落列表）和 `library`（词库字典）
- `segments` 元素类型：
  - `{"type": "text", "text": "普通文本"}` → 直接拼接
  - `{"type": "wildcard", "id": "风格", "label": "风格"}` → 从词库随机抽取替换
- `library`：字典，key 为属性 id，value 包含 `entries`（string[]）、`draw_count`（int，默认1）、`label`（string）
- 词库属性可能是列表格式（数组形式的条目列表），需自动转为对象格式

#### Scenario: 基本渲染 - 纯文本

- **WHEN** state 为 `{"segments":[{"type":"text","text":"a cat"}],"library":{}}`
- **THEN** 返回 `("a cat", [])`

#### Scenario: 基本渲染 - 通配符替换

- **WHEN** state 包含 wildcard 段，且 library 中有对应 entries
- **THEN** 从 entries 中随机不重复抽取 `draw_count` 条，逗号拼接替换，并返回抽取报告

#### Scenario: 确定性随机（seed）

- **WHEN** 传入相同的 `seed>0`
- **THEN** 多次调用返回相同结果
- **WHEN** 不传 seed 或 seed=0
- **THEN** 每次调用结果不同（真随机）

#### Scenario: missing_policy="keep_label"（默认）

- **WHEN** wildcard 的 id 在 library 中无对应 entries
- **THEN** 追加该 wildcard 的 label 文本到输出

#### Scenario: missing_policy="empty"

- **WHEN** wildcard 的 id 在 library 中无对应 entries
- **THEN** 追加空字符串到输出

#### Scenario: draw_count 大于 entries 长度

- **WHEN** draw_count=5 但 entries 只有3条
- **THEN** 返回全部3条（不重复抽取，取全部）

#### Scenario: 边界 - 空 state

- **WHEN** state 为 `{}` 或空字符串
- **THEN** 返回 `("", [])`

#### Scenario: 边界 - entries 去重去空

- **WHEN** entries 包含 `["a", "", "a", "b"]`
- **THEN** 实际候选池为 `["a", "b"]`，从中随机抽取

#### Scenario: 边界 - 词库属性为列表格式

- **WHEN** library 中某个属性的值是数组（如 `["猫", "狗"]`）而非对象
- **THEN** 自动转换为 `{"entries": ["猫", "狗"], "draw_count": 1, "label": ""}`

#### Scenario: 抽取报告格式

- **WHEN** 成功抽取
- **THEN** 报告数组中每个条目包含 `{id, label, drawn}`，其中 `drawn` 是本次抽取到的词条数组