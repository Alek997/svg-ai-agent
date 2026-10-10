import type { Metadata } from "next";
import { PublicSvg } from "@/components/public-svg";
import { redirect } from "next/navigation";
import { resolvePublicId } from "@/lib/svg/public-result";
import { publicIdSchema, publicSvgIdSchema } from "@/lib/svg/public-id";

export const metadata: Metadata = {
  title: "Shared SVG · SVG Studio",
  description: "View and download a shared SVG.",
  robots: { index: false, follow: false },
};

export default async function SharedSvgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!publicIdSchema.safeParse(id).success && publicSvgIdSchema.safeParse(id).success) {
    let publicId: string | null = null;
    try { publicId = await resolvePublicId(id); }
    catch { /* The client presents a retryable state if storage is unavailable. */ }
    if (publicId) redirect(`/s/${publicId}`);
  }
  return <PublicSvg key={id} id={id} />;
}
