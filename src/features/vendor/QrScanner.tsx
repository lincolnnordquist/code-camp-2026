import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, Icon } from "../../shared/ui";
import { readScanFrame, type ScanHold } from "./scanHold";

// How often a frame is read. Fast enough to feel instant, light enough for an older phone.
const SCAN_INTERVAL_MS = 200;
// jsQR reads a downscaled frame; a phone held to a phone screen fills plenty of it.
const MAX_FRAME_PX = 640;
const NOT_PICKUP_SHOWN_MS = 2_500;

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

type Detector = (video: HTMLVideoElement) => Promise<string | null>;

// The browser's BarcodeDetector is not in TypeScript's DOM types yet.
type NativeDetector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

// The browser's own QR reader where it has one; otherwise jsQR, downloaded only now, so neither
// the attendee app nor the vendor app's first load carries it.
async function createDetector(canvas: HTMLCanvasElement): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    const formats = (await Native.getSupportedFormats?.().catch(() => [])) ?? ["qr_code"];
    if (formats.includes("qr_code")) {
      const detector = new Native({ formats: ["qr_code"] });
      return async (video) => {
        const found = await detector.detect(video).catch(() => []);
        return found[0]?.rawValue ?? null;
      };
    }
  }
  const { default: jsQR } = await import("jsqr");
  return async (video) => {
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, MAX_FRAME_PX / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" })?.data ?? null;
  };
}

type Phase = "ask" | "starting" | "scanning" | "denied" | "no_camera" | "insecure" | "failed";

const PHASE_TEXT: Record<Exclude<Phase, "scanning" | "starting">, { title: string; body: string }> = {
  ask: {
    title: "Scan the customer's QR code",
    body: "DibSpot uses the camera only while this is open, to read the code on the customer's order page.",
  },
  denied: {
    title: "Camera access is off",
    body: "Allow the camera for this site in your browser settings, or type the 4-digit code.",
  },
  no_camera: { title: "No camera found", body: "This device has no camera to use. Type the 4-digit code instead." },
  insecure: { title: "The camera needs a secure page", body: "Open DibSpot over https to scan. Type the 4-digit code for now." },
  failed: { title: "The camera did not start", body: "Close other apps that use the camera and try again, or type the code." },
};

type QrScannerProps = {
  // Called once per scan with a valid 4-digit code; the scanner has stopped the camera by then.
  onCode: (code: string) => void;
  onClose: () => void;
  // The last code used, kept by the page so reopening the scanner on the same screen is not a second lookup.
  holdRef: RefObject<ScanHold>;
};

