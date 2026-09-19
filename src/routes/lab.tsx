import { createFileRoute } from "@tanstack/react-router";
import { ChorusApp } from "@/components/chorus/app";

export const Route = createFileRoute("/lab")({
  component: ChorusApp,
  head: () => ({
    meta: [{ title: "Lab · Chorus" }],
  }),
});
