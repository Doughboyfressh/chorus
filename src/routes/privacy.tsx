import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/components/chorus/privacy";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [{ title: "Privacy · Chorus" }],
  }),
});