// FR-30: staff scan the QR on the attendee's order page instead of typing the code. A bottom sheet
// in the attendee cancel sheet's style, with the live camera inside a viewfinder.
export function QrScanner({ onCode, onClose, holdRef }: QrScannerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  // Each camera start gets a number; a start that is no longer the latest (closed, restarted, or
  // remounted while the browser was asking) releases its own camera instead of keeping it.
  const runRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("ask");
  const [notPickup, setNotPickup] = useState(false);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  // Kept in refs so the camera loop, set up once, always sees the latest of each.
  const phaseRef = useRef(phase);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    phaseRef.current = phase;
    onCodeRef.current = onCode;
  });

  // Focus stays in the sheet when the button that was pressed goes away (Turn on camera, Try again).
  useEffect(() => {
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) titleRef.current?.focus();
  }, [phase]);

  // Makes any camera start still waiting on the browser stale, so it releases what it gets.
  const cancelStarts = useCallback(() => {
    runRef.current += 1;
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    const run = ++runRef.current;
    if (!window.isSecureContext) return setPhase("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return setPhase("no_camera");
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (error) {
      if (run !== runRef.current) return;
      const name = error instanceof DOMException ? error.name : "";
      setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "no_camera" : "failed");
      return;
    }
    // A tab hidden while the browser was still opening the camera gets it again when shown.
    if (run !== runRef.current || doneRef.current || !rootRef.current || document.hidden) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
    setTorch({ supported: caps.torch === true, on: false });
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    }
    canvasRef.current ??= document.createElement("canvas");
    const detect = await createDetector(canvasRef.current);
    if (run !== runRef.current) return;
    setPhase("scanning");

    const tick = async () => {
      if (run !== runRef.current || doneRef.current || !streamRef.current || !videoRef.current) return;
      const payload = await detect(videoRef.current);
      // Closing the scanner while a detect call is out must not collect an order afterwards.
      if (run !== runRef.current || doneRef.current || !streamRef.current) return;
      const frame = readScanFrame(holdRef.current, payload, Date.now());
      holdRef.current = frame.hold;
      if (frame.kind === "code") {
        doneRef.current = true;
        stop();
        onCodeRef.current(frame.code);
        return;
      }
      if (frame.kind === "not_pickup") setNotPickup(true);
      timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
    };
    timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
  }, [holdRef, stop]);

  // Ask before the camera prompt, unless the site already has the camera.
  useEffect(() => {
    let active = true;
    // Where the browser cannot say, the sheet stays on its prompt.
    navigator.permissions?.query?.({ name: "camera" as PermissionName }).then(
      (status) => {
        if (!active) return;
        if (status.state === "granted") void start();
        else if (status.state === "denied") setPhase("denied");
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [start]);

  // The camera is released when the sheet closes, and paused while the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (streamRef.current) {
          stop();
          setPhase("starting");
        }
      } else if (!doneRef.current && !streamRef.current && phaseRef.current === "starting") {
        void start();
      }
    };
    doneRef.current = false;
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelStarts();
      document.removeEventListener("visibilitychange", onVisibility);
      doneRef.current = true;
      stop();
    };
  }, [cancelStarts, start, stop]);

  useEffect(() => {
    if (!notPickup) return;
    const timer = setTimeout(() => setNotPickup(false), NOT_PICKUP_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [notPickup]);

  // The page behind is inert and still while the sheet is open; focus starts on its title.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.hasAttribute("inert"),
    );
    others.forEach((el) => el.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      others.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = overflow;
    };
  }, []);

  const close = () => {
    doneRef.current = true;
    stop();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const at = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
    const wrap = event.shiftKey ? at <= 0 : at === items.length - 1;
    if (!wrap) return;
    event.preventDefault();
    items[event.shiftKey ? items.length - 1 : 0].focus();
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on });
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const live = phase === "scanning" || phase === "starting";
  const message = live ? null : PHASE_TEXT[phase];

  return createPortal(
    <div className="vendor-sheet vendor-scanner" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="vendor-sheet__scrim" aria-hidden="true" onClick={close} />
      <section className="vendor-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="scanner-title" aria-describedby="scanner-status">
        <div className="vendor-sheet__handle" aria-hidden="true" />
        <div className="vendor-sheet__text">
          <h2 id="scanner-title" ref={titleRef} tabIndex={-1}>
            {message ? message.title : "Scan QR code"}
          </h2>
          <p id="scanner-status" role="status">
            {message
              ? message.body
              : notPickup
                ? "That QR code is not a pickup code. Ask for the code on the customer's order page."
                : phase === "starting"
                  ? "Starting the camera..."
                  : "Point the camera at the QR code on the customer's order page."}
          </p>
        </div>
        {live && (
          <div className={`vendor-scanner__view${phase === "scanning" ? " is-live" : ""}`}>
            {/* Muted, inline and autoplaying, so iPhone Safari plays the camera inside the sheet. */}
            <video ref={videoRef} className="vendor-scanner__video" muted playsInline autoPlay aria-hidden="true" />
            <span className="vendor-scanner__frame" aria-hidden="true" />
          </div>
        )}
        <div className="vendor-sheet__buttons">
          {phase === "ask" && (
            <Button onClick={() => void start()} icon={<Icon name="qr_code_scanner" />}>
              Turn on camera
            </Button>
          )}
          {(phase === "failed" || phase === "denied") && (
            <Button variant="tonal" onClick={() => void start()}>
              Try again
            </Button>
          )}
          {live && torch.supported && (
            <Button variant="tonal" aria-pressed={torch.on} onClick={() => void toggleTorch()}>
              {torch.on ? "Turn light off" : "Turn light on"}
            </Button>
          )}
          <Button variant="outlined" vendorSide onClick={close}>
            Type the code instead
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
