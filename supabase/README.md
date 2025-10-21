# Supabase Edge Functions for Image Processing

This directory contains Deno-based Edge Functions that recreate the crop, resize,
and post-processing helpers originally delivered as sandbox scripts. Deploying
these functions to Supabase allows the same automation to run on a managed,
server-side environment instead of GitHub Pages (which only supports static
hosting).

## Functions

| Function | Description |
| --- | --- |
| `postprocess-images` | Accepts raw image payloads (OpenAI `b64_json` objects or data-URLs), automatically trims transparent padding (optional extra padding via `autocropPadding`), resizes each so the longest edge matches the requested dimension, stamps 300&nbsp;DPI metadata, and returns Base64-encoded PNGs directly in the JSON response. |
| `resize-images` | Generates alternate sizes from inline Base64/data-URL payloads. Optional `selectedIndices` allow processing specific items, and each response contains the resized PNGs encoded as Base64 strings (no Supabase Storage writes). |

## Deployment

These functions only rely on the default Supabase Edge runtime environment—no
custom Storage credentials or additional variables are required.

```bash
supabase functions deploy postprocess-images
supabase functions deploy resize-images
```

After deployment, update the Custom GPT Action (or other client) to call the
Supabase endpoints, e.g.:

```
POST https://<project-ref>.supabase.co/functions/v1/postprocess-images
```

Refer to [`API/openapi.yaml`](../API/openapi.yaml) for request/response schemas
that can be imported directly into OpenAI Actions or other OpenAPI-aware tools.
