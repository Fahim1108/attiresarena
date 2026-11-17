import { Search } from "lucide-react";
import { Input } from "@/components/ui/Field";

/**
 * SearchInput — labelled search field for FilterBar and tables.
 *
 * Reuses the existing Input from src/components/ui/Field (label, hint,
 * error, icon slot) instead of duplicating a second input primitive.
 * Controlled and cheap per keystroke: the parent owns the value.
 * Deliberate reuse note: ui/Input carries storefront control styling;
 * Phase 2 may introduce an admin-styled input, but setup adds no
 * duplicate primitive.
 */
export function SearchInput({
  label,
  ariaLabel,
  value,
  onChange,
  placeholder = "Search…",
  id,
  name = "search",
  hint,
  className,
  wrapperClassName,
}: {
  /** Visible label. Omit only when ariaLabel names the field. */
  label?: string;
  /** Accessible name used when there is no visible label. */
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  hint?: string;
  className?: string;
  wrapperClassName?: string;
}) {
  return (
    <Input
      type="search"
      label={label}
      hint={hint}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      id={id}
      name={name}
      autoComplete="off"
      spellCheck={false}
      leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
      wrapperClassName={wrapperClassName}
      className={className}
      {...(label ? {} : { "aria-label": ariaLabel ?? "Search" })}
    />
  );
}
