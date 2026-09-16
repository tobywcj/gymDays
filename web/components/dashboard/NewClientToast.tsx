"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { T } from "@/lib/design-tokens";

type Toast = {
  id: string;
  clientId: string;
  clientName: string;
  clearance: boolean;
};

export default function NewClientToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel("client_screenings_inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "client_screenings" },
        async (payload) => {
          const row = payload.new as { id: string; client_id: string; medical_clearance_required: boolean };
          const { data: client } = await supabase
            .from("clients")
            .select("name")
            .eq("id", row.client_id)
            .maybeSingle();
          setToasts((t) => [
            ...t,
            {
              id: row.id,
              clientId: row.client_id,
              clientName: client?.name ?? "New client",
              clearance: row.medical_clearance_required,
            },
          ]);
          // Refresh server data (pending invites strip, client table).
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  function dismiss(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="new-client-toasts"
      style={{
        position: "fixed",
        right: 24,
        top: 80,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 1000,
        maxWidth: 320,
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      data-testid={`toast-${toast.clientId}`}
      className="glass"
      style={{
        borderRadius: 14,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent }}>
          New screening
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: "transparent",
            border: "none",
            color: T.mutedMid,
            cursor: "pointer",
            fontSize: 16,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{toast.clientName}</div>
      {toast.clearance && (
        <div style={{ fontSize: 10, color: "#fde2da" }}>
          ⚠ Medical clearance flagged
        </div>
      )}
      <Link
        href={`/clients/${toast.clientId}`}
        onClick={onDismiss}
        style={{
          fontSize: 11,
          color: T.accent,
          textDecoration: "none",
          alignSelf: "flex-start",
        }}
      >
        Review →
      </Link>
    </div>
  );
}
