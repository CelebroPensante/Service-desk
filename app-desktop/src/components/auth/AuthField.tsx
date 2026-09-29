import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

interface AuthFieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  icon: ComponentType<LucideProps>;
  required?: boolean;
  minLength?: number;
  onChange: (value: string) => void;
  marginClassName?: string;
}

export default function AuthField({
  id,
  label,
  type,
  value,
  placeholder,
  icon: Icon,
  required = true,
  minLength,
  onChange,
  marginClassName = "mb-4",
}: AuthFieldProps) {
  return (
    <div className={marginClassName}>
      <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          type={type}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
        />
      </div>
    </div>
  );
}