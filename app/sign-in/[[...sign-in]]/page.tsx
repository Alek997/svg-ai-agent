import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Sign in to SVG Studio</h1>
      <SignIn />
      <p className="text-sm text-stone-600">
        Need an invitation?{" "}
        <Link href="/request-access" className="font-medium text-stone-900 underline underline-offset-4">
          Request access
        </Link>
      </p>
    </main>
  );
}
