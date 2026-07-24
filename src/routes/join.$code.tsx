import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { joinByInvite } from "@/lib/messaging.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/join/$code")({
  component: JoinPage,
  head: () => ({
    meta: [
      { title: "Join a chat — Whispr" },
      { name: "description", content: "Accept your Whispr invite and join the conversation." },
    ],
  }),
});

function JoinPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const join = useServerFn(joinByInvite);

  const mut = useMutation({
    mutationFn: () => join({ data: { code } }),
    onSuccess: () => {
      void navigate({ to: "/app" });
    },
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        void navigate({
          to: "/auth",
          search: { next: `/join/${code}` } as never,
          replace: true,
        });
        return;
      }
      mut.mutate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center text-foreground">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl avatar-gradient shadow-lg shadow-electric/20">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="M22 4 12 14.01l-3-3" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold">Accepting your invite…</h1>
        {mut.isError && (
          <p className="mt-3 text-sm text-red-400">
            {(mut.error as Error)?.message ?? "This invite is no longer valid."}
          </p>
        )}
        {!mut.isError && (
          <p className="mt-2 text-sm text-muted-foreground">Hold tight, we're setting things up.</p>
        )}
      </div>
    </div>
  );
}
