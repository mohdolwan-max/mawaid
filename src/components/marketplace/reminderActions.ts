"use server";

import { createClient } from "@/lib/supabase/server";

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  cancelToken: string | null;
}): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_cancel_token: input.cancelToken,
  });
  return !error;
}
