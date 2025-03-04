/**
 * Splits a text string into chunks of at most `maxLength` characters.
 * This is useful for sending messages that exceed Discord's 2000-character limit.
 *
 * @param {string} text - The text to split.
 * @param {number} maxLength - The maximum length of each chunk (default is 2000).
 * @returns {Array<string>} - An array of text chunks.
 */
export function splitMessage(text, maxLength = 2000) {
    const regex = new RegExp(`(.|[\r\n]){1,${maxLength}}`, 'g');
    return text.match(regex);
  }
  
  /**
   * Removes markdown code fences from a string.
   * This is useful to clean responses that include backticks.
   *
   * @param {string} text - The text to clean.
   * @returns {string} - The cleaned text.
   */
  export function stripCodeBlock(text) {
    return text.replace(/```(json)?/gi, '').replace(/```/g, '').trim();
  }
  
  /**
   * Replaces emoticon substrings with their corresponding emoji from a provided mapping.
   *
   * @param {string} text - The text in which to replace emoticons.
   * @param {Object} emojiMapping - An object mapping emoticon strings to emoji strings.
   * @returns {string} - The text with emoticons replaced by emojis.
   */
  export function replaceEmoticons(text, emojiMapping = {}) {
    for (const [emoticon, emoji] of Object.entries(emojiMapping)) {
      text = text.split(emoticon).join(emoji);
    }
    return text;
  }
  
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
