"use client";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

/** Same exit as the account menu's row: clear the session, then a full navigation so the middleware re-evaluates. */
export function SignOutButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        await signOut();
        window.location.assign("/");
      }}
    >
      התנתקות
    </Button>
  );
}
