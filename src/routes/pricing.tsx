import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/components/chorus/pricing";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [{ title: "Pricing · Chorus" }],
  }),
});
