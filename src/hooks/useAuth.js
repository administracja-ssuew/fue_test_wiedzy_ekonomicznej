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

    // Read existing session from localStorage (synchronous, no network round-trip)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single()
          .then(({ data: profile }) => {
            setUser(profile ? { ...session.user, ...profile } : null);
            setLoading(false);
          });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

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
          .single()
          .then(({ data: profile }) => {
            if (profile) setUser({ ...session.user, ...profile });
          });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
