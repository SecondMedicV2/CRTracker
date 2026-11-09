const LABELS: Record<string, string> = {
  NOT_CALLED: "Ready to call",
  CALLED: "Contacted",
  CONSENT_GIVEN: "Consent recorded",
  BOOKED: "Doctor booked",
  CALL_LATER: "Callback scheduled",
  NOT_REACHABLE: "No answer",
  DECLINED: "Declined",
  WRONG_NUMBER: "Wrong number",
  DO_NOT_CALL: "Do not call",
  DOCTOR_DONE: "Doctor call completed",
};

export function callStageLabel(stage: string) {
  return LABELS[stage] ?? stage.replaceAll("_", " ").toLowerCase();
}
