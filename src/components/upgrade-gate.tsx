import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import {
  hasFeature,
  requiredTierFor,
  tierLabel,
  type Feature,
} from "@/lib/entitlements";

export function UpgradeGate({
  feature,
  children,
  description,
}: {
  feature: Feature;
  children: ReactNode;
  description?: string;
}) {
  const { tier, isLoading } = useSubscription();
  if (isLoading) return null;
  if (hasFeature(tier, feature)) return <>{children}</>;
  const required = requiredTierFor(feature);
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Upgrade to {tierLabel(required)}</CardTitle>
          <CardDescription>
            {description ??
              `This feature is available on the ${tierLabel(required)} plan and above.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild>
            <Link to="/pricing">View plans</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
