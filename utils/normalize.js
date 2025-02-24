import natural from 'natural';
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

/**
 * Normalizes a given text string by:
 *  - Converting to lowercase
 *  - Trimming whitespace
 *  - Tokenizing the text into words
 *  - Applying stemming to each token
 *  - Rejoining tokens into a single string
 *
 * @param {string} text - The input text to normalize.
 * @returns {string} - The normalized text.
 */
export function normalizeText(text) {
  const lowerText = text.toLowerCase().trim();
  const tokens = tokenizer.tokenize(lowerText);
  const stemmedTokens = tokens.map(token => stemmer.stem(token));
  return stemmedTokens.join(' ');
}
