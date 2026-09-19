import { createFileRoute } from "@tanstack/react-router";
import { LexiconPage } from "@/components/chorus/lexicon";

export const Route = createFileRoute("/glossary")({
  component: LexiconPage,
  head: () => ({
    meta: [{ title: "Lexicon · Chorus" }],
  }),
});
