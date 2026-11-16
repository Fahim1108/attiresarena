import type { Metadata } from "next";
import {notFound} from "next/navigation";
import {reviewInventoryEnabled} from "@/lib/storefront-policy";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";
import LoaderPreviewClient from "@/components/loading/LoaderPreviewClient";

// Preview-only route: noindex in every environment, regardless of the global toggle.
export const metadata: Metadata = { title: "Loader Preview", robots: PRIVATE_PAGE_ROBOTS };
export default function LoaderPreview(){
 if(!reviewInventoryEnabled())notFound();
 return <LoaderPreviewClient/>;
}
