export const validationOffer = Object.freeze({
  version: 'mail071-v1',
  name: 'Validación profesional',
  priceEur: 49,
  periodDays: 30,
  gmailAccounts: 1,
  initialDailyDraftLimit: 10,
  documentLimit: 10,
  documentMegabytes: 10,
  onboardingMinutes: 60,
  automaticRenewal: false,
  salesStatus: 'preparation' as const,
});
