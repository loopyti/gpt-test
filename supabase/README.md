# Supabase Edge Functions for Image Processing

This directory contains Deno-based Edge Functions that recreate the crop, resize,
and post-processing helpers originally delivered as sandbox scripts. Deploying
these functions to Supabase allows the same automation to run on a managed,
server-side environment instead of GitHub Pages (which only supports static
hosting).

## Functions

| Function | Description |
| --- | --- |
| `postprocess-images` | Accepts raw image payloads (OpenAI `b64_json` objects or data-URLs), resizes each so the longest edge matches the requested dimension, stamps 300&nbsp;DPI metadata, stores the PNG in Supabase Storage, and returns a JSON manifest of download URLs. |
| `resize-images` | Generates alternate sizes from previously stored outputs or inline payloads. Optional `selectedIndices` allow processing specific items, and files are saved back to Supabase Storage using the same metadata helpers. |
| `autocrop-png` | Crops transparent padding, optionally applying additional padding, then stores the cropped PNG and reports the bounding box. |

## Environment variables

Set the following values before deploying the functions:

- `SUPABASE_URL` – Supabase project URL (automatically supplied during deployment).
- `SUPABASE_SERVICE_ROLE_KEY` – Service role key used for Storage access (automatically supplied during deployment).
- `IMAGE_BUCKET` – Storage bucket name that will hold generated PNGs (default: `image-outputs`).
- `IMAGE_FOLDER_PREFIX` – Folder prefix inside the bucket for grouping outputs (default: `gpt`).

Ensure the target bucket allows public read access or generate signed URLs before
exposing the responses to end users.

## Deployment

```bash
supabase functions deploy postprocess-images
supabase functions deploy resize-images
supabase functions deploy autocrop-png
```

After deployment, update the Custom GPT Action (or other client) to call the
Supabase endpoints, e.g.:

```
POST https://<project-ref>.supabase.co/functions/v1/postprocess-images
```

Refer to [`API/openapi.yaml`](../API/openapi.yaml) for request/response schemas
that can be imported directly into OpenAI Actions or other OpenAPI-aware tools.
