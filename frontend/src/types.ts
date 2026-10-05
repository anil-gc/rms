export type Role = "owner" | "billing" | "staff";
export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
}
export interface Session {
  user: User | null;
  device: { id: number; name: string } | null;
  restaurant_name: string;
  csrf_token: string;
}
export interface Category {
  id: number;
  name: string;
}
export interface MenuItem {
  id: number;
  category: number;
  name: string;
  price: string;
  available: boolean;
}
export interface Table {
  id: number;
  name: string;
  seats: number;
  active: boolean;
  version: number;
  visit: number | null;
  total: string;
  can_pay: boolean;
  can_close_empty: boolean;
  opened_at: string | null;
}
export type Status =
  | "pending"
  | "approved"
  | "preparing"
  | "ready"
  | "served"
  | "rejected"
  | "withdrawn"
  | "voided";
export interface TicketItem {
  id: number;
  menu_item: number;
  name: string;
  price?: string;
  total?: string;
  quantity: number;
  note: string;
}
export interface Ticket {
  id: number;
  visit: number;
  table: number;
  table_name: string;
  created_by?: number;
  staff_name?: string;
  request_id?: string;
  status: Status;
  reason: string;
  total?: string;
  created_at: string;
  updated_at: string;
  items: TicketItem[];
}
export interface Settings {
  name: string;
  address: string;
  phone: string;
  receipt_footer: string;
}
export interface State {
  tables: Table[];
  tickets: Ticket[];
  menu: MenuItem[];
  categories: Category[];
  restaurant: Settings;
}
export interface Receipt {
  id: number;
  number: string;
  restaurant: { name: string; address: string; phone: string; footer: string };
  table: string;
  created_at: string;
  cashier: string;
  method: string;
  total: string;
  items: { name: string; quantity: number; price: string; total: string }[];
}
export interface Sales {
  date: string;
  count: number;
  total: string;
  cash: string;
  qr: string;
}
export interface Account {
  id: number;
  username: string;
  first_name: string;
  role: Role;
  is_active: boolean;
}
export interface Device {
  id: number;
  name: string;
  paired_at: string | null;
  revoked_at: string | null;
  pairing_expires_at: string;
}
export interface Management {
  settings: Settings;
  users: Account[];
  categories: Category[];
  menu: MenuItem[];
  tables: Table[];
  devices: Device[];
  audit: {
    id: number;
    action: string;
    actor: string;
    target: string;
    created_at: string;
    detail: Record<string, string>;
  }[];
}
export interface DraftItem {
  menu_item: number;
  name: string;
  expected_price: string;
  quantity: number;
  note: string;
}
export interface OrderPayload {
  request_id: string;
  table: number;
  table_version: number;
  items: DraftItem[];
}
export interface PaymentPayload {
  request_id: string;
  method: "cash" | "qr";
  expected_total: string;
  qr_verified: boolean;
}
export interface PendingPayment {
  visit: number;
  tableName: string;
  payload: PaymentPayload;
}
