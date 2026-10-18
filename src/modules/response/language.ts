// A conservative guard for the two languages exercised in this PoC. Ambiguous,
// short, mixed and other-language texts are left to the semantic verifier.
const words = {
  en: new Set(
    'the your you for and with this that have received message please thank thanks hello regards does provide support need our would could can we from to of'.split(
      ' ',
    ),
  ),
  es: new Set(
    'el la los las tu tus para por que del con hola gracias saludo saludos recibido mensaje correo podemos necesitas buenos buenas días tardes este esta una un he hemos'.split(
      ' ',
    ),
  ),
};
export function detectReplyLanguage(text: string): 'en' | 'es' | null {
  const tokens = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  const en = [...tokens].filter((word) => words.en.has(word)).length;
  const es = [...tokens].filter((word) => words.es.has(word)).length;
  if (en >= 4 && en - es >= 3) return 'en';
  if (es >= 4 && es - en >= 3) return 'es';
  return null;
}
