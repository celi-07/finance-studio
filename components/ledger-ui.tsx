"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, ChartNoAxesCombined, CircleDollarSign,
  ChevronRight, HandCoins, Landmark, Wallet, X, type LucideIcon,
} from "lucide-react";
import { accountName, activityLabel, activityMoney, dayLabel, type AccountKind, type Activity, type Workspace } from "@/lib/ledger";

export const accountIcons: Record<AccountKind, LucideIcon> = { bank: Landmark, wallet: Wallet, cash: Banknote, investment: ChartNoAxesCombined };
export const kindIcons: Record<Activity["kind"], LucideIcon> = {
  expense: ArrowUpRight, income: ArrowDownLeft, transfer: ArrowLeftRight,
  investment_contribution: ChartNoAxesCombined, investment_withdrawal: ChartNoAxesCombined, reimbursement_receipt: HandCoins,
};
export const palette = ["green", "blue", "amber", "violet", "rose"];

export function Modal({ title, subtitle, onClose, children, wide, locked }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" className={"modal " + (wide ? "modal-wide" : "")}
    onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
    <div className="modal-header">
      <div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose} disabled={locked}><X size={20} /></button>
    </div>
    {children}
  </dialog>;
}
export function Empty({ title, description, action, icon: Icon = CircleDollarSign }: {
  title: string; description: string; action?: ReactNode; icon?: LucideIcon;
}) {
  return <div className="empty"><span className="glyph"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Field({ label, children, error, full, hint }: { label: string; children: ReactNode; error?: string; full?: boolean; hint?: string }) {
  return <label className={"field" + (full ? " full" : "")}>
    <span>{label}</span>{children}{error ? <small className="field-error">{error}</small> : hint && <small>{hint}</small>}
  </label>;
}
export function ActivityRow({ row, workspace, onOpen }: { row: Activity; workspace: Workspace; onOpen: (row: Activity) => void }) {
  const Icon = kindIcons[row.kind];
  return <button type="button" className="activity-row" onClick={() => onOpen(row)} aria-label={"View " + row.title + ", " + activityLabel(row) + ", " + activityMoney(row)}>
    <span className="glyph" aria-hidden="true"><Icon size={17} /></span>
    <span className="activity-text"><strong>{row.title}</strong><small>{row.category} <span aria-hidden="true">·</span> {accountName(workspace, row.accountId)}</small></span>
    <span className="activity-meta"><strong className={row.amount > 0 && row.kind !== "transfer" ? "positive" : ""}>{activityMoney(row)}</strong><small>{dayLabel(row.date)}</small></span>
    <ChevronRight className="activity-chevron" size={15} aria-hidden="true"/>
  </button>;
}
export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none">
    <path d="M14.5 13.5h16a4 4 0 0 1 4 4v17h-17a4 4 0 0 1-4-4v-16a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/>
    <path d="M19.5 14v20m4.5-13h6m-6 5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
  </svg></span><strong>Ledger</strong></div>;
}
