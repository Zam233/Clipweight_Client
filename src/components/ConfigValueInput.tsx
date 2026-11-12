/**
 * ConfigValueInput — 按字段类型分派的通用配置输入控件。
 *
 * 供「后端配置」页与插件配置弹窗共用；bool 渲染开关、int/float 数字框、
 * dict/list 渲染 JSON 文本域，其余按字符串输入框处理。
 */
import { useEffect, useState } from 'react';

export interface ConfigValueInputProps {
  type: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** 字符串输入框的占位提示（如 secret 的掩码） */
  placeholder?: string;
}

const INPUT_CLS =
  'w-full bg-surface rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary disabled:opacity-50';

/**
 * P2-14：数字输入不能用 `Number(v)||0` 直连 store——空串会被写成 0，
 * 用户既清不空也没法先输「-」。这里用本地草稿：输入过程中允许 ""/"-"，
 * 只在解析出有限数时提交；失焦时丢弃非法中间态（显示回原值）。
 */
function NumberField({
  value, integer, step, disabled, onChange,
}: {
  value: unknown;
  integer: boolean;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const toText = (v: unknown) => (v == null || v === '' ? '' : String(v));
  const [draft, setDraft] = useState<string>(() => toText(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(toText(value));
  }, [value, focused]);

  return (
    <input
      type="number"
      step={step}
      disabled={disabled}
      value={focused ? draft : toText(value)}
      onFocus={() => { setFocused(true); setDraft(toText(value)); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return;
        const n = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
        if (Number.isFinite(n)) onChange(n);
      }}
      className={INPUT_CLS}
    />
  );
}

export function ConfigValueInput({ type, value, onChange, disabled, placeholder }: ConfigValueInputProps) {
  switch (type) {
    case 'bool':
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(!value)}
          className={`relative w-11 h-6 rounded-cw-full transition-colors duration-short3 cursor-pointer disabled:opacity-50 ${
            value ? 'bg-track-audio' : 'bg-outline-variant/50'
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-short3 ${
            value ? 'left-[22px]' : 'left-0.5'
          }`} />
        </button>
      );
    case 'int':
      return (
        <NumberField
          value={value} integer step={1} disabled={disabled}
          onChange={(v) => onChange(v)}
        />
      );
    case 'float':
      return (
        <NumberField
          value={value} integer={false} step={0.1} disabled={disabled}
          onChange={(v) => onChange(v)}
        />
      );
    case 'dict':
    case 'list':
      return (
        <textarea
          disabled={disabled}
          value={JSON.stringify(value ?? null, null, 2)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); } catch { /* 输入过程中容忍非法 JSON */ }
          }}
          rows={4}
          spellCheck={false}
          className="w-full bg-surface rounded-cw-xs border border-outline-variant/30 p-2.5 text-label-sm text-on-surface
            outline-none focus:border-primary resize-y font-mono placeholder:text-on-surface-variant/50 disabled:opacity-50"
        />
      );
    default:
      return (
        <input
          type="text"
          disabled={disabled}
          value={String(value ?? '')}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLS}
        />
      );
  }
}
