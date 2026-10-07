import { Waitlist } from "@clerk/nextjs";
import Link from "next/link";

export default function RequestAccessPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold tracking-tight">Request access to SVG Studio</h1>
        <p className="mt-2 text-sm text-stone-600">
          Leave your email. Once your request is approved, you will receive an invitation to join.
        </p>
      </div>
      <Waitlist />
      <Link href="/sign-in" className="text-sm text-stone-900 underline underline-offset-4">
        Already have access? Sign in
      </Link>
    </main>
  );
}
