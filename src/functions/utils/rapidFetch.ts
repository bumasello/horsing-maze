// utils/rapidFetch.ts
import { RAPIDAPI_HOST, RAPIDAPI_KEYS } from "../config/rapidapi";
import fetch from "node-fetch";

import type { RequestInit, Response } from "node-fetch";
/**
 * Faz fetch para RapidAPI trocando a key se receber 429.
 */
export async function rapidFetch(
  path: string,
  headersInit: Record<string, string> = {},
  options: Omit<RequestInit, "headers"> = {},
  maxRetries = RAPIDAPI_KEYS.length,
): Promise<Response> {
  let attempt = 0;
  let keyIndex = 0;

  while (attempt < maxRetries) {
    const headers = new Headers(headersInit);
    headers.set("x-rapidapi-host", RAPIDAPI_HOST);
    headers.set("x-rapidapi-key", RAPIDAPI_KEYS[keyIndex]);

    const res = await fetch(path, {
      ...options,
      headers,
    });

    if (res.status !== 429) {
      // ou seja, OK (200) ou outro erro que NÃO seja limite
      return res;
    }

    // Se 429, trocamos de chave e re-tentamos
    attempt++;
    keyIndex = (keyIndex + 1) % RAPIDAPI_KEYS.length;
    console.warn(
      `RapAPI 429 — trocando para key[${keyIndex}] e retry ${attempt}/${maxRetries}`,
    );

    // opcional: usar Retry-After header para delay
    const retryAfter = res.headers.get("Retry-After");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
    await new Promise((r) => setTimeout(r, waitMs));
  }

  throw new Error(
    "Todas as chaves estouraram o limite (429 Too Many Requests)",
  );
}
