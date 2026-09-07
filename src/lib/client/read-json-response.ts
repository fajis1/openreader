/** Never expose an HTML error page (or upstream response body) as a JSON error. */
export async function readJsonResponse(response: Response) {
  let data;
  try { data = JSON.parse(await response.text()); }
  catch {
    throw new Error(`Reader returned a non-JSON response (HTTP ${response.status}). The server or reverse proxy may be unavailable or have timed out. Reload to check saved job progress before retrying.`);
  }
  if (!response.ok) throw new Error(`${typeof data?.error === 'string' ? data.error : `Reader request failed (HTTP ${response.status}).`}${data?.requestId ? ` Reference: ${data.requestId}` : ''}`);
  return data;
}
