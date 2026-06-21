/**
 * Server-side credit metering. Charge weighted credits derived from the
 * measured cost in `ai_usage_events`. Allowance is spent before purchased
 * lots; running out triggers a HARD STOP (pauses AI on that account until
 * the next cycle reset or a top-up).
 *
 * Balances are written ONLY by SECURITY DEFINER SQL functions invoked from
 * server code, never by clients.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { trueCostMicros, type AiActionType } from "./ai-budget.server";
import { CREDITS_EXHAUSTED_PREFIX, creditsFor } from "./credits";

type Balance = {
  billingAccount: string;
  allowance: number;
  purchased: number;
  paused: boolean;
};

async function readBalance(userId: string): Promise<Balance> {
  // Resolve the billing account (pooled at team owner for Team plans).
  const { data: billing } = await supabaseAdmin.rpc("resolve_billing_account", {
    _user: userId,
  });
  const billingAccount = (billing as string | null) ?? userId;

  const { data } = await supabaseAdmin
    .from("account_credits")
    .select("credit_balance, purchased_credits, topup_paused")
    .eq("account_user_id", billingAccount)
    .maybeSingle();

  return {
    billingAccount,
    allowance: (data?.credit_balance as number | null) ?? 0,
    purchased: (data?.purchased_credits as number | null) ?? 0,
    paused: (data?.topup_paused as boolean | null) ?? false,
  };
}

/**
 * Throws CREDITS_EXHAUSTED if the user can't cover at least `estimatedCredits`.
 * Call BEFORE invoking the model.
 */
export async function assertAiCredits(
  userId: string,
  estimatedCredits = 1,
): Promise<void> {
  const bal = await readBalance(userId);
  if (bal.paused || bal.allowance + bal.purchased < estimatedCredits) {
    // Fire-and-forget hard-stop email, claim atomically so we only send
    // once per cycle even under concurrent AI calls. Never block or fail
    // the hard-stop on email errors.
    void notifyHardStop(bal.billingAccount).catch((e) =>
      console.warn("[credits] hard-stop email failed", e),
    );
    throw new Error(
      `${CREDITS_EXHAUSTED_PREFIX} You're out of AI credits. Top up or wait for your next cycle to continue.`,
    );
  }
}

async function notifyHardStop(billingAccount: string): Promise<void> {
  const { data: claimed } = await supabaseAdmin.rpc(
    "try_claim_hard_stop_alert",
    { _account: billingAccount },
  );
  if (!claimed) return;

  const { data: auth } = await supabaseAdmin.auth.admin.getUserById(
    billingAccount,
  );
  const email = auth?.user?.email;
  if (!email) return;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", billingAccount)
    .maybeSingle();
  const name =
    ((profile?.full_name as string | null) ?? "").split(" ")[0] || "there";

  const { brandedEmail, sendEmail, getAppOrigin } = await import("./email.server");
  const billingUrl = `${getAppOrigin()}/billing`;
  const html = brandedEmail({
    heading: "Your AI is paused",
    preheader: "Top up credits to keep your AI features running.",
    intro: `Hi ${name}, Heartbeat just paused AI features on your account, you've used your monthly allowance and any purchased credits.`,
    bodyHtml: `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#3A3A3A">No silent overcharges, no surprise bill. You can top up to continue right away, or wait for your next billing cycle to refill your allowance automatically.</p>`,
    ctaLabel: "Top up AI credits",
    ctaUrl: billingUrl,
    ctaNoteHtml: `<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;color:#7A7A7A;font-size:12px;line-height:1.55">You're getting this once per cycle when AI pauses. Manage your plan in <a href="${billingUrl}" style="color:#7A8471;text-decoration:none">Billing</a>.</p>`,
  });
  await sendEmail({
    to: email,
    subject: "AI paused, top up to continue",
    html,
  });
}

/**
 * Charge credits AFTER a successful AI call. Computes the credit count from
 * the per-event true cost, then debits via the SECURITY DEFINER RPC.
 * Returns the credit count actually charged (≥ 1).
 *
 * If the account ends up over budget *because* of this call (the optimistic
 * pre-check passed but cost was higher than 1 credit), the RPC still debits
 * what it can, there's no half-spend, but a subsequent call will hard-stop.
 */
export async function chargeAiCredits(opts: {
  userId: string;
  actionType: AiActionType;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  audioSeconds?: number;
  eventId: string | null;
}): Promise<number> {
  const cost = trueCostMicros({
    model: opts.model,
    tokensIn: opts.tokensIn,
    tokensOut: opts.tokensOut,
    audioSeconds: opts.audioSeconds,
  });
  const credits = creditsFor({
    trueCostMicros: cost,
    actionType: opts.actionType,
  });
  const { error } = await supabaseAdmin.rpc("charge_ai_credits", {
    _acting_user: opts.userId,
    _credits: credits,
    _event_id: opts.eventId ?? undefined,
  } as { _acting_user: string; _credits: number; _event_id: string });
  if (error) {
    console.warn("[credits] charge_ai_credits failed", error);
  }
  return credits;
}
