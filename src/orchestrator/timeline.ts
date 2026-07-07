export const DEMO_STEP_MS = 700;
export const HOLD_MS = 3000;

export const ASIANA_IVR_SCRIPT: { prompt: string }[] = [
  { prompt: 'For assistance in English, please press number 2.' },
  {
    prompt:
      'For arrival and departure info press 1, flight schedule press 2, Asiana Club press 3, reservation and ticketing press 4, to speak to an agent press 5.',
  },
  {
    prompt:
      'For U.S. departures or arrival baggage info press 1, seat assignment press 2, unaccompanied minor or pets press 3, contact numbers press 4, internet support press 5, all other inquiries press 6.',
  },
  {
    prompt:
      'Please enter your Asiana Club membership number, followed by the star sign. If you are not a member, please press the pound key.',
  },
  { prompt: 'Due to the heavy volume of incoming calls, the estimated wait time is more than 5 minutes.' },
];
