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
          Credits power AI features, a quick action costs about 1 credit, longer ones cost more.
          {allowance && allowance > 0 ? (
            <> Your plan includes <span className="font-medium text-foreground">{allowance.toLocaleString()} credits</span> each month.</>
          ) : null}
        </p>
        <p>
          Your monthly allowance refills on your billing date; purchased top-ups last 12 months.
        </p>
        <p>
          If credits run low we'll tell you; if they run out, AI pauses until your next refresh, or you can
          top up anytime.
        </p>
        <p className="text-foreground">
          Only AI features pause, everything else keeps working.
        </p>
      </CardContent>
    </Card>
  );
}
