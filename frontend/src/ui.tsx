import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X, UtensilsCrossed, Check } from "lucide-react";
import type { Status, Ticket } from "./types";
import { money, when } from "./api";

export const statusLabels: Record<Status, string> = {
  pending: "Waiting for approval",
  approved: "Sent to kitchen",
  preparing: "Preparing",
  ready: "Ready to serve",
  served: "Served",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  voided: "Cancelled by owner",
};
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{statusLabels[status]}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <UtensilsCrossed size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`notice ${error ? "error" : ""}`}
    >
      {!error && <Check size={18} />}
      <span>{children}</span>
    </div>
  );
}
export function TicketCard({
  ticket,
  actions,
  kitchen = false,
}: {
  ticket: Ticket;
  actions?: ReactNode;
  kitchen?: boolean;
}) {
  return (
    <article className={`ticket ticket-${ticket.status}`}>
      <header>
        <div>
          <span className="eyebrow">
            ORDER #{String(ticket.id).padStart(3, "0")}
          </span>
          <h3>{ticket.table_name}</h3>
        </div>
        <StatusBadge status={ticket.status} />
      </header>
      <div className="ticket-meta">
        <span>{when(ticket.created_at)}</span>
        {ticket.staff_name && <span>By {ticket.staff_name}</span>}
      </div>
      <ul className="ticket-items">
        {ticket.items.map((item) => (
          <li key={item.id}>
            <span className="quantity">{item.quantity}×</span>
            <div>
              <strong>{item.name}</strong>
              {item.note && <p className="cooking-note">{item.note}</p>}
            </div>
            {!kitchen && item.total && (
              <span className="item-price">{money(item.total)}</span>
            )}
          </li>
        ))}
      </ul>
      {ticket.reason && (
        <p className="reason">
          <strong>
            {ticket.status === "voided" ? "Do not prepare" : "Reason"}:
          </strong>{" "}
          {ticket.reason}
        </p>
      )}
      {actions && <footer className="ticket-actions">{actions}</footer>}
    </article>
  );
}
