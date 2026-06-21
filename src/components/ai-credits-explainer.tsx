import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Plain-language explainer rendered on the AI wallet page, and surfaced
 * inline by the balance card at low-balance and hard-stop moments.
 */
export function AiCreditsExplainer({ allowance }: { allowance?: number | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="h-4 w-4 text-muted-foreground" /> How AI credits work
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          AI features use credits. Your plan includes{" "}
          <span className="font-medium text-foreground">
            {allowance && allowance > 0 ? `${allowance.toLocaleString()} credits` : "a monthly allowance"}
          </span>{" "}
          each month, refreshed on your renewal date.
        </p>
        <p>
          Different actions use different amounts, a quick suggestion is 1 credit, a long meeting
          summary costs more, so heavier tasks use more of your allowance.
        </p>
        <p>
          If credits run low we'll tell you; if they run out, AI pauses until your next refresh, or you can
          top up anytime. Purchased top-up credits last 12 months.
        </p>
        <p className="text-foreground">
          Only AI features pause, everything else keeps working.
        </p>
      </CardContent>
    </Card>
  );
}
