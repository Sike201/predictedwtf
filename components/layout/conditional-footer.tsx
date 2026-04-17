"use client";

import { usePathname } from "next/navigation";
import { VanishingFooter } from "@/components/layout/vanishing-footer";

export function ConditionalFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith("/create")) return null;
  return <VanishingFooter />;
}
