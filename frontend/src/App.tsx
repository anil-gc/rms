import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  BellRing,
  ChefHat,
  CircleCheck,
  ClipboardList,
  Coffee,
  LayoutDashboard,
  LogOut,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Table2,
  Users,
  Wallet,
  WifiOff,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  money,
  nepaliDate,
  readStored,
  saveStored,
  setCsrf,
  when,
} from "./api";
import type {
  PaymentPayload,
  PendingPayment,
  Receipt,
  Sales,
  Session,
  State,
  Table,
  Ticket,
} from "./types";
import { Empty, Modal, Notice, TicketCard } from "./ui";
import OrderComposer from "./OrderComposer";
import Management from "./Management";

type Screen =
  | "overview"
  | "tables"
  | "orders"
  | "kitchen"
  | "receipts"
  | "settings";
const titles: Record<Screen, string> = {
  overview: "Today at a glance",
  tables: "Tables & orders",
  orders: "Order queue",
  kitchen: "Kitchen",
  receipts: "Receipt history",
  settings: "Restaurant setup",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState("");
  const loadSession = useCallback(async () => {
    try {
      const result = await api<Session>("auth/session/");
      setCsrf(result.csrf_token);
      setSession(result);
      setSessionError("");
    } catch (e) {
      setSessionError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  if (!session)
    return (
      <main className="loading-screen">
        <div className="brand-mark">
          <Coffee />
        </div>
        <h1>Restaurant desk</h1>
        {sessionError ? (
          <>
            <Notice error>{sessionError}</Notice>
            <button className="primary" onClick={() => void loadSession()}>
              Try again
            </button>
          </>
        ) : (
          <p>Opening your restaurant…</p>
        )}
      </main>
    );
  return session.user || session.device ? (
    <Workspace
      key={`${session.user?.id || "device"}-${session.device?.id || ""}`}
      session={session}
      reloadSession={loadSession}
    />
  ) : (
    <Login restaurant={session.restaurant_name} onLogin={loadSession} />
  );
}

function Login({
  restaurant,
  onLogin,
}: {
  restaurant: string;
  onLogin: () => Promise<void>;
}) {
  const [pairing, setPairing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        pairing ? "kitchen/pair/" : "auth/login/",
        "POST",
        pairing ? { code } : { username, password },
      );
      await onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Coffee />
          </span>
          <span>
            Restaurant desk
            <span className="brand-caption">
              A LITTLE SIMPLER. EVERY SERVICE.
            </span>
          </span>
        </div>
        <div>
          <span className="eyebrow">WELCOME TO YOUR RESTAURANT</span>
          <h1>
            Good food.
            <br />
            Smooth service.
          </h1>
          <p>
            From the first order to the final bill.
            <br />
            Keep your whole team on the same page.
          </p>
          <div className="flow-preview">
            <span>
              <Table2 /> Take order
            </span>
            <ArrowRight size={18} />
            <span>
              <ChefHat /> Prepare
            </span>
            <ArrowRight size={18} />
            <span>
              <ReceiptText /> Settle bill
            </span>
          </div>
        </div>
        <p className="login-footer">Made for your team. Ready for the rush.</p>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="eyebrow">{restaurant}</span>
          <h2>{pairing ? "Connect the kitchen" : "Welcome back"}</h2>
          <p className="muted">
            {pairing
              ? "Use the pairing code from the restaurant owner."
              : "Sign in to start your service."}
          </p>
          <form className="form-stack" onSubmit={(e) => void submit(e)}>
            {pairing ? (
              <label>
                Pairing code
                <input
                  autoFocus
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  maxLength={20}
                  placeholder="Enter your 10-character code"
                />
              </label>
            ) : (
              <>
                <label>
                  Username
                  <input
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    maxLength={150}
                    placeholder="Your username"
                  />
                </label>
                <label>
                  Password
                  <input
                    autoComplete="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Your password"
                  />
                </label>
              </>
            )}
            {error && <Notice error>{error}</Notice>}
            <button className="primary full" disabled={busy}>
              {busy
                ? "Connecting…"
                : pairing
                  ? "Connect kitchen screen"
                  : "Sign in"}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className="text-button full kitchen-link"
            onClick={() => {
              setPairing(!pairing);
              setError("");
            }}
          >
            {pairing ? <Users size={18} /> : <ChefHat size={18} />}{" "}
            {pairing ? "Back to team sign-in" : "Connect kitchen screen"}
          </button>
          <div className="login-help">
            <ShieldCheck size={17} />
            <p>
              {pairing
                ? "Kitchen devices can only view and update food tickets."
                : "Need an account or a new password? Ask the owner."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Workspace({
  session,
  reloadSession,
}: {
  session: Session;
  reloadSession: () => Promise<void>;
}) {
  const role = session.device ? "kitchen" : session.user!.role;
  const [screen, setScreen] = useState<Screen>(
    role === "owner" ? "overview" : role === "kitchen" ? "kitchen" : "tables",
  );
  const [data, setData] = useState<State | null>(null);
  const [kitchenTickets, setKitchenTickets] = useState<Ticket[]>([]);
  const [sales, setSales] = useState<Sales | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [reasonAction, setReasonAction] = useState<{
    ticket: Ticket;
    action: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    label: string;
    path: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [payTable, setPayTable] = useState<Table | null>(null);
  const paymentKey = `payment-pending-${session.user?.id}`;
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(
    () => readStored(paymentKey, null),
  );
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qr">(
    pendingPayment?.payload.method || "cash",
  );
  const [qrVerified, setQrVerified] = useState(false);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previousPending = useRef<Set<number>>(new Set());
  const fetching = useRef(false);
  const canBill = role === "owner" || role === "billing";
  const load = useCallback(async () => {
    if (fetching.current) return;
    if (!navigator.onLine) {
      setOffline(true);
      return;
    }
    fetching.current = true;
    try {
      if (role === "kitchen")
        setKitchenTickets(await api<Ticket[]>("kitchen/queue/"));
      else {
        setData(await api<State>("state/"));
        if (role === "owner") setSales(await api<Sales>("reports/daily/"));
      }
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await reloadSession();
      } else setOffline(true);
    } finally {
      fetching.current = false;
    }
  }, [role, reloadSession]);
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 3000);
    const online = () => void load();
    const offlineListener = () => setOffline(true);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineListener);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineListener);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  useEffect(() => {
    const pending =
      role === "kitchen"
        ? kitchenTickets.filter((t) => t.status === "approved")
        : (data?.tickets || []).filter((t) =>
            canBill ? t.status === "pending" : t.status === "ready",
          );
    if (
      sound &&
      pending.some((t) => !previousPending.current.has(t.id)) &&
      audio.current
    ) {
      const osc = audio.current.createOscillator();
      const gain = audio.current.createGain();
      osc.connect(gain);
      gain.connect(audio.current.destination);
      osc.frequency.value = 740;
      gain.gain.value = 0.07;
      osc.start();
      osc.stop(audio.current.currentTime + 0.22);
    }
    previousPending.current = new Set(pending.map((t) => t.id));
  }, [data, kitchenTickets, role, canBill, sound]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function enableSound() {
    if (sound) {
      setSound(false);
      return;
    }
    try {
      audio.current ||= new AudioContext();
      await audio.current.resume();
      setSound(true);
    } catch {
      setError(
        "Sound is unavailable on this device. Visual alerts will remain visible.",
      );
    }
  }
  function navigate(next: Screen) {
    setScreen(next);
    setSelectedTable(null);
    setOrdering(false);
    setError("");
    setMessage("");
  }
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, "POST", body);
      setReasonAction(null);
      setConfirmAction(null);
      setMessage("Saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 0) setOffline(true);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await api("auth/logout/", "POST", {});
      await reloadSession();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function completePayment(result: Receipt) {
    setPendingPayment(null);
    saveStored(paymentKey, null);
    setPayTable(null);
    setSelectedTable(null);
    setReceipt(result);
    setError("");
    await load();
  }
  async function pay() {
    if (!pendingPayment && !payTable?.visit) return;
    setBusy(true);
    setError("");
    const payload: PaymentPayload = pendingPayment?.payload || {
      request_id: crypto.randomUUID(),
      method: paymentMethod,
      expected_total: payTable!.total,
      qr_verified: qrVerified,
    };
    const operation: PendingPayment = pendingPayment || {
      visit: payTable!.visit!,
      tableName: payTable!.name,
      payload,
    };
    setPendingPayment(operation);
    saveStored(paymentKey, operation);
    try {
      if (pendingPayment) {
        try {
          await completePayment(
            await api<Receipt>(`payments/requests/${payload.request_id}/`),
          );
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
      await completePayment(
        await api<Receipt>(
          `visits/${operation.visit}/payment/`,
          "POST",
          payload,
        ),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setPendingPayment(null);
        saveStored(paymentKey, null);
        setPayTable(null);
        setError(e.message);
        await load();
      } else {
        try {
          await completePayment(
            await api<Receipt>(`payments/requests/${payload.request_id}/`),
          );
        } catch {
          setError(
            "Payment status is unconfirmed. Do not collect payment again. Reconnect and use “Check & retry payment”.",
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const pending = data?.tickets.filter((t) => t.status === "pending") || [];
  const ready = data?.tickets.filter((t) => t.status === "ready") || [];
  const activeTables = data?.tables.filter((t) => t.visit) || [];
  const table = data?.tables.find((t) => t.id === selectedTable);
  const tableTickets =
    data?.tickets.filter(
      (t) => t.table === selectedTable && t.visit === table?.visit,
    ) || [];
  function ticketActions(ticket: Ticket, kitchen = false) {
    return (
      <>
        {canBill && !kitchen && ticket.status === "pending" && (
          <>
            <button
              className="primary"
              disabled={busy || offline}
              onClick={() => void action(`orders/${ticket.id}/approve/`)}
            >
              Send to kitchen <ArrowRight size={16} />
            </button>
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() => {
                setReasonAction({ ticket, action: "reject" });
                setReason("");
                setError("");
              }}
            >
              Reject
            </button>
          </>
        )}
        {role === "staff" &&
          ticket.status === "pending" &&
          ticket.created_by === session.user?.id && (
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() =>
                setConfirmAction({
                  label: `Withdraw order #${ticket.id}? You can then submit a corrected order.`,
                  path: `orders/${ticket.id}/withdraw/`,
                })
              }
            >
              Withdraw order
            </button>
          )}
        {kitchen && ticket.status === "approved" && (
          <button
            className="primary full"
            disabled={busy || offline}
            onClick={() => void action(`kitchen/orders/${ticket.id}/prepare/`)}
          >
            Start preparing
          </button>
        )}
        {kitchen && ticket.status === "preparing" && (
          <button
            className="primary full"
            disabled={busy || offline}
            onClick={() => void action(`kitchen/orders/${ticket.id}/ready/`)}
          >
            Mark ready <CircleCheck size={17} />
          </button>
        )}
        {!kitchen && ticket.status === "ready" && (
          <button
            className="primary"
            disabled={busy || offline}
            onClick={() => void action(`orders/${ticket.id}/serve/`)}
          >
            Mark served <CircleCheck size={17} />
          </button>
        )}
        {role === "owner" &&
          ["approved", "preparing", "ready", "served"].includes(
            ticket.status,
          ) && (
            <button
              className="text-button danger"
              disabled={busy || offline}
              onClick={() => {
                setReasonAction({ ticket, action: "void" });
                setReason("");
                setError("");
              }}
            >
              Void order
            </button>
          )}
      </>
    );
  }
  const links: { id: Screen; label: string; icon: typeof Table2 }[] =
    role === "kitchen"
      ? [{ id: "kitchen", label: "Kitchen orders", icon: ChefHat }]
      : [
          ...(role === "owner"
            ? [
                {
                  id: "overview" as Screen,
                  label: "Overview",
                  icon: LayoutDashboard,
                },
              ]
            : []),
          {
            id: "tables",
            label: canBill ? "Tables & billing" : "Take an order",
            icon: Table2,
          },
          { id: "orders", label: "Order queue", icon: ClipboardList },
          ...(role === "owner"
            ? [{ id: "kitchen" as Screen, label: "Kitchen", icon: ChefHat }]
            : []),
          ...(canBill
            ? [
                {
                  id: "receipts" as Screen,
                  label: "Receipts",
                  icon: ReceiptText,
                },
              ]
            : []),
          ...(role === "owner"
            ? [
                {
                  id: "settings" as Screen,
                  label: "Menu & setup",
                  icon: Settings2,
                },
              ]
            : []),
        ];
  const kitchenList =
    role === "kitchen"
      ? kitchenTickets
      : (data?.tickets || []).filter((t) =>
          ["approved", "preparing", "ready", "voided"].includes(t.status),
        );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Coffee />
          </span>
          <div>
            Restaurant desk
            <span className="brand-caption">SERVICE, SIMPLIFIED</span>
          </div>
        </div>
        <div className="restaurant-label">
          <span className="eyebrow">YOUR RESTAURANT</span>
          <strong>{data?.restaurant.name || session.restaurant_name}</strong>
        </div>
        <nav aria-label="Main navigation">
          {links.map((link) => (
            <button
              key={link.id}
              className={screen === link.id ? "active" : ""}
              onClick={() => navigate(link.id)}
              aria-current={screen === link.id ? "page" : undefined}
            >
              <link.icon size={20} />
              <span>{link.label}</span>
              {link.id === "orders" && pending.length > 0 && canBill && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar">
            {(session.user?.name || "K").slice(0, 1).toUpperCase()}
          </div>
          <div className="user-name">
            <strong>{session.user?.name || session.device?.name}</strong>
            <span>
              {role === "billing"
                ? "Billing / Gmode"
                : role === "kitchen"
                  ? "Kitchen device"
                  : role === "owner"
                    ? "Owner"
                    : "Staff"}
            </span>
          </div>
          <button
            aria-label="Sign out"
            title="Sign out"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">RESTAURANT WORKSPACE</span>
            <h1>{titles[screen]}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection ${offline ? "disconnected" : ""}`}>
              {offline ? <WifiOff size={15} /> : <span className="live-dot" />}
              {offline ? "Disconnected" : "Live updates"}
            </span>
            <button
              className={`icon-button ${sound ? "sound-on" : ""}`}
              aria-label={
                sound
                  ? "Disable notification sound"
                  : "Enable notification sound"
              }
              onClick={() => void enableSound()}
            >
              {sound ? <BellRing size={20} /> : <Bell size={20} />}
            </button>
            <span className="date-label">
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Kathmandu",
                day: "numeric",
                month: "short",
                year: "numeric",
              }).format(new Date())}
              <small>Nepal time</small>
            </span>
          </div>
        </header>
        <main className="content">
          {offline && (
            <div className="notice error">
              <WifiOff size={20} />
              <span>
                Connection lost. Displayed orders may be out of date. Keep
                drafts open and reconnect before continuing.
              </span>
              <button className="secondary" onClick={() => void load()}>
                <RefreshCw size={16} /> Retry
              </button>
            </div>
          )}
          {error &&
            !reasonAction &&
            !payTable &&
            !pendingPayment &&
            !confirmAction && <Notice error>{error}</Notice>}
          {message && (
            <div className="dismissible">
              <Notice>{message}</Notice>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {canBill && pending.length > 0 && screen !== "orders" && (
            <button
              className="incoming-banner"
              onClick={() => navigate("orders")}
            >
              <span className="incoming-icon">
                <BellRing size={20} />
              </span>
              <span>
                <strong>
                  {pending.length}{" "}
                  {pending.length === 1 ? "order needs" : "orders need"} your
                  approval
                </strong>
                <small>Check the items and send them to the kitchen.</small>
              </span>
              <ArrowRight size={20} />
            </button>
          )}
          {role === "staff" && ready.length > 0 && screen !== "orders" && (
            <button
              className="incoming-banner ready-banner"
              onClick={() => navigate("orders")}
            >
              <ChefHat />
              <span>
                <strong>
                  {ready.length}{" "}
                  {ready.length === 1 ? "order is" : "orders are"} ready to
                  serve
                </strong>
                <small>Collect from the kitchen and mark served.</small>
              </span>
              <ArrowRight />
            </button>
          )}
          {role !== "kitchen" && !data ? (
            <Empty
              title={offline ? "Cannot load restaurant" : "Loading restaurant…"}
            >
              Your saved orders are kept on the server.
            </Empty>
          ) : (
            <>
              {screen === "overview" && data && (
                <>
                  <div className="welcome">
                    <div>
                      <span className="eyebrow">YOUR DAILY SERVICE</span>
                      <h2>A good day starts here.</h2>
                      <p>
                        Keep an eye on the floor, the kitchen and today's sales.
                      </p>
                    </div>
                    <button
                      className="primary"
                      onClick={() => navigate("tables")}
                    >
                      <Plus size={18} /> Take an order
                    </button>
                  </div>
                  <div className="stats-grid">
                    <Stat
                      label="Today's sales"
                      value={money(sales?.total || "0")}
                      detail={`${sales?.count || 0} paid receipts`}
                      icon={Wallet}
                      accent
                    />
                    <Stat
                      label="Active tables"
                      value={`${activeTables.length} / ${data.tables.length}`}
                      detail="Tables currently in service"
                      icon={Table2}
                    />
                    <Stat
                      label="Awaiting approval"
                      value={String(pending.length)}
                      detail="Orders to send to the kitchen"
                      icon={ClipboardList}
                    />
                    <Stat
                      label="Ready to serve"
                      value={String(ready.length)}
                      detail="Fresh from the kitchen"
                      icon={ChefHat}
                    />
                  </div>
                  <div className="overview-grid">
                    <section>
                      <div className="section-heading compact">
                        <h3>On the floor</h3>
                        <button
                          className="text-button"
                          onClick={() => navigate("tables")}
                        >
                          View all tables <ArrowRight size={16} />
                        </button>
                      </div>
                      <TableGrid
                        tables={data.tables}
                        tickets={data.tickets}
                        onSelect={(t) => {
                          setScreen("tables");
                          setSelectedTable(t.id);
                          setOrdering(false);
                        }}
                      />
                    </section>
                    <section className="panel payment-summary">
                      <span className="eyebrow">TODAY'S COLLECTIONS</span>
                      <h3>Payments, at a glance</h3>
                      <div className="collection">
                        <span>Cash</span>
                        <strong>{money(sales?.cash || "0")}</strong>
                      </div>
                      <div className="collection">
                        <span>QR payments</span>
                        <strong>{money(sales?.qr || "0")}</strong>
                      </div>
                      <div className="summary-total">
                        <span>Total collected</span>
                        <strong>{money(sales?.total || "0")}</strong>
                      </div>
                      <p className="small muted">
                        Only completed payments are included. Unpaid table bills
                        remain on the floor.
                      </p>
                      <button
                        className="secondary full"
                        onClick={() => navigate("receipts")}
                      >
                        View receipts <ArrowRight size={16} />
                      </button>
                    </section>
                  </div>
                </>
              )}
              {screen === "tables" && data && (
                <>
                  {selectedTable && table ? (
                    ordering ? (
                      <OrderComposer
                        key={table.id}
                        state={data}
                        user={session.user!}
                        table={table}
                        onBack={() => {
                          setOrdering(false);
                          setSelectedTable(null);
                        }}
                        onSaved={() => void load()}
                      />
                    ) : (
                      <>
                        <div className="section-heading">
                          <div>
                            <button
                              className="text-button back"
                              onClick={() => setSelectedTable(null)}
                            >
                              ← All tables
                            </button>
                            <h2>{table.name}</h2>
                            <p>
                              {table.visit
                                ? "One table. All rounds together."
                                : "This table is ready for guests."}
                            </p>
                          </div>
                          <button
                            className="primary"
                            onClick={() => setOrdering(true)}
                          >
                            <Plus size={18} /> Add order
                          </button>
                        </div>
                        <div className="table-detail-layout">
                          <section className="ticket-grid">
                            {tableTickets.map((t) => (
                              <TicketCard
                                key={t.id}
                                ticket={t}
                                actions={ticketActions(t)}
                              />
                            ))}
                            {!tableTickets.length && (
                              <Empty title="No orders yet">
                                Add the first order for this table.
                              </Empty>
                            )}
                          </section>
                          <aside className="panel bill-summary">
                            <span className="eyebrow">TABLE BILL</span>
                            <h3>{table.name}</h3>
                            <p>
                              {
                                tableTickets.filter(
                                  (t) =>
                                    ![
                                      "rejected",
                                      "withdrawn",
                                      "voided",
                                    ].includes(t.status),
                                ).length
                              }{" "}
                              order rounds
                            </p>
                            <div className="cart-total">
                              <span>Total</span>
                              <strong>{money(table.total)}</strong>
                            </div>
                            {canBill && (
                              <>
                                <button
                                  className="primary full"
                                  disabled={!table.can_pay || offline || busy}
                                  onClick={() => {
                                    setPayTable({ ...table });
                                    setPaymentMethod("cash");
                                    setQrVerified(false);
                                    setError("");
                                  }}
                                >
                                  Collect payment <Wallet size={18} />
                                </button>
                                {table.can_close_empty && (
                                  <button
                                    className="secondary full"
                                    disabled={offline || busy}
                                    onClick={() =>
                                      setConfirmAction({
                                        label:
                                          "Close this empty bill and make the table available?",
                                        path: `visits/${table.visit}/close-empty/`,
                                      })
                                    }
                                  >
                                    Make table available
                                  </button>
                                )}
                                {!table.can_pay &&
                                  !table.can_close_empty &&
                                  table.visit && (
                                    <p className="small muted">
                                      Approve and serve every order before
                                      collecting payment.
                                    </p>
                                  )}
                              </>
                            )}
                            <p className="small muted">
                              Rejected, withdrawn and cancelled orders are
                              excluded.
                            </p>
                          </aside>
                        </div>
                      </>
                    )
                  ) : (
                    <>
                      <div className="section-heading">
                        <div>
                          <span className="eyebrow">THE RESTAURANT FLOOR</span>
                          <h2>
                            {role === "staff"
                              ? "Choose a table"
                              : "Every table, in view"}
                          </h2>
                          <p>
                            {role === "staff"
                              ? "Check the table number before taking the order."
                              : "Open a table to view orders or collect payment."}
                          </p>
                        </div>
                        <div className="legend">
                          <span>
                            <i className="available-dot" /> Available
                          </span>
                          <span>
                            <i className="occupied-dot" /> In service
                          </span>
                        </div>
                      </div>
                      <TableGrid
                        tables={data.tables}
                        tickets={data.tickets}
                        onSelect={(t) => {
                          setSelectedTable(t.id);
                          setOrdering(role === "staff");
                        }}
                      />
                      {!data.tables.length && (
                        <Empty title="Your floor is ready to set up">
                          {role === "owner"
                            ? "Open Menu & setup to add tables and your menu."
                            : "Ask the owner to add the restaurant tables."}
                        </Empty>
                      )}
                    </>
                  )}
                </>
              )}
              {screen === "orders" && data && (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">KEEP SERVICE MOVING</span>
                      <h2>
                        {canBill
                          ? "Check, approve, send."
                          : "Your orders, together."}
                      </h2>
                      <p>
                        {canBill
                          ? "Orders reach the kitchen only after your approval."
                          : "Watch order progress and collect food when it is ready."}
                      </p>
                    </div>
                    <span className="pill">{data.tickets.length} {data.tickets.length === 1 ? 'order' : 'orders'}</span>
                  </div>
                  <OrderQueue
                    tickets={data.tickets}
                    actions={ticketActions}
                    defaultFilter={canBill ? "pending" : "all"}
                  />
                </>
              )}
              {screen === "kitchen" && (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">KITCHEN DISPLAY</span>
                      <h2>Let’s get cooking.</h2>
                      <p>
                        Oldest orders first. Read cooking notes before starting.
                      </p>
                    </div>
                    <span className="pill">
                      {
                        kitchenList.filter(
                          (t) =>
                            t.status === "approved" || t.status === "preparing",
                        ).length
                      }{" "}
                      to prepare
                    </span>
                  </div>
                  <div className="kitchen-columns">
                    {(
                      ["approved", "preparing", "ready", "voided"] as const
                    ).map((status) => (
                      <section
                        className={`kitchen-column ${status}`}
                        key={status}
                      >
                        <div className="column-heading">
                          <h3>
                            {
                              {
                                approved: "New orders",
                                preparing: "Preparing",
                                ready: "Ready to serve",
                                voided: "Cancelled — do not prepare",
                              }[status]
                            }
                          </h3>
                          <span className="count">
                            {
                              kitchenList.filter((t) => t.status === status)
                                .length
                            }
                          </span>
                        </div>
                        {kitchenList
                          .filter((t) => t.status === status)
                          .map((t) => (
                            <TicketCard
                              key={t.id}
                              ticket={t}
                              kitchen
                              actions={ticketActions(t, true)}
                            />
                          ))}
                        {!kitchenList.some((t) => t.status === status) && (
                          <p className="column-empty">
                            No{" "}
                            {status === "approved"
                              ? "new orders"
                              : status === "voided"
                                ? "cancellations"
                                : "orders here"}
                            .
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                </>
              )}
              {screen === "receipts" && canBill && (
                <ReceiptHistory
                  onReceipt={setReceipt}
                  owner={role === "owner"}
                />
              )}
              {screen === "settings" && role === "owner" && (
                <Management
                  onChange={() => {
                    void load();
                    void reloadSession();
                  }}
                />
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Restaurant desk</span>
          <span>
            NPR · Nepal time ·{" "}
            {role === "kitchen"
              ? "Kitchen access only"
              : "Simple service, from table to bill"}
          </span>
        </footer>
      </div>
      {reasonAction && (
        <Modal
          title={
            reasonAction.action === "void"
              ? `Cancel order #${reasonAction.ticket.id}?`
              : `Reject order #${reasonAction.ticket.id}?`
          }
          onClose={() => {
            if (!busy) setReasonAction(null);
          }}
        >
          <p>
            {reasonAction.action === "void"
              ? "The kitchen will see a cancellation notice. Tell the cook directly if preparation has already started."
              : "Staff will see this reason and can submit a corrected order."}
          </p>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                `orders/${reasonAction.ticket.id}/${reasonAction.action}/`,
                { reason },
              );
            }}
          >
            <label>
              Reason
              <textarea
                autoFocus
                required
                maxLength={250}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && <Notice error>{error}</Notice>}
            <button
              className="primary danger"
              disabled={busy || !reason.trim()}
            >
              {busy
                ? "Saving…"
                : reasonAction.action === "void"
                  ? "Cancel order"
                  : "Reject order"}
            </button>
          </form>
        </Modal>
      )}
      {confirmAction && (
        <Modal
          title="Please confirm"
          onClose={() => {
            if (!busy) setConfirmAction(null);
          }}
        >
          <p>{confirmAction.label}</p>
          {error && <Notice error>{error}</Notice>}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void action(confirmAction.path)}
          >
            {busy ? "Saving…" : "Confirm"}
          </button>
        </Modal>
      )}
      {(payTable || pendingPayment) && (
        <Modal
          title={`Payment · ${pendingPayment?.tableName || payTable?.name}`}
          onClose={() => {
            if (!busy && !pendingPayment) setPayTable(null);
          }}
        >
          <div className="payment-amount">
            <span>TOTAL TO COLLECT</span>
            <strong>
              {money(pendingPayment?.payload.expected_total || payTable!.total)}
            </strong>
          </div>
          {pendingPayment ? (
            <Notice>
              Keep this screen open until the payment status is confirmed. Do
              not collect the money again.
            </Notice>
          ) : (
            <>
              <div className="payment-methods">
                <button
                  className={paymentMethod === "cash" ? "selected" : ""}
                  onClick={() => setPaymentMethod("cash")}
                >
                  <Wallet />
                  Cash
                </button>
                <button
                  className={paymentMethod === "qr" ? "selected" : ""}
                  onClick={() => setPaymentMethod("qr")}
                >
                  <ReceiptText />
                  QR payment
                </button>
              </div>
              {paymentMethod === "qr" && (
                <label className="checkbox qr-check">
                  <input
                    type="checkbox"
                    checked={qrVerified}
                    onChange={(e) => setQrVerified(e.target.checked)}
                  />{" "}
                  I checked the restaurant’s payment account and received the
                  full amount.
                </label>
              )}
              <p className="small muted">
                Confirm only after receiving payment. This will close the bill
                and make the table available.
              </p>
            </>
          )}
          {error && <Notice error>{error}</Notice>}
          <button
            className="primary full"
            disabled={
              busy || (!pendingPayment && paymentMethod === "qr" && !qrVerified)
            }
            onClick={() => void pay()}
          >
            {busy
              ? "Checking payment…"
              : pendingPayment
                ? "Check & retry payment"
                : `Confirm ${paymentMethod === "cash" ? "cash" : "QR"} received`}
          </button>
        </Modal>
      )}
      {receipt && (
        <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Wallet;
  accent?: boolean;
}) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <div className="row">
        <span>{label}</span>
        <Icon size={20} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function TableGrid({
  tables,
  tickets,
  onSelect,
}: {
  tables: Table[];
  tickets: Ticket[];
  onSelect: (table: Table) => void;
}) {
  return (
    <div className="table-grid">
      {tables.map((table) => {
        const own = tickets.filter((t) => t.table === table.id);
        const ready = own.some((t) => t.status === "ready");
        const pending = own.some((t) => t.status === "pending");
        const label = !table.visit
          ? "Available"
          : ready
            ? "Food is ready"
            : pending
              ? "Needs approval"
              : table.can_pay
                ? "Bill due"
                : table.can_close_empty
                  ? "Empty bill"
                  : "In service";
        return (
          <button
            key={table.id}
            className={`table-card ${table.visit ? "occupied" : "available"} ${ready ? "food-ready" : ""}`}
            onClick={() => onSelect(table)}
          >
            <div className="row">
              <Table2 size={27} />
              <span className={`table-state ${ready ? "ready" : ""}`}>
                {label}
              </span>
            </div>
            <h3>{table.name}</h3>
            <div className="row table-bottom">
              <span>
                <Users size={14} />
                {table.seats} seats
              </span>
              {table.visit ? (
                <strong>{money(table.total)}</strong>
              ) : (
                <span>
                  Start order <Plus size={14} />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
function OrderQueue({
  tickets,
  actions,
  defaultFilter,
}: {
  tickets: Ticket[];
  actions: (t: Ticket) => React.ReactNode;
  defaultFilter: string;
}) {
  const [filter, setFilter] = useState(defaultFilter);
  const visible = tickets.filter(
    (t) =>
      filter === "all" ||
      (filter === "kitchen"
        ? ["approved", "preparing"].includes(t.status)
        : filter === "completed"
          ? ["served", "rejected", "withdrawn", "voided"].includes(t.status)
          : t.status === filter),
  );
  return (
    <>
      <div className="section-tabs">
        {[
          ["all", "All orders"],
          ["pending", "Awaiting approval"],
          ["kitchen", "In kitchen"],
          ["ready", "Ready to serve"],
          ["completed", "Finished"],
        ].map(([id, label]) => (
          <button
            className={filter === id ? "active" : ""}
            key={id}
            onClick={() => setFilter(id)}
          >
            {label}
            {id === "pending" &&
              tickets.filter((t) => t.status === "pending").length > 0 && (
                <span className="count">
                  {tickets.filter((t) => t.status === "pending").length}
                </span>
              )}
          </button>
        ))}
      </div>
      <div className="ticket-grid">
        {visible.map((t) => (
          <TicketCard key={t.id} ticket={t} actions={actions(t)} />
        ))}
      </div>
      {!visible.length && (
        <Empty title="All clear here">
          Orders will appear here as your team works.
        </Empty>
      )}
    </>
  );
}
function ReceiptModal({
  receipt,
  onClose,
}: {
  receipt: Receipt;
  onClose: () => void;
}) {
  return (
    <Modal title="Payment recorded" onClose={onClose}>
      <div className="receipt" id="print-receipt">
        <h2>{receipt.restaurant.name}</h2>
        {receipt.restaurant.address && <p>{receipt.restaurant.address}</p>}
        {receipt.restaurant.phone && <p>{receipt.restaurant.phone}</p>}
        <p className="receipt-type">RECEIPT</p>
        <div className="receipt-meta">
          <span>{receipt.number}</span>
          <span>{when(receipt.created_at, true)}</span>
          <span>
            {receipt.table} · {receipt.cashier}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, i) => (
              <tr key={i}>
                <td>{item.name}</td>
                <td>{item.quantity}</td>
                <td>{Number(item.price).toFixed(2)}</td>
                <td>{Number(item.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-total">
          <strong>Total</strong>
          <strong>{money(receipt.total)}</strong>
        </div>
        <p>Paid by {receipt.method === "cash" ? "Cash" : "QR"} · NPR</p>
        <p className="receipt-footer">{receipt.restaurant.footer}</p>
        <p className="small">Simple receipt · Not a tax invoice</p>
      </div>
      <button className="primary full no-print" onClick={() => window.print()}>
        <Printer size={18} /> Print receipt
      </button>
      <button className="text-button full no-print" onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}
function ReceiptHistory({
  onReceipt,
  owner,
}: {
  onReceipt: (r: Receipt) => void;
  owner: boolean;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [date, setDate] = useState(nepaliDate());
  const [sales, setSales] = useState<Sales | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Receipt[]>("receipts/")
      .then(setReceipts)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (owner && date)
      void api<Sales>(`reports/daily/?date=${date}`)
        .then(setSales)
        .catch((e) => setError(e.message));
  }, [date, owner]);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">PAYMENTS COMPLETED</span>
          <h2>Receipts & collections</h2>
          <p>Open a receipt to check details or print it again.</p>
        </div>
        {owner && (
          <label>
            Sales date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      {owner && sales && (
        <div className="stats-grid receipts-stats">
          <Stat
            label="Collected"
            value={money(sales.total)}
            detail={sales.date}
            icon={Wallet}
            accent
          />
          <Stat
            label="Cash"
            value={money(sales.cash)}
            detail={`${sales.count} receipts in total`}
            icon={Wallet}
          />
          <Stat
            label="QR payments"
            value={money(sales.qr)}
            detail="Manually verified"
            icon={ReceiptText}
          />
        </div>
      )}
      <div className="panel">
        <h3>Latest 100 receipts</h3>
        <div className="receipt-list">
          {receipts.map((r) => (
            <button
              key={r.id}
              className="setting-row"
              onClick={() => onReceipt(r)}
            >
              <span className="receipt-icon">
                <ReceiptText />
              </span>
              <span className="grow">
                <strong>{r.number}</strong>
                <small>
                  {r.table} · {when(r.created_at, true)}
                </small>
              </span>
              <span className="receipt-list-amount">
                <strong>{money(r.total)}</strong>
                <small>{r.method === "cash" ? "Cash" : "QR"}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
        {!receipts.length && (
          <Empty title="No receipts yet">Completed payments appear here.</Empty>
        )}
      </div>
    </>
  );
}
