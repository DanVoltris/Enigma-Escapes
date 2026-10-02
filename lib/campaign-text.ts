// What a campaign text says, and what it costs to send.
//
// Pure: the composer in the browser shows the exact message and segment count
// the server will send, so what the manager approves is what customers read.
import { toGsmSafe } from "./gsm";

// Every message names the business and says how to stop, because the law asks
// for both and nobody writing a campaign at 11pm should have to remember.
export function campaignText(company: string, body: string): string {
  return toGsmSafe(`${company}: ${body.trim()} Reply STOP to stop.`);
}

// What Twilio will charge for: 160 characters a segment in the plain alphabet,
// 70 if the text contains anything outside it (an emoji, a curly quote). The
// composer shows this, so a message that quietly costs three times as much
// across thousands of numbers is visible before it is sent.
export function segmentsFor(text: string): { segments: number; unicode: boolean; characters: number } {
  const unicode = /[^\u0000-\u007F -ÿ€]/.test(text) || toGsmSafe(text) !== text;
  const per = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153; // concatenated messages carry a header
  const characters = [...text].length;
  const segments = characters <= per ? 1 : Math.ceil(characters / multi);
  return { segments: Math.max(1, segments), unicode, characters };
}

