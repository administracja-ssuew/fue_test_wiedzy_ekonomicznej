import { createContext, useContext, useState, useEffect } from "react";
import { MODULES } from "../data/questions.js";
import { getModules } from "../lib/supabase.js";

const Ctx = createContext(MODULES);

export function ModulesProvider({ children }) {
  const [modules, setModules] = useState(MODULES);
  useEffect(() => { getModules().then((m) => { if (m?.length) setModules(m); }); }, []);
  return <Ctx.Provider value={modules}>{children}</Ctx.Provider>;
}

export const useModules   = ()  => useContext(Ctx);
export const useGetModule = ()  => { const m = useModules(); return (id) => m.find((x) => x.id === id); };
