import { useEffect, useState, type FormEvent } from "react";
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

  useEffect(() => {
    document.title = "Vendor sign in | DibSpot";
  }, []);

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
    <div className="vendor-signin">
      <main className="vendor-signin__main">
        <p className="vendor-signin__brand">
          <span className="vendor-wordmark">DibSpot</span>
          <span className="vendor-bar__kicker">Vendor</span>
        </p>
        <div className="vendor-signin__card">
          <div className="vendor-signin__text">
            <h1>Vendor sign in</h1>
            <p>Sign in to see your booth's orders and stock.</p>
          </div>
          {error && (
            <Banner tone="error" icon={error === "offline" || error === "network" ? "wifi_off" : "error"}>
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
              <Button className="vendor-form__submit" loadingLabel="Signing in" />
            ) : (
              <Button className="vendor-form__submit" type="submit">
                Sign in
              </Button>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
