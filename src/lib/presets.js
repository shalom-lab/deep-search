/** 搜索语法预设（与官方文档一致）。 */
export const PRESETS = [
  { label: 'site:', template: ' site:', caret: 0, title: '限定站点，例如：关键词 site:github.com' },
  { label: '-site:', template: ' -site:', caret: 0, title: '排除站点，例如：关键词 -site:example.com' },
  { label: '"精确短语"', template: '"精确短语"', caret: -1, title: '精确匹配整段短语' },
  { label: 'lang:zh,en', template: ' lang:zh,en', caret: 0, title: '限定语言，多语言用逗号分隔' },
  { label: 'after:', template: ' after:2025-01-01', caret: 0, title: '限定发布日期之后' },
  { label: 'before:', template: ' before:2026-06-01', caret: 0, title: '限定发布日期之前' },
  { label: '-"排除短语"', template: ' -"release notes"', caret: 0, title: '排除包含该短语的网页' },
  { label: 'OR site:', template: ' OR site:huggingface.co', caret: 0, title: '多个站点用空格分隔并通过 OR 连接' },
];

export const EXAMPLE_QUERIES = [
  { title: '快速上手', desc: 'DeepSeek V4 模型 发布' },
  { title: '限定站点', desc: 'DeepSeek 推理优化 site:github.com' },
  { title: '时效检索', desc: '大模型 网页搜索 API after:2025 lang:zh' },
  { title: '排除干扰', desc: 'DeepSeek API 价格 -site:csdn.net -"转载"' },
];

export const SORTS = [
  { value: 'score', label: '综合排序' },
  { value: 'authority', label: '权威度优先' },
  { value: 'fresh', label: '时效优先' },
  { value: 'site', label: '按站点聚合' },
];

export const FILTERS = [
  { value: '0', label: '全部结果' },
  { value: '1.5', label: '优质结果 ≥1.5' },
  { value: '2', label: '高分结果 ≥2.0' },
  { value: 'auth3', label: '极权威站点 ≥3' },
];
