/**
 * ConfigValueInput — 按字段类型分派的通用配置输入控件。
 *
 * 供「后端配置」页与插件配置弹窗共用；bool 渲染开关、int/float 数字框、
 * dict/list 渲染 JSON 文本域，其余按字符串输入框处理。
 */

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
        <input
          type="number" step={1}
          disabled={disabled}
          value={Number(value) || 0}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className={INPUT_CLS}
        />
      );
    case 'float':
      return (
        <input
          type="number" step={0.1}
          disabled={disabled}
          value={Number(value) || 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={INPUT_CLS}
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
