import { headers } from "next/headers";
import { TENANT_HEADER } from "./tenant-resolve";
import { UUID_RE } from "./tenant-token";

// The business the current request was resolved to by proxy.ts, read from the
// header it stamped. Null outside a request, or when the request named none
// (the sign-in page on a platform address, say).
//
// Its own module, imported only when needed: next/headers is for request
// scope, and lib/supabase.ts is also loaded by tests that have no request.
export async function requestTenantId(): Promise<string | null> {
  try {
    const value = (await headers()).get(TENANT_HEADER);
    return value && UUID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}
