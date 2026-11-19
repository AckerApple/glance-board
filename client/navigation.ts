import { array } from "taggedjs";

// Add future destinations here, then mount their page in App.
export const destinations = [
  { id: "home", href: "#/", label: "🏠 Home" },
  { id: "calendars", href: "#/calendars", label: "🗓️ Calendars" },
  { id: "sports", href: "#/sports", label: "🏈 Sports" }
] as const;
export type PageId = typeof destinations[number]["id"];

export function pageForHash(hash: string): PageId {
  return destinations.find(destination => destination.href === hash)?.id ?? "home";
}

export const navigation$ = array<PageId>([typeof window === "undefined" ? "home" : pageForHash(window.location.hash)]);

export function startNavigation(): () => void {
  const sync = () => { navigation$[0] = pageForHash(window.location.hash); };
  sync();
  window.addEventListener("hashchange", sync);
  return () => window.removeEventListener("hashchange", sync);
}
