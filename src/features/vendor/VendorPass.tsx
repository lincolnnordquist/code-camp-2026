import type { CSSProperties, ReactNode, Ref } from "react";

const STEPS = ["Placed", "Confirmed", "Ready", "Collected"] as const;

// The order as the attendee's pass shows it: violet while it can be handed over, grey once it must
// not be. The white card inside holds the pickup code and whatever the screen adds under it.
export function VendorPass({
  tone,
  title,
  aside,
  step,
  headingRef,
  titleAs = "h2",
  children,
}: {
  tone: "violet" | "grey";
  title: string;
  aside: ReactNode;
  /** How many progress steps the order has reached; no track when null. */
  step: number | null;
  headingRef?: Ref<HTMLHeadingElement>;
  /** A heading, or plain text where the screen's own heading already says the same. */
  titleAs?: "h1" | "h2" | "p";
  children: ReactNode;
}) {
  const Title = titleAs;
  return (
    <section className={`vendor-pass vendor-pass--${tone}`}>
      <div className="vendor-pass__head">
        <Title className="title-large vendor-pass__title" ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title}
        </Title>
        <span className="vendor-pass__aside">{aside}</span>
      </div>
      {step !== null && (
        <div className="vendor-progress">
          <div className="vendor-progress__track" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s} className="vendor-progress__segment">
                {i < step && <span className="vendor-progress__fill" style={{ "--i": i } as CSSProperties} />}
              </span>
            ))}
          </div>
          <ol className="vendor-progress__labels body-small">
            {STEPS.map((s, i) => (
              <li key={s} className={i + 1 === step ? "is-current" : i + 1 > step ? "is-ahead" : undefined} aria-current={i + 1 === step ? "step" : undefined}>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="vendor-pass__card">{children}</div>
    </section>
  );
}

export function BoothAside({ code }: { code: string }) {
  return (
    <>
      <span className="label-medium">Booth </span>
      <span className="vendor-pass__booth">{code}</span>
    </>
  );
}

export function PassCode({ code }: { code: string }) {
  return (
    <div className="vendor-pass__code">
      <span className="label-medium vendor-pass__code-label">Pickup code</span>
      <span className="code">{code}</span>
    </div>
  );
}
