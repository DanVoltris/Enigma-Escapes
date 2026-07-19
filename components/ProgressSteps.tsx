const STEPS = ["Choose date & time", "Your details", "Billing", "Booking complete"];

export default function ProgressSteps({ current }: { current: number }) {
  return (
    <nav className="steps" aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const stepNumber = i + 1;
        const status = stepNumber < current ? "done" : stepNumber === current ? "current" : "todo";
        return (
          <span key={label} style={{ display: "contents" }}>
            {i > 0 && <span className="step-line" aria-hidden="true" />}
            <span className={`step ${status}`}>
              <span className="step-node">{status === "done" ? "✓" : stepNumber}</span>
              <span className="step-label">{label}</span>
            </span>
          </span>
        );
      })}
    </nav>
  );
}
