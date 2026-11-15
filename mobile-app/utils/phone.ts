// Phone numbers as E.164 — an explicitly selected country code plus
// the national number, never a bare 10-digit number silently treated
// as Indian. India (+91) is the pre-selected country, shown in the
// picker the user can change; the selection is visible on the form,
// not a hidden default.
export interface CountryOption {
  code: string;
  name: string;
  dial: string;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'IN', name: 'India', dial: '+91' },
  { code: 'US', name: 'United States', dial: '+1' },
  { code: 'GB', name: 'United Kingdom', dial: '+44' },
  { code: 'CA', name: 'Canada', dial: '+1' },
  { code: 'AU', name: 'Australia', dial: '+61' },
  { code: 'AE', name: 'UAE', dial: '+971' },
  { code: 'SG', name: 'Singapore', dial: '+65' },
  { code: 'DE', name: 'Germany', dial: '+49' },
];

/** Pre-selected country — India, shown in the picker, changeable. */
export const DEFAULT_COUNTRY: CountryOption = COUNTRY_OPTIONS[0];

/** National digits only, leading trunk 0 stripped, prefixed with the dial code. */
export const toE164 = (dial: string, national: string): string =>
  `${dial}${national.replace(/\D/g, '').replace(/^0+/, '')}`;

/** India needs exactly 10 national digits; other countries 7–15 (E.164 cap). */
export const nationalDigitsValid = (dial: string, national: string): boolean => {
  const digits = national.replace(/\D/g, '');
  return dial === '+91' ? digits.length === 10 : digits.length >= 7 && digits.length <= 15;
};
