// The dev flag that hands a solo game to the kernel engine at the end of the mulligans.
//   ?engine=kernel in the page URL turns it on; NEXT_PUBLIC_KERNEL_ENGINE=0 is a kill switch that forces the legacy engine whatever the URL says.
// Pure (no window access): callers pass the query string and the env value so the rule is testable.
export function kernelEngineWanted(search: string | undefined, envValue: string | undefined): boolean {
  if (envValue === "0" || envValue === "off" || envValue === "false") return false;
  try {
    return new URLSearchParams(search ?? "").get("engine") === "kernel";
  } catch {
    return false;
  }
}
