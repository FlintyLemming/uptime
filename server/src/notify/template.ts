export interface TemplateVars {
  event: string
  monitor_name: string
  monitor_type: string
  target: string
  group_name: string
  status: string
  error: string
  attempts: string
  slot_started_at: string
  down_duration_s: string
  url: string
}

/** JSON 字符串内部转义：转义引号/反斜杠/控制字符，去掉 JSON.stringify 的首尾引号 */
function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in vars) return jsonEscape(vars[key as keyof TemplateVars])
    return match
  })
}

/** unix 秒 → 指定时区的 ISO8601（带偏移） */
export function formatSlotTime(unixSec: number, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'longOffset',
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(unixSec * 1000)).map((p) => [p.type, p.value]))
  const offset = (parts.timeZoneName ?? 'GMT+00:00').replace('GMT', '') || '+00:00'
  const off = offset === '' ? '+00:00' : offset
  // en-US hour12:false 在午夜可能给出 '24'，规范化
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}${off}`
}
