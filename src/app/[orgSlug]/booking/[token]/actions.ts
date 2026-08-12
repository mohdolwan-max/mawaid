"use server";

import { cancelBookingByToken } from "@/lib/availability";

export async function cancelAction(token: string): Promise<boolean> {
  return cancelBookingByToken(token);
}
