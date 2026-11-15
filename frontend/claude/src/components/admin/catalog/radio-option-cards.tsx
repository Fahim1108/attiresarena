"use client";

export interface RadioOptionChoice {
  value: string;
  /** Short main label, kept to one or two words so it never wraps awkwardly. */
  label: string;
  /** One short clarifying line under the label. */
  hint: string;
  /** Controlled selection. Omit for uncontrolled groups. */
  checked?: boolean;
  /** Uncontrolled initial selection. Omit for controlled groups. */
  defaultChecked?: boolean;
  /** Controlled change handler. Omit for uncontrolled groups. */
  onChange?: () => void;
}

/**
 * Native radios rendered as option cards. The inputs stay real,
 * visible radio controls (keyboard, screen-reader, and form behaviour
 * stay native; the browser enforces one selection per name), while the
 * wrapping card carries the selected, hover, focus, and disabled
 * styling through `:has()` in admin-panel.css. No local state: callers
 * pass either controlled (`checked` + `onChange`) or uncontrolled
 * (`defaultChecked`) options, and the group submits like any radio
 * group under `name`.
 */
export function RadioOptionGroup({
  name,
  ariaLabel,
  ariaLabelledBy,
  describedBy,
  options,
}: {
  name: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  describedBy?: string;
  options: RadioOptionChoice[];
}) {
  return (
    <div
      className="aa-radio-cards"
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={describedBy}
    >
      {options.map((option) => (
        <label key={option.value} className="aa-radio-card">
          <input
            type="radio"
            name={name}
            value={option.value}
            {...(option.checked !== undefined
              ? { checked: option.checked }
              : {})}
            {...(option.defaultChecked !== undefined
              ? { defaultChecked: option.defaultChecked }
              : {})}
            {...(option.onChange ? { onChange: option.onChange } : {})}
          />
          <span className="aa-radio-card__text">
            <span className="aa-radio-card__label">{option.label}</span>
            <span className="aa-radio-card__hint">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
