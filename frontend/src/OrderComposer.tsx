import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Minus,
  Plus,
  Search,
  ShoppingBag,
} from "lucide-react";
import { api, ApiError, money, readStored, saveStored } from "./api";
import type {
  DraftItem,
  OrderPayload,
  State,
  Table,
  Ticket,
  User,
} from "./types";
import { Empty, Modal, Notice } from "./ui";

interface Draft {
  table: number | null;
  version: number;
  items: DraftItem[];
  pending: OrderPayload | null;
}
export default function OrderComposer({
  state,
  user,
  table,
  onBack,
  onSaved,
}: {
  state: State;
  user: User;
  table: Table;
  onBack: () => void;
  onSaved: () => void;
}) {
  const key = `order-draft-${user.id}-${table.id}`;
  const [draft, setDraft] = useState<Draft>(() =>
    readStored(key, {
      table: table.id,
      version: table.version,
      items: [],
      pending: null,
    }),
  );
  const [category, setCategory] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [review, setReview] = useState(Boolean(draft.pending));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    saveStored(key, draft);
  }, [key, draft]);
  const total =
    draft.items.reduce(
      (sum, item) =>
        sum + Math.round(Number(item.expected_price) * 100) * item.quantity,
      0,
    ) / 100;
  const changed =
    draft.version !== table.version ||
    draft.items.some((i) => {
      const product = state.menu.find((p) => p.id === i.menu_item);
      return !product?.available || product.price !== i.expected_price;
    });
  function updateItems(items: DraftItem[]) {
    if (!draft.pending) {
      setDraft({ ...draft, items });
      setSuccess("");
      setError("");
    }
  }
  function add(id: number) {
    const product = state.menu.find((item) => item.id === id)!;
    const existing = draft.items.find((item) => item.menu_item === id);
    if (existing)
      updateItems(
        draft.items.map((item) =>
          item.menu_item === id
            ? { ...item, quantity: Math.min(99, item.quantity + 1) }
            : item,
        ),
      );
    else
      updateItems([
        ...draft.items,
        {
          menu_item: id,
          name: product.name,
          expected_price: product.price,
          quantity: 1,
          note: "",
        },
      ]);
  }
  async function accepted(ticket: Ticket) {
    setDraft({
      table: table.id,
      version: table.version,
      items: [],
      pending: null,
    });
    saveStored(key, null);
    setReview(false);
    setError("");
    setSuccess(
      `Order #${String(ticket.id).padStart(3, "0")} sent to billing for approval.`,
    );
    onSaved();
  }
  async function submit() {
    setBusy(true);
    setError("");
    const payload: OrderPayload = draft.pending || {
      request_id: crypto.randomUUID(),
      table: table.id,
      table_version: draft.version,
      items: draft.items,
    };
    const next = { ...draft, pending: payload };
    setDraft(next);
    saveStored(key, next);
    try {
      if (draft.pending) {
        try {
          await accepted(
            await api<Ticket>(`orders/requests/${payload.request_id}/`),
          );
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
      await accepted(await api<Ticket>("orders/", "POST", payload));
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setDraft({ ...draft, pending: null });
        setError(e.message);
      } else {
        try {
          await accepted(
            await api<Ticket>(`orders/requests/${payload.request_id}/`),
          );
        } catch {
          setError(
            "Order status is not confirmed. Keep this screen open. Reconnect, then use “Check & retry” — it will not send a duplicate.",
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }
  function reviewChanges() {
    setDraft({
      ...draft,
      version: table.version,
      items: draft.items.flatMap((item) => {
        const product = state.menu.find(
          (p) => p.id === item.menu_item && p.available,
        );
        return product
          ? [{ ...item, expected_price: product.price, name: product.name }]
          : [];
      }),
    });
    setError("");
    onSaved();
  }
  const products = state.menu.filter(
    (p) =>
      p.available &&
      (!category || p.category === category) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      {draft.items.length > 0 && (
        <div className="mobile-order-bar">
          <button
            className="secondary"
            onClick={() =>
              document
                .querySelector(".cart")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            View items · {draft.items.reduce((n, i) => n + i.quantity, 0)}
          </button>
          <button
            className="primary"
            disabled={changed && !draft.pending}
            onClick={() => setReview(true)}
          >
            Review · {money(total)}
          </button>
        </div>
      )}
      <div className="section-heading">
        <div>
          <button className="text-button back" onClick={onBack}>
            <ArrowLeft size={17} /> All tables
          </button>
          <h2>Order for {table.name}</h2>
          <p>Add items, then check the table before sending.</p>
        </div>
        <span className="pill">{table.seats} seats</span>
      </div>
      {success && <Notice>{success}</Notice>}
      {changed && !draft.pending && (
        <div className="notice error">
          <span>
            This table or menu changed. Check the current details before
            continuing.
          </span>
          <button className="secondary" onClick={reviewChanges}>
            Review latest details
          </button>
        </div>
      )}
      <div className="ordering-layout">
        <section className="menu-panel">
          <label className="search">
            <Search size={19} />
            <input
              aria-label="Search menu"
              placeholder="Find a menu item…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="category-tabs">
            <button
              className={!category ? "active" : ""}
              onClick={() => setCategory(null)}
            >
              All items
            </button>
            {state.categories.map((c) => (
              <button
                key={c.id}
                className={category === c.id ? "active" : ""}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="menu-grid">
            {products.map((product) => (
              <button
                className="menu-item"
                key={product.id}
                onClick={() => add(product.id)}
                disabled={Boolean(draft.pending)}
              >
                <span className="menu-category">
                  {
                    state.categories.find((c) => c.id === product.category)
                      ?.name
                  }
                </span>
                <strong>{product.name}</strong>
                <span className="menu-bottom">
                  <span>{money(product.price)}</span>
                  <span className="add-icon">
                    <Plus size={18} />
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!products.length && (
            <Empty title="No menu items here">
              Try another category or ask the owner to add menu items.
            </Empty>
          )}
        </section>
        <section className="cart">
          <div className="cart-heading">
            <ShoppingBag size={21} />
            <h3>Current order</h3>
            <span className="count">
              {draft.items.reduce((n, i) => n + i.quantity, 0)}
            </span>
          </div>
          <p className="cart-table">
            {table.name} <span>New round</span>
          </p>
          {draft.items.length ? (
            <div className="cart-items">
              {draft.items.map((item) => (
                <div className="cart-item" key={item.menu_item}>
                  <div className="row">
                    <strong>{item.name}</strong>
                    <span>
                      {money(Number(item.expected_price) * item.quantity)}
                    </span>
                  </div>
                  <div className="quantity-control">
                    <button
                      aria-label={`Remove one ${item.name}`}
                      disabled={Boolean(draft.pending)}
                      onClick={() =>
                        updateItems(
                          draft.items
                            .map((i) =>
                              i.menu_item === item.menu_item
                                ? { ...i, quantity: i.quantity - 1 }
                                : i,
                            )
                            .filter((i) => i.quantity > 0),
                        )
                      }
                    >
                      <Minus size={16} />
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      aria-label={`Add one ${item.name}`}
                      disabled={Boolean(draft.pending) || item.quantity >= 99}
                      onClick={() => add(item.menu_item)}
                    >
                      <Plus size={16} />
                    </button>
                    <span className="unit-price">
                      {money(item.expected_price)} each
                    </span>
                  </div>
                  <input
                    className="note-input"
                    aria-label={`Cooking note for ${item.name}`}
                    maxLength={250}
                    placeholder="Cooking note (optional)"
                    value={item.note}
                    disabled={Boolean(draft.pending)}
                    onChange={(e) =>
                      updateItems(
                        draft.items.map((i) =>
                          i.menu_item === item.menu_item
                            ? { ...i, note: e.target.value }
                            : i,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Your order is empty">
              Tap a menu item to add it.
            </Empty>
          )}
          <div className="cart-total">
            <span>Order total</span>
            <strong>{money(total)}</strong>
          </div>
          <button
            className="primary full"
            disabled={!draft.items.length || (changed && !draft.pending)}
            onClick={() => setReview(true)}
          >
            {draft.pending ? "Check pending submission" : "Review order"}
            <Check size={18} />
          </button>
          <p className="small muted centered">
            Sent to billing before the kitchen
          </p>
        </section>
      </div>
      {review && (
        <Modal
          title={`Confirm ${table.name}`}
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <div className="confirm-table">
            <span>TABLE NUMBER</span>
            <strong>{table.name}</strong>
          </div>
          <ul className="review-items">
            {draft.items.map((i) => (
              <li key={i.menu_item}>
                <div>
                  <strong>
                    {i.quantity} × {i.name}
                  </strong>
                  {i.note && <p>{i.note}</p>}
                </div>
                <span>{money(Number(i.expected_price) * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="cart-total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          {error && <Notice error>{error}</Notice>}
          <button
            className="primary full"
            disabled={busy || (changed && !draft.pending)}
            onClick={() => void submit()}
          >
            {busy
              ? "Checking order…"
              : draft.pending
                ? "Check & retry"
                : "Confirm & send to billing"}
          </button>
          {!draft.pending && (
            <button
              className="text-button full"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Back to editing
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
