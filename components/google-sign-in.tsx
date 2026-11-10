"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/ledger-cloud";
import type { CloudConfig } from "@/lib/ledger-cloud-config";

type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    ux_mode: "popup";
    nonce: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(host: HTMLElement, options: { theme: "outline"; size: "large"; width: number }): void;
};

export function GoogleSignIn({ cloud, disabled, onBusyChange }: {
  cloud: CloudConfig;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    const clientId = cloud.googleClientId;
    if (!host || !loaded || !clientId) return;
    const identity = (window as Window & { google?: { accounts: { id: GoogleIdentity } } }).google?.accounts.id;
    let active = true;
    let submitted = false;
    let observer: ResizeObserver | undefined;

    async function initialize(buttonHost: HTMLDivElement, google: GoogleIdentity, googleClientId: string) {
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
      if (!active) return;
      google.initialize({
        client_id: googleClientId,
        ux_mode: "popup",
        nonce: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""),
        async callback({ credential }) {
          if (!active || submitted || buttonHost.inert || !credential) return;
          submitted = true;
          setPending(true);
          onBusyChange(true);
          try {
            const { error } = await getSupabase(cloud).auth.signInWithIdToken({ provider: "google", token: credential, nonce });
            if (error) throw error;
          } catch {
            if (active) setProblem("Couldn’t sign in with Google. Try again.");
          } finally {
            if (active) {
              setPending(false);
              onBusyChange(false);
            }
          }
        },
      });
      let buttonWidth = 0;
      function render() {
        const width = Math.min(400, buttonHost.clientWidth);
        if (!width || width === buttonWidth) return;
        buttonWidth = width;
        buttonHost.replaceChildren();
        google.renderButton(buttonHost, { theme: "outline", size: "large", width });
        setRendered(true);
      }
      render();
      observer = new ResizeObserver(render);
      observer.observe(buttonHost);
    }

    const initializationFailed = () => { if (active) setProblem("Couldn’t open Google sign-in. Try again."); };
    if (identity) void initialize(host, identity, clientId).catch(initializationFailed);
    else initializationFailed();
    return () => { active = false; observer?.disconnect(); host.replaceChildren(); };
  }, [cloud, loaded, attempt, onBusyChange]);

  if (!cloud.googleClientId) return <p>Google sign-in is currently unavailable.</p>;
  return <div className="google-sign-in">
    <Script src="https://accounts.google.com/gsi/client" onReady={() => setLoaded(true)}
      onError={() => setProblem("Couldn’t load Google sign-in. Refresh the page to try again.")}/>
    <div ref={hostRef} className="google-sign-in-button" hidden={Boolean(problem)} inert={disabled || pending}/>
    {!rendered && !problem && <p role="status">Loading Google sign-in…</p>}
    {pending && <p role="status">Signing in with Google…</p>}
    {problem && <>
      <p className="form-message error" role="alert">{problem}</p>
      {loaded && <button type="button" className="button quiet" onClick={() => {
        setProblem(""); setRendered(false); setAttempt(value => value + 1);
      }}>Retry Google sign-in</button>}
    </>}
  </div>;
}
