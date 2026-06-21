import { Router } from "express";

const router = Router();

router.get("/privacy", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — What's Up Dog!</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --navy: #0a0e1a;
      --gold: #c9a84c;
      --fg: #f0ede8;
      --muted: rgba(240,237,232,0.55);
      --card: rgba(255,255,255,0.04);
      --border: rgba(201,168,76,0.18);
    }
    body {
      background: var(--navy);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.7;
      min-height: 100vh;
    }
    .wrap {
      max-width: 700px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 40px;
    }
    .logo-paw {
      font-size: 32px;
    }
    .logo-text {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.3px;
      color: var(--gold);
    }
    .logo-sub {
      font-size: 12px;
      color: var(--muted);
      margin-top: 1px;
    }
    h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--fg);
      margin-bottom: 8px;
    }
    .updated {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 40px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 16px;
      font-weight: 700;
      color: var(--gold);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 12px;
    }
    p {
      color: var(--muted);
      margin-bottom: 10px;
    }
    p:last-child { margin-bottom: 0; }
    ul {
      list-style: none;
      margin-top: 8px;
    }
    ul li {
      color: var(--muted);
      padding: 5px 0 5px 22px;
      position: relative;
    }
    ul li::before {
      content: "🐾";
      font-size: 12px;
      position: absolute;
      left: 0;
      top: 6px;
    }
    a { color: var(--gold); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      font-size: 13px;
      color: var(--muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">

    <div class="logo">
      <span class="logo-paw">🐾</span>
      <div>
        <div class="logo-text">What's Up Dog!</div>
        <div class="logo-sub">by ONJJEM · onjjem.com</div>
      </div>
    </div>

    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: 20 May 2025</p>

    <div class="card">
      <h2>The Short Version</h2>
      <p>
        What's Up Dog! does not collect, store, or sell your personal data.
        We don't require you to create an account. We don't track you.
        Everything is kept on your device unless you explicitly choose to share it.
      </p>
    </div>

    <div class="card">
      <h2>Photos &amp; Breed Scanning</h2>
      <p>
        When you scan a dog photo, the image is sent to Google's Gemini API
        solely to identify the breed. We do not store, retain, or share your
        photos in any way. Google's own privacy policy governs how Gemini
        processes requests — see <a href="https://policies.google.com/privacy" target="_blank">policies.google.com/privacy</a>.
      </p>
      <p>
        Your scanned photos and your dog's name are stored only on your device,
        inside the app's local storage. Uninstalling the app removes all of this data.
      </p>
    </div>

    <div class="card">
      <h2>In-App Purchases</h2>
      <p>
        Pup-Grade features are purchased through Apple's App Store. All payment
        processing is handled entirely by Apple. We receive a transaction
        confirmation but never see your card details, Apple ID, or billing information.
      </p>
      <p>
        Purchase state is managed by RevenueCat. RevenueCat assigns an anonymous
        random ID to your app install — it is not linked to your name or Apple account.
        See <a href="https://www.revenuecat.com/privacy" target="_blank">revenuecat.com/privacy</a>.
      </p>
    </div>

    <div class="card">
      <h2>Data We Do Not Collect</h2>
      <ul>
        <li>No name, email address, or contact details</li>
        <li>No location data</li>
        <li>No device identifiers or advertising IDs</li>
        <li>No usage analytics or behavioural tracking</li>
        <li>No crash reporting services</li>
        <li>No social login or third-party account linking</li>
      </ul>
    </div>

    <div class="card">
      <h2>External Links</h2>
      <p>
        The app contains links to <a href="https://onjjem.com" target="_blank">onjjem.com</a>
        and social media platforms (WhatsApp, Facebook, Instagram, TikTok). Tapping
        those links opens them in your browser or the respective app. Their own
        privacy policies apply once you leave What's Up Dog!.
      </p>
    </div>

    <div class="card">
      <h2>Children's Privacy</h2>
      <p>
        What's Up Dog! is not directed at children under 13. We do not knowingly
        collect any information from children. If you believe a child has submitted
        personal information through the app, please contact us and we will take
        immediate steps to remove it.
      </p>
    </div>

    <div class="card">
      <h2>Changes to This Policy</h2>
      <p>
        We may update this policy from time to time. Any changes will be posted
        at this URL with a revised "Last updated" date. Continued use of the app
        after changes constitutes acceptance of the updated policy.
      </p>
    </div>

    <div class="card">
      <h2>Contact Us</h2>
      <p>
        If you have any questions about this privacy policy, please get in touch:
      </p>
      <p>
        <strong style="color: var(--fg);">ONJJEM</strong><br />
        <a href="mailto:hello@onjjem.com">hello@onjjem.com</a><br />
        <a href="https://onjjem.com" target="_blank">onjjem.com</a>
      </p>
    </div>

    <div class="footer">
      &copy; 2025 ONJJEM · What's Up Dog! · All rights reserved
    </div>

  </div>
</body>
</html>`);
});

export default router;
