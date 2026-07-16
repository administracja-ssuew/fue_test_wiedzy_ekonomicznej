import { useState, useEffect } from "react";
import { supabase, DEMO } from "../lib/supabase.js";

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (DEMO) {
      const u = JSON.parse(localStorage.getItem("fue_admin") || "null");
      setUser(u);
      setLoading(false);
      return;
    }

    // Read existing session, then hydrate the admin profile.
    // Backend może być nieosiągalny (projekt uśpiony, brak sieci, DNS) — wtedy promise
    // ODRZUCA. Bez .catch()/.finally() loading zostawał true na zawsze i cała aplikacja
    // wisiała na ekranie „Ładowanie…". Zawsze kończymy ładowanie: brak sesji = ekran
    // powitalny, na którym uczestnik i tak może spróbować wpisać kod.
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!session?.user) { setUser(null); return; }
        const { data: profile } = await supabase
          .from("profiles").select("*").eq("id", session.user.id).maybeSingle();
        setUser(profile ? { ...session.user, ...profile } : null);
      })
      .catch((err) => {
        console.error("[useAuth] nie udało się odczytać sesji:", err?.message || err);
        setUser(null);
      })
      .finally(() => setLoading(false));

    // Subscribe to all future auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT" || !session?.user) {
          setUser(null);
          return;
        }
        supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (profile) setUser({ ...session.user, ...profile });
          })
          .catch((err) => console.error("[useAuth] profil:", err?.message || err));
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
