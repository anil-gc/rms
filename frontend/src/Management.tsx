import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Pencil, ShieldCheck, Tablet, Ban } from "lucide-react";
import { api, money, when } from "./api";
import type { Management as ManagementData } from "./types";
import { Empty, Modal, Notice } from "./ui";

type Section = "menu" | "tables" | "users" | "devices" | "settings" | "audit";
type FormValues = Record<string, string | number | boolean>;
interface Editor {
  resource: string;
  id?: number;
  title: string;
  values: FormValues;
}
export default function Management({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<ManagementData | null>(null);
  const [section, setSection] = useState<Section>("menu");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [revoke, setRevoke] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<ManagementData>("management/"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const edit = (
    resource: string,
    title: string,
    values: FormValues,
    id?: number,
  ) => {
    setError("");
    setEditor({ resource, title, values, id });
  };
  function change(key: string, value: string | number | boolean) {
    if (editor)
      setEditor({ ...editor, values: { ...editor.values, [key]: value } });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setError("");
    try {
      const values = { ...editor.values };
      if (!values.password) delete values.password;
      const result = await api<{ code?: string }>(
        `management/${editor.resource}/${editor.id ? `${editor.id}/` : ""}`,
        editor.id ? "PATCH" : "POST",
        values,
      );
      if (result.code) setPairCode(result.code);
      setEditor(null);
      setMessage("Changes saved.");
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revokeDevice() {
    setBusy(true);
    setError("");
    try {
      await api(`management/devices/${revoke}/revoke/`, "POST", {});
      setRevoke(null);
      setMessage("Kitchen device disconnected.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (
    name: string,
    label: string,
    options: {
      type?: string;
      required?: boolean;
      maxLength?: number;
      min?: number;
      max?: number;
      step?: string;
    } = {},
  ) => (
    <label>
      {label}
      <input
        name={name}
        value={String(editor?.values[name] ?? "")}
        onChange={(e) => change(name, e.target.value)}
        {...options}
      />
    </label>
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">OWNER CONTROLS</span>
          <h2>Restaurant setup</h2>
          <p>A few simple settings to keep service running.</p>
        </div>
        <ShieldCheck size={30} />
      </div>
      <div className="section-tabs">
        {(
          [
            "menu",
            "tables",
            "users",
            "devices",
            "settings",
            "audit",
          ] as Section[]
        ).map((tab) => (
          <button
            key={tab}
            className={section === tab ? "active" : ""}
            onClick={() => {
              setSection(tab);
              setMessage("");
              setError("");
            }}
          >
            {
              {
                menu: "Menu",
                tables: "Tables",
                users: "People",
                devices: "Kitchen devices",
                settings: "Restaurant",
                audit: "Activity",
              }[tab]
            }
          </button>
        ))}
      </div>
      {error && !editor && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {!data ? (
        <p>Loading settings…</p>
      ) : (
        <>
          {section === "menu" && (
            <>
              <div className="toolbar">
                <p>{data.menu.length} menu items</p>
                <div className="button-group">
                  <button
                    className="secondary"
                    onClick={() =>
                      edit("categories", "Add category", { name: "" })
                    }
                  >
                    Add category
                  </button>
                  <button
                    className="primary"
                    disabled={!data.categories.length}
                    onClick={() =>
                      edit("menu", "Add menu item", {
                        name: "",
                        category: data.categories[0].id,
                        price: "",
                        available: true,
                      })
                    }
                  >
                    <Plus size={18} /> Add item
                  </button>
                </div>
              </div>
              {data.categories.length === 0 && (
                <Empty title="Start with a category">
                  Add categories such as Momo, Meals and Drinks, then add your
                  own items and prices.
                </Empty>
              )}
              {data.categories.map((category) => (
                <section className="settings-section" key={category.id}>
                  <div className="row">
                    <h3>{category.name}</h3>
                    <button
                      className="text-button"
                      onClick={() =>
                        edit(
                          "categories",
                          "Rename category",
                          { name: category.name },
                          category.id,
                        )
                      }
                    >
                      Rename
                    </button>
                  </div>
                  <div className="settings-list">
                    {data.menu
                      .filter((item) => item.category === category.id)
                      .map((item) => (
                        <div className="setting-row" key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            <p>
                              {money(item.price)} ·{" "}
                              {item.available ? "Available" : "Unavailable"}
                            </p>
                          </div>
                          <button
                            className="secondary small-button"
                            aria-label={`Edit ${item.name}`}
                            onClick={() =>
                              edit(
                                "menu",
                                "Edit menu item",
                                {
                                  name: item.name,
                                  category: item.category,
                                  price: item.price,
                                  available: item.available,
                                },
                                item.id,
                              )
                            }
                          >
                            <Pencil size={16} /> Edit
                          </button>
                        </div>
                      ))}
                  </div>
                </section>
              ))}
            </>
          )}
          {section === "tables" && (
            <>
              <div className="toolbar">
                <p>Name tables so staff can identify them easily.</p>
                <button
                  className="primary"
                  onClick={() =>
                    edit("tables", "Add table", {
                      name: "",
                      seats: 4,
                      active: true,
                    })
                  }
                >
                  <Plus size={18} /> Add table
                </button>
              </div>
              <div className="settings-list">
                {data.tables.map((table) => (
                  <div className="setting-row" key={table.id}>
                    <div>
                      <strong>{table.name}</strong>
                      <p>
                        {table.seats} seats ·{" "}
                        {table.active ? "Active" : "Disabled"}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        edit(
                          "tables",
                          "Edit table",
                          {
                            name: table.name,
                            seats: table.seats,
                            active: table.active,
                          },
                          table.id,
                        )
                      }
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {section === "users" && (
            <>
              <div className="toolbar">
                <p>Each person has their own sign-in.</p>
                <button
                  className="primary"
                  onClick={() =>
                    edit("users", "Add team member", {
                      username: "",
                      first_name: "",
                      role: "staff",
                      password: "",
                      is_active: true,
                    })
                  }
                >
                  <Plus size={18} /> Add person
                </button>
              </div>
              <div className="settings-list">
                {data.users.map((user) => (
                  <div className="setting-row" key={user.id}>
                    <div>
                      <strong>{user.first_name || user.username}</strong>
                      <p>
                        {user.username} ·{" "}
                        {user.role === "billing"
                          ? "Billing / Gmode"
                          : user.role}{" "}
                        · {user.is_active ? "Active" : "Disabled"}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        edit(
                          "users",
                          "Edit team member",
                          {
                            username: user.username,
                            first_name: user.first_name,
                            role: user.role,
                            is_active: user.is_active,
                            password: "",
                          },
                          user.id,
                        )
                      }
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {section === "devices" && (
            <>
              <div className="toolbar">
                <p>Kitchen devices only see food tickets.</p>
                <button
                  className="primary"
                  onClick={() =>
                    edit("devices", "Connect a kitchen screen", { name: "" })
                  }
                >
                  <Plus size={18} /> Connect device
                </button>
              </div>
              <div className="settings-list">
                {data.devices.map((device) => (
                  <div className="setting-row" key={device.id}>
                    <Tablet />
                    <div className="grow">
                      <strong>{device.name}</strong>
                      <p>
                        {device.revoked_at
                          ? "Access removed"
                          : device.paired_at
                            ? "Connected"
                            : new Date(device.pairing_expires_at) < new Date()
                              ? "Pairing expired — create a new code"
                              : "Waiting to pair"}
                      </p>
                    </div>
                    {!device.revoked_at && (
                      <button
                        className="danger secondary"
                        onClick={() => setRevoke(device.id)}
                      >
                        <Ban size={16} /> Remove access
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!data.devices.length && (
                <Empty title="No kitchen screen connected">
                  Create a pairing code, then open this website on the kitchen
                  device and choose “Connect kitchen screen”.
                </Empty>
              )}
            </>
          )}
          {section === "settings" && (
            <section className="panel">
              <h3>Details printed on receipts</h3>
              <dl className="details">
                <dt>Restaurant name</dt>
                <dd>{data.settings.name}</dd>
                <dt>Address</dt>
                <dd>{data.settings.address || "Not set"}</dd>
                <dt>Phone</dt>
                <dd>{data.settings.phone || "Not set"}</dd>
                <dt>Receipt message</dt>
                <dd>{data.settings.receipt_footer}</dd>
              </dl>
              <button
                className="primary"
                onClick={() =>
                  edit(
                    "settings",
                    "Restaurant details",
                    { ...data.settings },
                    1,
                  )
                }
              >
                Edit details
              </button>
              <p className="muted small">
                Currency: Nepali rupees · Time zone: Nepal · Simple receipts
              </p>
            </section>
          )}
          {section === "audit" && (
            <div className="settings-list">
              {data.audit.map((event) => (
                <div className="setting-row" key={event.id}>
                  <div>
                    <strong>{event.action.replaceAll("_", " ")}</strong>
                    <p>
                      {event.actor} · Record #{event.target}
                      {event.detail.reason && ` · ${event.detail.reason}`}
                    </p>
                  </div>
                  <time className="muted small">
                    {when(event.created_at, true)}
                  </time>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {editor && (
        <Modal
          title={editor.title}
          onClose={() => {
            if (!busy) {
              setEditor(null);
              setError("");
            }
          }}
        >
          <form onSubmit={(e) => void save(e)} className="form-stack">
            {["menu", "categories", "tables", "devices"].includes(
              editor.resource,
            ) &&
              input(
                "name",
                editor.resource === "devices"
                  ? "Device name (for example, Main kitchen)"
                  : "Name",
                {
                  required: true,
                  maxLength:
                    editor.resource === "tables"
                      ? 40
                      : editor.resource === "menu"
                        ? 120
                        : 80,
                },
              )}
            {editor.resource === "menu" && (
              <>
                <label>
                  Category
                  <select
                    value={String(editor.values.category)}
                    onChange={(e) => change("category", Number(e.target.value))}
                  >
                    {data?.categories.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {input("price", "Price in rupees", {
                  required: true,
                  type: "number",
                  min: 0.01,
                  max: 99999999.99,
                  step: "0.01",
                })}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(editor.values.available)}
                    onChange={(e) => change("available", e.target.checked)}
                  />{" "}
                  Available to order
                </label>
              </>
            )}
            {editor.resource === "tables" && (
              <>
                {input("seats", "Number of seats", {
                  required: true,
                  type: "number",
                  min: 1,
                  max: 30,
                })}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(editor.values.active)}
                    onChange={(e) => change("active", e.target.checked)}
                  />{" "}
                  Table is active
                </label>
              </>
            )}
            {editor.resource === "users" && (
              <>
                {input("first_name", "Display name", { maxLength: 150 })}
                {input("username", "Username", {
                  required: true,
                  maxLength: 150,
                })}
                <label>
                  Access
                  <select
                    value={String(editor.values.role)}
                    onChange={(e) => change("role", e.target.value)}
                  >
                    <option value="staff">Staff — takes orders</option>
                    <option value="billing">
                      Billing / Gmode — orders and payments
                    </option>
                    <option value="owner">Owner — full access</option>
                  </select>
                </label>
                {input(
                  "password",
                  editor.id
                    ? "New password (leave blank to keep current)"
                    : "Password",
                  { type: "password", required: !editor.id, maxLength: 128 },
                )}
                <p className="small muted">
                  Use at least 8 characters. Avoid common passwords or the
                  person's name.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(editor.values.is_active)}
                    onChange={(e) => change("is_active", e.target.checked)}
                  />{" "}
                  Account is active
                </label>
              </>
            )}
            {editor.resource === "settings" && (
              <>
                {input("name", "Restaurant name", {
                  required: true,
                  maxLength: 120,
                })}
                {input("address", "Address", { maxLength: 250 })}
                {input("phone", "Phone", { maxLength: 40 })}
                {input("receipt_footer", "Receipt message", { maxLength: 200 })}
              </>
            )}
            {error && <Notice error>{error}</Notice>}
            <button className="primary full" disabled={busy}>
              {busy
                ? "Saving…"
                : editor.resource === "devices"
                  ? "Create pairing code"
                  : "Save changes"}
            </button>
          </form>
        </Modal>
      )}
      {pairCode && (
        <Modal title="Pair your kitchen screen" onClose={() => setPairCode("")}>
          <p>
            On the kitchen device, open this website and choose{" "}
            <strong>Connect kitchen screen</strong>. Enter this code within 10
            minutes.
          </p>
          <div className="pair-code">{pairCode}</div>
          <p className="muted small">
            The code works once. Anyone with this code can connect a kitchen
            device, so share it only with your team.
          </p>
          <button className="primary full" onClick={() => setPairCode("")}>
            Done
          </button>
        </Modal>
      )}
      {revoke !== null && (
        <Modal
          title="Disconnect kitchen device?"
          onClose={() => setRevoke(null)}
        >
          <p>
            This device will stop receiving kitchen orders. You can reconnect it
            later with a new code.
          </p>
          {error && <Notice error>{error}</Notice>}
          <button
            className="primary danger"
            disabled={busy}
            onClick={() => void revokeDevice()}
          >
            Remove device access
          </button>
        </Modal>
      )}
    </>
  );
}
