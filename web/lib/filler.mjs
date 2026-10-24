// Placeholder text for the Model workbench's cached prefix: lorem ipsum, the
// usual scrambled Latin filler, put together from its word pool by a seeded
// random generator. The seed is fixed, so a size gives the same text on every
// call, and a second call with it reads the prefix from the prompt cache.

/**
 * The sizes the workbench offers, in words: about 3,000 and 10,500 tokens. This
 * Latin takes about three tokens a word (measured with Haiku on 2026-10-19).
 */
export const FILLER_WORDS = { short: 1_000, long: 3_450 }

const OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
const WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore ' +
  'magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo ' +
  'consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint ' +
  'occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'
).split(' ')
const SEED = 20_251

/** A random number generator from a seed (mulberry32): the same seed gives the same numbers. */
function generator(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Paragraphs of lorem ipsum, at least `words` words long, the same for the same count.
 * @param {number} words
 */
export function fillerText(words) {
  const random = generator(SEED)
  const between = (low, high) => low + Math.floor(random() * (high - low + 1))
  const paragraphs = []
  let sentences = [OPENING]
  let count = OPENING.split(' ').length
  let length = between(4, 8)
  while (count < words) {
    const sentence = Array.from({ length: between(6, 16) }, () => WORDS[Math.floor(random() * WORDS.length)])
    // A comma after a word in the middle of about half the sentences.
    if (random() < 0.5) sentence[between(2, sentence.length - 3)] += ','
    sentence[0] = sentence[0][0].toUpperCase() + sentence[0].slice(1)
    sentences.push(`${sentence.join(' ')}.`)
    count += sentence.length
    if (sentences.length >= length) {
      paragraphs.push(sentences.join(' '))
      sentences = []
      length = between(4, 8)
    }
  }
  if (sentences.length > 0) paragraphs.push(sentences.join(' '))
  return paragraphs.join('\n\n')
}
