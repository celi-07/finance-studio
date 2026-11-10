"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Select } from "@base-ui/react/select";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { dayLabel, monthLabel, shiftMonth, today } from "@/lib/ledger";

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
  const [open, setOpen] = useState(false);
  const scrollDismissal = useRef<HTMLElement | null>(null);
  const selection = value ?? uncontrolled;
  const setTrigger = useCallback((node: HTMLButtonElement | null) => setDialog(node?.closest("dialog") ?? null), []);

  useEffect(() => {
    const scrollArea = dialog?.querySelector<HTMLElement>(":scope > .modal-scroll");
    if (!open || !scrollArea) return;
    // The list is portaled beside this region, so only scrolling the form dismisses it.
    const dismiss = () => { scrollDismissal.current = scrollArea; setOpen(false); };
    scrollArea.addEventListener("scroll", dismiss, { passive: true, once: true });
    return () => scrollArea.removeEventListener("scroll", dismiss);
  }, [dialog, open]);

  return <Select.Root items={options} value={selection} disabled={disabled} modal={!dialog} open={open} onOpenChange={next => {
    if (next) scrollDismissal.current = null;
    setOpen(next);
  }} onValueChange={next => {
    if (next === null) return;
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  }}>
    {name && <input type="hidden" name={name} value={selection} disabled={disabled}/>}
    <Select.Trigger className="picker-trigger" type="button" aria-label={label} aria-invalid={invalid}
      ref={setTrigger}>
      {Icon && <Icon size={16} className="picker-leading" aria-hidden="true"/>}
      <Select.Value className="picker-value" placeholder="Choose an option"/>
      <ChevronDown className="picker-chevron" size={15} aria-hidden="true"/>
    </Select.Trigger>
    <Select.Portal container={dialog ?? undefined}>
      <Select.Positioner alignItemWithTrigger={false} positionMethod="fixed" align="start" sideOffset={7} collisionPadding={10} className="picker-positioner">
        <Select.Popup className="picker-menu" finalFocus={() => scrollDismissal.current ?? true}>
          <Select.List className="picker-options">
            {options.map(option => <Select.Item value={option.value} key={option.value} className="picker-option">
              {option.swatch && <span className={"category-dot " + option.swatch} aria-hidden="true"/>}
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="picker-check"><Check size={15} strokeWidth={2.4}/></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}

const firstMonth = "1900-01";
const lastMonth = "2199-12";
const monthNames = Array.from({ length: 12 }, (_, index) => monthLabel("2000-" + String(index + 1).padStart(2, "0")).replace(/ 2000$/, ""));

const toCalendarDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const fromCalendarDate = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, "0")).join("-");

export function DatePicker({ label, name, value, defaultValue = "", onChange, min, max, invalid, required }: {
  label: string; name?: string; value?: string; defaultValue?: string; onChange?: (date: string) => void;
  min?: string; max?: string; invalid?: boolean; required?: boolean;
}) {
  const [local, setLocal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLDialogElement | null>(null);
  const bind = useCallback((button: HTMLButtonElement | null) => setContainer(button?.closest("dialog") ?? null), []);
  const selected = value ?? local;
  const lower = toCalendarDate(min || "1900-01-01");
  const upper = toCalendarDate(max || "2199-12-31");
  const current = toCalendarDate(today());
  const select = (date: string) => {
    if (value === undefined) setLocal(date);
    onChange?.(date);
    setOpen(false);
  };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    {name && <input type="hidden" name={name} value={selected}/>}
    <Popover.Trigger ref={bind} className="picker-trigger date-trigger" type="button" aria-label={label + (selected ? ", " + dayLabel(selected) : "")} aria-invalid={invalid}>
      <CalendarDays size={16} className="picker-leading" aria-hidden="true"/>
      <span className="picker-value">{selected ? dayLabel(selected) : "Choose a date"}</span>
      <ChevronDown className="picker-chevron" size={15} aria-hidden="true"/>
    </Popover.Trigger>
    <Popover.Portal container={container ?? undefined}>
      <Popover.Content className="month-popover day-popover" aria-label={label} align="start" sideOffset={8} collisionPadding={10}>
        <DayPicker mode="single" required={false} autoFocus weekStartsOn={1}
          captionLayout="dropdown" navLayout="after" startMonth={lower} endMonth={upper}
          today={current} defaultMonth={selected ? toCalendarDate(selected) : current}
          selected={selected ? toCalendarDate(selected) : undefined}
          disabled={[{ before: lower }, { after: upper }]}
          onSelect={(date, clicked) => select(fromCalendarDate(date ?? clicked))}/>
        {!required && selected && <button type="button" className="button quiet" onClick={() => select("")}>Clear date</button>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

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
