"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useApi<T = any>(path: string) {
  const [result, setResult] = useState<{ path: string; data: T | null; error: string } | null>(null);
  const sequence = useRef(0);
  const reload = useCallback(() => {
    const request = ++sequence.current;
    setResult((previous) => previous?.path === path ? { ...previous, error: "" } : null);
    api<T>(path).then((data) => {
      if (request === sequence.current) setResult({ path, data, error: "" });
    }).catch((err) => {
      if (request === sequence.current) setResult((previous) => ({ path, data: previous?.path === path ? previous.data : null, error: err.message }));
    });
  }, [path]);
  useEffect(() => {
    reload();
    return () => { sequence.current++; };
  }, [reload]);
  return { data: result?.path === path ? result.data : null, error: result?.path === path ? result.error : "", reload };
}
