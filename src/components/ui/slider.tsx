import * as React from 'react';
import { cn } from '@/lib/utils';

/** Slider — styled range input */
interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
}

function Slider({ value, onChange, min = 0, max = 100, step = 1, label, className }: SliderProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && (
        <span className="text-label text-on-surface-variant whitespace-nowrap min-w-[60px]">
          {label}
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-cw-full appearance-none cursor-pointer
          bg-outline-variant accent-primary
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:duration-short3
          [&::-webkit-slider-thumb]:hover:scale-110"
      />
      <span className="text-label-sm text-on-surface-variant font-mono min-w-[36px] text-right">
        {value}
      </span>
    </div>
  );
}

export { Slider };
