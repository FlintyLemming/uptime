import { useCallback, useEffect, useRef, useState } from 'react'
import { settingsApi, ApiError } from '../../lib/admin-api'

const INPUT = 'rounded-lg border px-3 py-2'
const inputStyle = { borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13.5 }

const CARD = 'flex flex-col gap-4 rounded-xl border p-6'
const cardStyle = { borderColor: 'var(--line)', background: 'var(--card)', boxShadow: 'var(--shadow)' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
      {label}
      {children}
    </label>
  )
}

export default function SettingsPage() {
  const [siteTitle, setSiteTitle] = useState('')
  const [timezone, setTimezone] = useState('')
  const [slotRetention, setSlotRetention] = useState(90)
  const [attemptRetention, setAttemptRetention] = useState(7)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdMessage, setPwdMessage] = useState<string | null>(null)
  const [pwdError, setPwdError] = useState<string | null>(null)

  const loadedRef = useRef(false)
  const initialTz = useRef('')

  const load = useCallback(() => {
    settingsApi.get().then((s) => {
      setSiteTitle(s.site_title)
      setTimezone(s.display_timezone)
      setSlotRetention(s.slot_retention_days)
      setAttemptRetention(s.attempt_retention_days)
      if (!loadedRef.current) { loadedRef.current = true; initialTz.current = s.display_timezone }
      setLoaded(true)
    }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  if (!loaded) return null

  const slotInvalid = slotRetention < 90
  const attemptInvalid = attemptRetention < 1
  const canSave = !slotInvalid && !attemptInvalid

  const save = async () => {
    setErrors([])
    setMessage(null)
    try {
      await settingsApi.put({
        site_title: siteTitle,
        display_timezone: timezone,
        slot_retention_days: slotRetention,
        attempt_retention_days: attemptRetention,
      })
      if (initialTz.current !== timezone) {
        setMessage('保存成功。时区已变更，历史日桶正在重建（90 天前的日桶保持原值）。')
        initialTz.current = timezone
      } else {
        setMessage('保存成功')
      }
    } catch (err) {
      setErrors(err instanceof ApiError && err.errors.length ? err.errors : ['保存失败'])
    }
  }

  const changePassword = async () => {
    setPwdError(null)
    setPwdMessage(null)
    if (next.length < 8) { setPwdError('新密码至少 8 位'); return }
    if (next !== confirmPwd) { setPwdError('两次输入的新密码不一致'); return }
    try {
      await settingsApi.changePassword(current, next)
      setPwdMessage('密码修改成功')
      setCurrent(''); setNext(''); setConfirmPwd('')
    } catch (err) {
      setPwdError(err instanceof ApiError && err.status === 401 ? '当前密码不正确' : '密码修改失败')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="font-semibold" style={{ fontSize: 15 }}>设置</div>

      <div className={CARD} style={cardStyle}>
        <div className="font-medium" style={{ fontSize: 13.5 }}>站点设置</div>
        {message && <div style={{ fontSize: 12.5, color: '#24c19a' }}>{message}</div>}
        {errors.length > 0 && (
          <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,37,.08)', fontSize: 12.5, color: '#dc2625' }}>
            {errors.map((e) => <div key={e}>{e}</div>)}
          </div>
        )}
        <Field label="站点标题">
          <input value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} className={INPUT} style={inputStyle} />
        </Field>
        <Field label="显示时区（IANA 名称，如 Asia/Shanghai）">
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={INPUT} style={inputStyle} />
        </Field>
      </div>

      <div className={CARD} style={cardStyle}>
        <div className="font-medium" style={{ fontSize: 13.5 }}>保留期</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="明细数据保留天数（最少 90）">
            <input type="number" value={slotRetention} onChange={(e) => setSlotRetention(Number(e.target.value))} className={INPUT} style={inputStyle} />
          </Field>
          <Field label="探测记录保留天数（最少 1）">
            <input type="number" value={attemptRetention} onChange={(e) => setAttemptRetention(Number(e.target.value))} className={INPUT} style={inputStyle} />
          </Field>
        </div>
        {slotInvalid && <div style={{ fontSize: 12.5, color: '#dc2625' }}>明细数据保留天数不得小于 90</div>}
        {attemptInvalid && <div style={{ fontSize: 12.5, color: '#dc2625' }}>探测记录保留天数不得小于 1</div>}
        <button
          className="self-start cursor-pointer rounded-lg px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: '#24c19a', color: '#fff', fontSize: 13.5 }}
          disabled={!canSave}
          onClick={save}
        >
          保存设置
        </button>
      </div>

      <div className={CARD} style={cardStyle}>
        <div className="font-medium" style={{ fontSize: 13.5 }}>修改密码</div>
        {pwdMessage && <div style={{ fontSize: 12.5, color: '#24c19a' }}>{pwdMessage}</div>}
        {pwdError && <div style={{ fontSize: 12.5, color: '#dc2625' }}>{pwdError}</div>}
        <Field label="当前密码">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={INPUT} style={inputStyle} />
        </Field>
        <Field label="新密码（至少 8 位）">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={INPUT} style={inputStyle} />
        </Field>
        <Field label="确认新密码">
          <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className={INPUT} style={inputStyle} />
        </Field>
        <button className="self-start cursor-pointer rounded-lg border px-4 py-2" style={{ borderColor: 'var(--line)', fontSize: 13.5, color: 'var(--fg-2)' }} onClick={changePassword}>
          修改密码
        </button>
      </div>
    </div>
  )
}
