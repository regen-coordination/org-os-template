import type { APIRoute } from "astro";
import { federationData } from "../lib/federation";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(federationData, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
