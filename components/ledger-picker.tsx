"use client";

import { useCallback, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Popover, Select } from "radix-ui";
import { monthLabel, shiftMonth } from "@/lib/ledger";

type Option = { value: string; label: string; swatch?: string };
type PickerProps = {
  label: string;
  options: Option[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  invalid?: boolean;
};

export function Picker({ label, options, value, defaultValue = "", onValueChange, name, icon: Icon, disabled, invalid }: PickerProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const selection = value ?? uncontrolled;
  const setTrigger = useCallback((node: HTMLButtonElement | null) => setDialog(node?.closest("dialog") ?? null), []);

  return <Select.Root value={"v" + selection} disabled={disabled} onValueChange={next => {
    const chosen = next.slice(1);
    if (value === undefined) setUncontrolled(chosen);
    onValueChange?.(chosen);
  }}>
    {name && <input type="hidden" name={name} value={selection} disabled={disabled}/>}
    <Select.Trigger className="picker-trigger" type="button" aria-label={label} aria-invalid={invalid}
      ref={setTrigger}>
      {Icon && <Icon size={16} className="picker-leading" aria-hidden="true"/>}
      <span className="picker-value"><Select.Value placeholder="Choose an option"/></span>
      <Select.Icon asChild><ChevronDown className="picker-chevron" size={15} aria-hidden="true"/></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={dialog ?? undefined}>
      <Select.Content position="popper" align="start" sideOffset={7} collisionPadding={10} className="picker-menu">
        <Select.Viewport className="picker-options">
          {options.map(option => <Select.Item value={"v" + option.value} key={option.value} className="picker-option">
            {option.swatch && <span className={"category-dot " + option.swatch} aria-hidden="true"/>}
            <Select.ItemText>{option.label}</Select.ItemText>
            <Select.ItemIndicator className="picker-check"><Check size={15} strokeWidth={2.4}/></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

const firstMonth = "1900-01";
const lastMonth = "2199-12";
const monthNames = Array.from({ length: 12 }, (_, index) => monthLabel("2000-" + String(index + 1).padStart(2, "0")).replace(/ 2000$/, ""));

export function ReportingMonth({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.slice(0, 4));
  const validYear = /^(?:19|20|21)[0-9]{2}$/.test(year);
  function moveYear(direction: number) {
    setYear(String(Math.max(1900, Math.min(2199, (validYear ? Number(year) : Number(value.slice(0, 4))) + direction))));
  }
  return <div className="month-control" role="group" aria-label="Reporting month">
    <button type="button" className="icon-button" aria-label="Previous month" disabled={value <= firstMonth}
      onClick={() => onChange(shiftMonth(value, -1))}><ChevronLeft size={17}/></button>
    <Popover.Root open={open} onOpenChange={next => { if (next) setYear(value.slice(0, 4)); setOpen(next); }}>
      <Popover.Trigger className="month-label" type="button" aria-label={"Select reporting month, " + monthLabel(value)}>
        <CalendarDays size={16} aria-hidden="true"/>
        <span className="month-long">{monthLabel(value)}</span><span className="month-short" aria-hidden="true">{monthLabel(value).slice(0, 3) + " " + value.slice(0, 4)}</span>
        <ChevronDown className="picker-chevron" size={15} aria-hidden="true"/>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="month-popover" aria-label="Choose a reporting month" sideOffset={8} collisionPadding={12}>
          <div className="month-year">
            <button type="button" className="icon-button" aria-label="Previous year" disabled={year === "1900"} onClick={() => moveYear(-1)}><ChevronLeft size={17}/></button>
            <input aria-label="Reporting year" aria-invalid={!validYear} inputMode="numeric" value={year} maxLength={4}
              onChange={event => setYear(event.target.value.replace(/[^0-9]/g, ""))}/>
            <button type="button" className="icon-button" aria-label="Next year" disabled={year === "2199"} onClick={() => moveYear(1)}><ChevronRight size={17}/></button>
          </div>
          <div className="month-grid">
            {monthNames.map((name, index) => {
              const month = year + "-" + String(index + 1).padStart(2, "0");
              return <Popover.Close asChild key={name}><button type="button" disabled={!validYear} aria-label={name + " " + year}
                aria-pressed={value === month} onClick={() => onChange(month)}>{name.slice(0, 3)}</button></Popover.Close>;
            })}
          </div>
          {!validYear && <p className="month-error" role="status">Enter a year from 1900 to 2199.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <button type="button" className="icon-button" aria-label="Next month" disabled={value >= lastMonth}
      onClick={() => onChange(shiftMonth(value, 1))}><ChevronRight size={17}/></button>
  </div>;
}
