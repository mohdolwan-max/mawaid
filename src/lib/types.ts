export type Role = "owner" | "staff";

export type DayHours = { open: string; close: string; closed: boolean };
export type BusinessHours = Record<string, DayHours>; // key = weekday index "0".."6"

export type OrgContext = {
  orgId: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  lang: "ar" | "en";
  timezone: string;
  businessHours: BusinessHours;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  wizardDone: boolean;
  role: Role;
  deletedAt: string | null;
};

export type Service = {
  id: string;
  org_id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number | null;
  active: boolean;
  sort_order: number;
};

export type StaffMember = {
  membership_id: string;
  user_id: string | null;
  email: string;
  role: Role;
  pending: boolean;
  display_name: string | null;
  bio: string | null;
  photo_url: string | null;
  business_hours: BusinessHours | null; // null = inherits the org's hours
};

export type StaffTimeOff = {
  id: string;
  staff_membership_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};

export type BookingStatus = "booked" | "cancelled" | "completed" | "no_show";

export type Appointment = {
  id: string;
  org_id: string;
  service_id: string;
  service_name: string;
  staff_id: string | null;
  staff_email: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  notes: string | null;
};
