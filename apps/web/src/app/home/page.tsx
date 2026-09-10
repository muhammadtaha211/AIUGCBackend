import { Suspense } from "react";
import { cookies } from "next/headers";
import { getImageProps } from "next/image";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ownedBusinesses } from "@/lib/businesses";
import { isStableCatalogUrl, loadPersonaCatalog } from "@/lib/persona-catalog";
import {
  BUSINESS_COOKIE,
  PERSONA_CARD_QUALITY,
  PERSONA_CARD_SIZES,
  pickSelectedBusiness,
} from "@/lib/service-b-ui";
import { PathwayCards } from "./pathway-cards";
import { RendersStrip } from "./renders-strip";

/** The persona picker's first grid row (3 cols on sm+) — enough to warm the
 *  cache for what's above the fold, without fetching the whole catalog. */
const PRELOAD_COUNT = 3;

/**
 * The dashboard home pane: greeting, the two service cards, recent renders.
 * Sized to fit a laptop viewport with no scrolling — the sidebar layout owns
 * the chrome (switcher, credits, profile).
 *
 * It also preloads the persona picker's first row: next/link prefetch on the
 * service cards warms the wizard's RSC payload, but never its images — these
 * hints put the bytes in the HTTP cache before the user picks a service. The
 * srcset comes from getImageProps with the picker's exact geometry, so the
 * browser preloads the same optimizer URL the picker will request. Both
 * wizards are one click away, and their catalogs differ (A: portrait
 * thumbnails of hook-matrix personas; B: the selfie of selfie personas), so
 * this warms B's card set only — one set of hints, not two.
 *
 * Split so the most-clicked route gets a SHAPED skeleton: the segment-level
 * /home/loading.tsx must stay shape-agnostic (it fronts every child nav),
 * so the shell here is sync and the data-blocking body streams behind its
 * own Suspense. Streamed redirects inside HomeContent still work.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeSkeleton() {
  return (
    <div className="relative isolate overflow-hidden px-6 pb-6 pt-10 sm:px-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mx-auto h-9 w-72 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
        <div className="mx-auto mt-3 h-4 w-56 animate-pulse rounded-lg bg-ink/[0.06]" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="h-40 animate-pulse rounded-2xl bg-white ring-1 ring-ink/[0.07]" />
          <div className="h-40 animate-pulse rounded-2xl bg-white ring-1 ring-ink/[0.07]" />
        </div>
        <div className="mt-8 flex gap-3">
          <div className="aspect-[9/16] w-24 animate-pulse rounded-xl bg-ink/[0.06]" />
          <div className="aspect-[9/16] w-24 animate-pulse rounded-xl bg-ink/[0.06]" />
          <div className="aspect-[9/16] w-24 animate-pulse rounded-xl bg-ink/[0.06]" />
        </div>
      </div>
    </div>
  );
}

async function HomeContent() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  // ownedBusinesses throws on a FAILED read rather than letting it collapse
  // into "owns nothing" — see the note in @/lib/businesses. An empty list still
  // means exactly what it always did.
  const businesses = ownedBusinesses(
    await supabase
      .from("businesses")
      .select("id, name, questionnaire")
      .order("created_at", { ascending: true }),
  );

  // Signed in with no business (e.g. an interrupted signup): straight into the
  // questionnaire wizard — the dashboard has nothing to show yet.
  if (businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;
  const hasQuestionnaire = selected.questionnaire != null;

  // Best-effort: a failed catalog read only costs the warm cache.
  const catalog = await loadPersonaCatalog("b").catch(() => []);
  const preloads = catalog
    .filter((persona) => isStableCatalogUrl(persona.imageUrl))
    .slice(0, PRELOAD_COUNT)
    .map((persona) => {
      const { props } = getImageProps({
        src: persona.imageUrl,
        alt: "",
        fill: true,
        sizes: PERSONA_CARD_SIZES,
        quality: PERSONA_CARD_QUALITY,
      });
      return { key: persona.id, srcSet: props.srcSet };
    });

  return (
    <div className="relative isolate overflow-hidden px-6 pb-6 pt-10 sm:px-10">
      {/* React 19 hoists these to <head>; imageSrcSet mirrors the picker's
          <Image>, so the browser picks the exact candidate it will render. */}
      {preloads.map((preload) => (
        <link
          key={preload.key}
          rel="preload"
          as="image"
          imageSrcSet={preload.srcSet}
          imageSizes={PERSONA_CARD_SIZES}
          fetchPriority="high"
        />
      ))}

      {/* The landing's aurora, behind the greeting only. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56">
        <div className="absolute left-1/2 -top-10 h-48 w-[46rem] max-w-full -translate-x-1/2 rounded-[100%] bg-accent/30 blur-3xl" />
        <div className="absolute right-[10%] top-4 h-32 w-72 rounded-full bg-emerald-300/25 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-center font-display text-3xl leading-tight text-ink sm:text-4xl">
          מה יוצרים היום ל־{selected.name}?
        </h1>
        <p className="mt-2 text-center text-[15px] text-ink/65">
          בוחרים שירות, ומקבלים סרטון מוכן לפרסום.
        </p>

        <div className="mt-8">
          <PathwayCards hasQuestionnaire={hasQuestionnaire} />
        </div>

        <RendersStrip businessId={selected.id} />
      </div>
    </div>
  );
}
