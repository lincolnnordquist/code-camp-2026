import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { signInVendor } from "../../shared/api";
import { useOnlineStatus } from "../../shared/live";
import { Banner, Button, TextField } from "../../shared/ui";
import { useVendor } from "./vendorSession";

const messages = {
  invalid_credentials: "That email and password do not match.",
  no_booth: "This account has no booth at an event yet.",
  network: "Could not reach the server. Check your connection and try again.",
  offline: "You are offline. Connect to sign in.",
} as const;

// FR-19: vendor staff sign in with email and password at /vendor.
export function SignIn() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { boothState, reloadBooth } = useVendor();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof messages | null>(null);

  if (boothState.status === "ready") return <Navigate to="/vendor/orders" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!online) return setError("offline");
    setBusy(true);
    setError(null);
    try {
      const result = await signInVendor(email.trim(), password);
      if (!result.ok) return setError(result.reason);
      reloadBooth();
      navigate("/vendor/orders", { replace: true });
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vendor-app">
      <main className="vendor-screen vendor-signin">
        <h1 className="headline-small">Vendor sign in</h1>
        <p className="body-large">Sign in to see your booth's orders and stock.</p>
        {error && (
          <Banner tone="error" icon="error">
            {messages[error]}
          </Banner>
        )}
        <form className="vendor-form" onSubmit={submit}>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {busy ? (
            <Button variant="vendor" loadingLabel="Signing in" />
          ) : (
            <Button variant="vendor" type="submit">
              Sign in
            </Button>
          )}
        </form>
      </main>
    </div>
  );
}
