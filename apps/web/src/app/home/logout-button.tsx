"use client";

import { signOut } from "@/lib/auth";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        // Full navigation so the middleware re-evaluates with cleared cookies.
        window.location.assign("/start");
      }}
      className="text-sm text-gray-400 transition-colors duration-150 hover:text-white"
    >
      התנתקות
    </button>
  );
}
