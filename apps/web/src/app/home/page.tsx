import { cookies } from "next/headers";
import { getImageProps } from "next/image";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isStableCatalogUrl, loadPersonaCatalog } from "@/lib/persona-catalog";
import {
  BUSINESS_COOKIE,
  PERSONA_CARD_QUALITY,
  PERSONA_CARD_SIZES,
  pickSelectedBusiness,
} from "@/lib/service-b-ui";
import { HomeHeader } from "./home-header";
import { PathwayCards } from "./pathway-cards";
import { RendersStrip } from "./renders-strip";

/** The persona picker's first grid row (3 cols on sm+) — enough to warm the
 *  cache for what's above the fold, without fetching the whole catalog. */
const PRELOAD_COUNT = 3;

/**
 * The signed-in homepage: business switcher, the two service pathways, and
 * the recent renders strip. Businesses are read with the user's own session,
 * so RLS scopes the list to what they own.
 *
 * It also preloads the persona picker's first row: next/link prefetch on the
 * pathway cards warms the wizard's RSC payload, but never its images — these
 * hints put the bytes in the HTTP cache before the user picks a pathway. The
 * srcset comes from getImageProps with the picker's exact geometry, so the
 * browser preloads the same optimizer URL the picker will request.
 */
export default async function HomePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name, questionnaire")
    .order("created_at", { ascending: true });

  // Signed in with no business (e.g. an interrupted signup): straight into the
  // questionnaire wizard — the homepage has nothing to show yet.
  if (!businesses || businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;
  const hasQuestionnaire = selected.questionnaire != null;

  // Best-effort: a failed catalog read only costs the warm cache.
  const catalog = await loadPersonaCatalog().catch(() => []);
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
    <div className="flex min-h-dvh flex-col">
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
      <HomeHeader
        businesses={businesses.map(({ id, name }) => ({ id, name }))}
        selectedId={selected.id}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            מה יוצרים היום ל־{selected.name}?
          </h1>
          <p className="mt-2 text-[15px] text-gray-400">
            בוחרים מסלול — ומקבלים סרטון מוכן לפרסום.
          </p>

          <div className="mt-8">
            <PathwayCards hasQuestionnaire={hasQuestionnaire} />
          </div>

          <RendersStrip businessId={selected.id} />
        </div>
      </main>
    </div>
  );
}
