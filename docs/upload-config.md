# Configuring the Direct S3 Upload Flow

The dashboard ships with a direct-to-S3 upload button (`scripts/upload.js`). The script now reads its settings at runtime so you can safely commit the frontend without exposing AWS secrets. Follow the steps below before attempting an upload.

## 1. Gather AWS values

| Setting | Example | Notes |
| --- | --- | --- |
| Region | `ap-southeast-2` | Use the short code, not the friendly name. |
| S3 bucket | `smartquiz-input-prod` | Bucket must allow `PutObject` from your Cognito identity pool. |
| Cognito Identity Pool ID | `ap-southeast-2:xxxx-xxxx` | The pool needs an unauthenticated role with S3 upload permissions. |

## 2. Inject the values into the dashboard

There are two supported approaches:

1. **Meta tags (recommended for Firebase Hosting)** – Edit `frontend/dashboard.html` and update the three `<meta name="smartquiz:*">` tags in the `<head>`:

   ```html
   <meta name="smartquiz:aws-region" content="ap-southeast-2">
   <meta name="smartquiz:s3-bucket" content="smartquiz-input-prod">
   <meta name="smartquiz:cognito-identity-pool" content="ap-southeast-2:12345678-abcd-1234-abcd-1234567890ab">
   ```

2. **Global config (useful for local testing)** – Define `window.SMARTQUIZ_UPLOAD_CONFIG` before `scripts/upload.js` loads:

   ```html
   <script>
     window.SMARTQUIZ_UPLOAD_CONFIG = {
       region: 'ap-southeast-2',
       bucket: 'smartquiz-input-prod',
       identityPoolId: 'ap-southeast-2:12345678-abcd-1234-abcd-1234567890ab'
     };
   </script>
   ```

`upload.js` looks for values in `window.SMARTQUIZ_UPLOAD_CONFIG`, then falls back to the three meta tags, and finally to `data-*` attributes on the `<body>` element.

## 3. Verify in the UI

Reload `dashboard.html` and check the helper text under the upload button. A success message similar to `Signed in as … Ready to upload.` indicates the config is valid. If the script cannot find a value it disables the button and displays the specific missing field so you can correct it quickly.

## 4. (Optional) Hide secrets

If you do not want to commit the real values, create a `frontend/dashboard.local.html` for development or inject `window.SMARTQUIZ_UPLOAD_CONFIG` via Firebase Hosting [rewrites/functions](https://firebase.google.com/docs/hosting/full-config#headers) that read from environment config. The runtime lookup keeps all three options interchangeable.
