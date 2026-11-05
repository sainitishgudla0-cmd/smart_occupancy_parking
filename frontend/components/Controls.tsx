"use client";

import { useId, type ReactNode } from "react";

import { formatDateShort } from "@/lib/format";

export function Field({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className="field">
      {id ? (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Choose "latest", or replay any half-hour slot from the held-out test period. */
export function AsOfPicker({
  value,
  days,
  slots,
  onChange,
}: {
  value: string | null;
  days: string[];
  slots: string[];
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  const [day, time] = value ? value.split("T") : [null, null];
  const lastDay = days[days.length - 1];
  return (
    <>
      <Segmented
        label="Starting point"
        value={value ? "replay" : "latest"}
        options={[
          { value: "latest", label: "Latest reading" },
          { value: "replay", label: "Replay a past time" },
        ]}
        onChange={(mode) => onChange(mode === "latest" ? null : `${lastDay}T12:00`)}
      />
      {value ? (
        <>
          <Field label="Replay date" id={`${id}-day`}>
            <select
              id={`${id}-day`}
              className="select"
              value={day ?? ""}
              onChange={(event) => onChange(`${event.target.value}T${time}`)}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDateShort(d)} 2016
                </option>
              ))}
            </select>
          </Field>
          <Field label="Replay time" id={`${id}-time`}>
            <select
              id={`${id}-time`}
              className="select"
              value={time ?? ""}
              onChange={(event) => onChange(`${day}T${event.target.value}`)}
            >
              {slots.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
    </>
  );
}
