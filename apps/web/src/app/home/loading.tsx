import { Spinner } from "@/components/ui/icons";

/**
 * Suspense fallback for every route under /home: the sidebar stays put and the
 * content pane shows this the moment a navigation starts, so a click on a
 * service card (or any sidebar link) responds instantly while the server
 * component loads.
 */
export default function HomeLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-ink/55">
      <Spinner /> טוענים…
    </div>
  );
}
