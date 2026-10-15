"use client";

import { useId } from "react";

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  id: string;
  children: React.ReactNode;
};

function FieldShell({ label, hint, error, id, children }: FieldShellProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-gray-200 light:text-ink">
          {label}
        </label>
        {hint && <span className="text-[13px] text-gray-500 light:text-ink/60">{hint}</span>}
      </div>
      {children}
      {error && (
        <p role="alert" className="mt-1.5 text-[13px] text-red-400 light:text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(error?: string) {
  return `w-full rounded-lg border bg-white/5 px-3.5 text-base text-white placeholder:text-gray-500 transition-colors duration-150 focus:outline-none focus:ring-2 light:bg-white light:text-ink light:placeholder:text-ink/60 ${
    error
      ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/15 light:border-red-500 light:focus:border-red-500"
      : "border-white/15 focus:border-accent focus:ring-accent/20 light:border-ink/15"
  }`;
}

type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ label, hint, error, className = "", ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={`h-11 ${inputClass(error)} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({ label, hint, error, className = "", ...rest }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        className={`resize-none py-2 leading-relaxed ${inputClass(error)} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}
