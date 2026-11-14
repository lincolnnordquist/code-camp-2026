import './BoothPlate.css'

/** A booth's code on the dark plate: "Booth" then the code, read as one phrase. */
export function BoothPlate({ code, className = '' }: { code: string; className?: string }) {
  return (
    <span className={`ec-booth-plate ${className}`.trim()}>
      <span className="ec-booth-plate__label">Booth</span> <span className="ec-booth-plate__code">{code}</span>
    </span>
  )
}
