// Cloudflare Turnstile widget (run-3 F-6.3) — bot check on the
// app's OTP request-code paths (signup + login + guardian verification).
//
// How it works: Turnstile's JS only runs in a browser, so the widget
// renders inside a react-native-webview WebView pointed at a tiny
// inline HTML page that loads
// https://challenges.cloudflare.com/turnstile/v0/api.js and renders
// the challenge. A solved challenge posts its token back via
// window.ReactNativeWebView.postMessage; the parent passes the token
// to requestSignupCode / requestLoginCode (utils/phoneAuth.ts),
// which forward it as `turnstileToken`. The server verifies it
// against TURNSTILE_SECRET_KEY before issuing any SMS code.
//
// Config: EXPO_PUBLIC_TURNSTILE_SITE_KEY (public site key — safe to
// ship in the bundle; see mobile-app/.env.example). With no site key
// the widget renders a quiet notice and reports no token, and the
// request-code calls proceed without one — the server fails open
// while TURNSTILE_SECRET_KEY is unset, and rejects token-less
// requests once it is set. So the widget alone does not enforce
// anything: the site key + the Vercel secret key are both required
// (both are the USER's step — never invent a key value here).
//
// Dependency: react-native-webview (declared in package.json; run
// `npx expo install react-native-webview` on an unrestricted machine
// if node_modules was installed before it was added).
import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';

interface TurnstileWidgetProps {
  /** Called with a fresh token when the challenge solves, and with
   * null when the token expires / the widget errors — the parent
   * must not reuse a nulled token. */
  onToken: (token: string | null) => void;
}

const buildHtml = (sitekey: string): string => `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body{margin:0;padding:0;background:transparent;display:flex;justify-content:center}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
</head><body>
<div id="cf-turnstile"></div>
<script>
function post(msg){ window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
var renderAttempts = 0;
function renderWidget(){
  // O-11.2: capped retry — the old code retried every 200 ms
  // forever when the Turnstile script never loaded. After ~25 tries
  // (~5 s) give up and report an error so the parent can show a
  // clear error state instead of spinning silently.
  if (!window.turnstile) {
    renderAttempts++;
    if (renderAttempts > 25) { post({ type: 'error' }); return; }
    setTimeout(renderWidget, 200);
    return;
  }
  window.turnstile.render('#cf-turnstile', {
    sitekey: ${JSON.stringify(sitekey)},
    callback: function(token){ post({ type: 'token', token: token }); },
    'expired-callback': function(){ post({ type: 'expired' }); },
    'error-callback': function(){ post({ type: 'error' }); }
  });
}
renderWidget();
</script></body></html>`;

export default function TurnstileWidget({ onToken }: TurnstileWidgetProps) {
  const [failed, setFailed] = useState(false);
  const lastToken = useRef<string | null>(null);
  const html = useMemo(() => buildHtml(TURNSTILE_SITE_KEY), []);

  if (!TURNSTILE_SITE_KEY) {
    // Unconfigured: no key, no challenge — the request-code calls
    // proceed token-less and the server decides (see header note).
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>Bot check not configured yet.</Text>
      </View>
    );
  }

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type?: string; token?: string };
      if (msg.type === 'token' && typeof msg.token === 'string') {
        lastToken.current = msg.token;
        onToken(msg.token);
      } else if (msg.type === 'expired' || msg.type === 'error') {
        lastToken.current = null;
        if (msg.type === 'error') setFailed(true);
        onToken(null);
      }
    } catch {
      // A malformed postMessage is ignored — no token is reported.
    }
  };

  return (
    <View style={styles.widget}>
      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        onMessage={handleMessage}
        onError={() => setFailed(true)}
        // The widget page is our own inline HTML, not a browsed site:
        // no navigation away from it is ever expected.
        onShouldStartLoadWithRequest={() => false}
      />
      {failed ? <Text style={styles.errorText}>Bot check failed to load — try again.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  widget: { height: 72, marginTop: 14, overflow: 'hidden' },
  webview: { backgroundColor: 'transparent' },
  notice: { marginTop: 14, alignItems: 'center' },
  noticeText: { color: '#71717a', fontSize: 12 },
  errorText: { color: '#f87171', fontSize: 12, textAlign: 'center', marginTop: 4 },
});
