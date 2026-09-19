import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/chorus/landing";

export const Route = createFileRoute("/")({ component: Landing });
