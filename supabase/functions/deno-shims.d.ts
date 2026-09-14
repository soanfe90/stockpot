/**
 * Enough of the Deno runtime to type-check Edge Functions from the project's
 * own toolchain. Deno supplies the real definitions when the functions run;
 * these exist only so `npm run typecheck:functions` works without it.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

declare module 'jsr:@std/encoding@^1/base64' {
  export function encodeBase64(data: Uint8Array | ArrayBuffer | string): string;
}
